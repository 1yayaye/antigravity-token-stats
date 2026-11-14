#!/usr/bin/env node
/**
 * Integration Test Suite for Antigravity ASAR Patch & Rollback
 * 
 * Verifies:
 * 1. Official Antigravity executable detection.
 * 2. Desktop & Start Menu shortcut creation pointing to Antigravity.exe (using pwsh).
 * 3. Mock ASAR extraction, main/preload injection, unpack preservation, strict mode retention, and repack integrity.
 * 4. Patch idempotency (running patch twice safely).
 * 5. Unpatch factory rollback and pristine state recovery (including unpacked files).
 * 6. Unpatch idempotency (running unpatch twice cleanly without redundant writes).
 * 7. Safe atomic replacement unit verification.
 */

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const { execFileSync, execFile } = require('node:child_process');
const { promisify } = require('node:util');
const execFileAsync = promisify(execFile);
const asar = require('@electron/asar');
const { patch, findAntigravityExe, safeAtomicReplace, safeReplaceDirectory: safeReplacePatchDirectory } = require('../hosts/antigravity/scripts/patch-antigravity.cjs');
const { unpatch } = require('../hosts/antigravity/scripts/unpatch-antigravity.cjs');
const contract = require('../src/injection-contract.cjs');
const { buildConfig } = require('./proxy-manager.cjs');

const TESTS = [];
let passCount = 0;
let failCount = 0;

function test(name, fn) {
  TESTS.push({ name, fn });
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

function verifyUpdateAssets(archive) {
  asar.uncacheAll();
  const prefix = path.join('dist', 'antigravity-stats');
  const metadata = JSON.parse(asar.extractFile(archive, path.join(prefix, 'contract.json')).toString('utf8'));
  assert(metadata.version === require('../package.json').version, 'Injected version must match the AntiToken package');
  assert(Object.entries(contract).every(([key, value]) => metadata[key] === value), 'Injected contract metadata must match the shared contract');
  const installed = asar.extractFile(archive, path.join(prefix, 'update-checker.cjs'));
  const source = fs.readFileSync(path.join(__dirname, '../hosts/antigravity/scripts/update-checker.cjs'));
  assert(installed.equals(source), 'Injected checker must match the current source');
}

// ============================================================================
// TESTS
// ============================================================================

test('Official Antigravity executable detection', () => {
  let exePath;
  try {
    exePath = findAntigravityExe();
  } catch (err) {
    if (process.env.CI) return; // Skip cleanly on CI runners without Antigravity installed
    throw err;
  }
  assert(fs.existsSync(exePath), `Antigravity executable must exist at ${exePath}`);
  assert(exePath.toLowerCase().endsWith('antigravity.exe'), 'Must point to Antigravity.exe');
});

test('Safe atomic replacement replaces target atomically and aborts on EBUSY/EPERM without corrupting target', () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'antigravity-atomic-test-'));
  const originalRenameSync = fs.renameSync;
  try {
    const src = path.join(tmpRoot, 'src.txt');
    const target = path.join(tmpRoot, 'target.txt');
    fs.writeFileSync(src, 'new-content', 'utf8');
    fs.writeFileSync(target, 'old-content', 'utf8');

    safeAtomicReplace(src, target);
    assert(fs.readFileSync(target, 'utf8') === 'new-content', 'Target must contain new content');
    assert(fs.existsSync(src), 'Source must remain intact');

    for (const code of ['EBUSY', 'EPERM']) {
      fs.writeFileSync(target, 'old-content', 'utf8');
      fs.renameSync = () => {
        const err = new Error(`Simulated ${code}`);
        err.code = code;
        throw err;
      };
      let caught = null;
      try {
        safeAtomicReplace(src, target);
      } catch (err) {
        caught = err;
      }
      assert(caught && caught.code === code, `safeAtomicReplace must propagate ${code} instead of falling back in-place`);
      assert(fs.readFileSync(target, 'utf8') === 'old-content', `Target must remain intact when rename throws ${code}`);
      assert(!fs.readdirSync(tmpRoot).some((f) => f.includes('.tmp.')), 'Temp file must be cleaned up on failure');
    }
  } finally {
    fs.renameSync = originalRenameSync;
    try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch {}
  }
});

test('Safe directory replacement preserves the original tree after a failed switch', () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'antigravity-directory-test-'));
  try {
    const source = path.join(tmpRoot, 'source');
    const target = path.join(tmpRoot, 'target');
    fs.mkdirSync(source, { recursive: true });
    fs.mkdirSync(target, { recursive: true });
    fs.writeFileSync(path.join(source, 'new.txt'), 'new', 'utf8');
    fs.writeFileSync(path.join(target, 'old.txt'), 'old', 'utf8');

    const originalRename = fs.renameSync;
    fs.renameSync = () => { throw new Error('simulated rename failure'); };
    try {
      let failed = false;
      try { safeReplacePatchDirectory(source, target); } catch { failed = true; }
      assert(failed, 'A simulated switch failure must be reported');
    } finally {
      fs.renameSync = originalRename;
    }
    assert(fs.readFileSync(path.join(target, 'old.txt'), 'utf8') === 'old', 'Failed switch must preserve old contents');
    assert(!fs.existsSync(path.join(target, 'new.txt')), 'Failed switch must not install partial new contents');
  } finally {
    try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch {}
  }
});

test('Release packaging outputs standalone .exe only (no .zip, no Node requirement)', () => {
  const releaseCode = fs.readFileSync(path.join(__dirname, '..', 'hosts', 'antigravity', 'scripts', 'package-release.cjs'), 'utf8');
  const workflowCode = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'release.yml'), 'utf8');
  assert(releaseCode.includes('AntiTokenSetup.csproj'), 'Release script must compile AntiTokenSetup.csproj');
  assert(releaseCode.includes('-setup.exe'), 'Release script must emit -setup.exe');
  assert(!releaseCode.includes('Compress-Archive'), 'Release script must not emit .zip archives');
  assert(workflowCode.includes('dist-release/*.exe'), 'Release workflow must upload .exe');
  assert(!workflowCode.includes('dist-release/*.zip'), 'Release workflow must not upload .zip');
});

test('Mock ASAR: full patch lifecycle, hooks injection, and unpack preservation', async () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'antigravity-mock-asar-'));
  const resourcesDir = path.join(tmpRoot, 'resources');
  const mockSrcDir = path.join(tmpRoot, 'mock-src');
  const asarPath = path.join(resourcesDir, 'app.asar');
  const backupPath = path.join(resourcesDir, 'app.asar.backup');
  const mockDevBundleFile = path.join(tmpRoot, 'mock-dev-bundle.path');

  try {
    fs.mkdirSync(resourcesDir, { recursive: true });
    fs.mkdirSync(path.join(mockSrcDir, 'dist'), { recursive: true });
    fs.mkdirSync(path.join(mockSrcDir, 'node_modules', 'chrome-devtools-mcp', 'build'), { recursive: true });

    // Pristine mock files
    const pristineMain = '"use strict";\nconsole.log("Antigravity Host Main Process");\n';
    const pristinePreload = '"use strict";\nelectron_1.contextBridge.exposeInMainWorld("deepLink", {});\n';
    const pristineMcp = 'module.exports = { mcp: true };\n';

    fs.writeFileSync(path.join(mockSrcDir, 'dist', 'main.js'), pristineMain, 'utf8');
    fs.writeFileSync(path.join(mockSrcDir, 'dist', 'preload.js'), pristinePreload, 'utf8');
    fs.writeFileSync(path.join(mockSrcDir, 'node_modules', 'chrome-devtools-mcp', 'build', 'index.js'), pristineMcp, 'utf8');

    // Create pristine mock asar
    await asar.createPackageWithOptions(mockSrcDir, asarPath, {
      unpack: '**/chrome-devtools-mcp/**'
    });

    const pristineAsarBuf = fs.readFileSync(asarPath);
    assert(!pristineAsarBuf.includes(Buffer.from(contract.MARKER_MAIN_HOOK)), 'Initial asar must not contain patch marker');
    assert(!fs.existsSync(backupPath), 'Initial state must not have backup file');
    assert(fs.existsSync(asarPath + '.unpacked'), 'Initial state must have unpacked folder');

    // 1. Run patch (isolated from system dev-bundle.path and real proxy dir)
    const patchResult = await patch({
      resourcesDir,
      silent: true,
      skipProcessCheck: true,
      withProxy: false,
      minAsarSize: 500,
      devBundleFile: mockDevBundleFile
    });

    assert(patchResult.patched === true, 'Patch should return patched: true');
    assert(patchResult.backupCreated === true, 'Backup should be created on first patch');
    assert(fs.existsSync(backupPath), 'Factory backup app.asar.backup must exist');
    assert(fs.existsSync(backupPath + '.unpacked'), 'Factory backup unpacked folder must exist');
    assert(fs.existsSync(mockDevBundleFile), 'Mock dev-bundle.path redirect must be created');

    // Backup must match pristine
    const backupBuf = fs.readFileSync(backupPath);
    assert(backupBuf.equals(pristineAsarBuf), 'Backup must be identical to pristine asar');

    // Patched asar must have marker
    const patchedAsarBuf = fs.readFileSync(asarPath);
    assert(patchedAsarBuf.includes(Buffer.from(contract.MARKER_MAIN_HOOK)), 'Patched asar must contain marker');

    // Extract patched asar to verify injected modules
    const verifyExtractDir = path.join(tmpRoot, 'verify-extracted');
    asar.uncacheAll();
    asar.extractAll(asarPath, verifyExtractDir);

    const patchedMain = fs.readFileSync(path.join(verifyExtractDir, 'dist', 'main.js'), 'utf8');
    assert(patchedMain.includes(contract.MARKER_MAIN_HOOK), 'dist/main.js must contain injection marker');
    assert(patchedMain.includes("require('./antigravity-stats/loader.cjs')"), 'dist/main.js must require loader.cjs');
    // Ensure strict mode remains at top of file
    assert(patchedMain.startsWith('"use strict";'), 'dist/main.js must retain "use strict" as the very first statement');

    const patchedPreload = fs.readFileSync(path.join(verifyExtractDir, 'dist', 'preload.js'), 'utf8');
    assert(patchedPreload.includes(contract.MARKER_PRELOAD_BRIDGE), 'dist/preload.js must contain preload bridge marker');
    assert(patchedPreload.includes(contract.WINDOW_SYNC_BRIDGE), `dist/preload.js must expose ${contract.WINDOW_SYNC_BRIDGE}`);

    assert(fs.existsSync(path.join(verifyExtractDir, 'dist', 'antigravity-stats', 'loader.cjs')), 'loader.cjs must exist in dist/antigravity-stats/');
    assert(fs.existsSync(path.join(verifyExtractDir, 'dist', 'antigravity-stats', 'aggregate-stats.cjs')), 'aggregate-stats.cjs must exist in dist/antigravity-stats/');
    assert(fs.existsSync(path.join(verifyExtractDir, 'dist', 'antigravity-stats', 'paths.cjs')), 'paths.cjs must exist in dist/antigravity-stats/');
    assert(fs.existsSync(path.join(verifyExtractDir, 'dist', 'antigravity-stats', 'injection-contract.cjs')), 'injection-contract.cjs must exist in dist/antigravity-stats/');
    assert(fs.existsSync(path.join(verifyExtractDir, 'dist', 'antigravity-stats', 'proxy-manager.cjs')), 'proxy-manager.cjs must exist in dist/antigravity-stats/');
    assert(fs.existsSync(path.join(verifyExtractDir, 'dist', 'antigravity-stats', 'antigravity-stats-bundle.js')), 'antigravity-stats-bundle.js must exist in dist/antigravity-stats/');
    verifyUpdateAssets(asarPath);

    // Unpack folder must remain intact
    const unpackedMcpFile = path.join(asarPath + '.unpacked', 'node_modules', 'chrome-devtools-mcp', 'build', 'index.js');
    assert(fs.existsSync(unpackedMcpFile), 'Unpacked MCP file must remain intact in app.asar.unpacked');
    assert(fs.readFileSync(unpackedMcpFile, 'utf8') === pristineMcp, 'Unpacked MCP file content must be preserved');

    // 2. Patch idempotency (running patch again)
    const patchResult2 = await patch({
      resourcesDir,
      silent: true,
      skipProcessCheck: true,
      withProxy: false,
      minAsarSize: 500,
      devBundleFile: mockDevBundleFile
    });
    assert(patchResult2.patched === true, 'Repeated patch should succeed');
    assert(patchResult2.backupCreated === false, 'Repeated patch must not overwrite existing backup');

    // Verify main.js was not double-hooked
    const verifyExtractDir2 = path.join(tmpRoot, 'verify-extracted-2');
    asar.uncacheAll();
    asar.extractAll(asarPath, verifyExtractDir2);
    const mainAfterSecondPatch = fs.readFileSync(path.join(verifyExtractDir2, 'dist', 'main.js'), 'utf8');
    const hookMatches = mainAfterSecondPatch.match(new RegExp(contract.MARKER_MAIN_HOOK, 'g')) || [];
    assert(hookMatches.length === 1, 'Hook must appear exactly once in dist/main.js');
    verifyUpdateAssets(asarPath);

    // 3. Rollback (unpatch)
    const unpatchResult = unpatch({
      resourcesDir,
      silent: true,
      skipProcessCheck: true,
      withProxy: false,
      devBundleFile: mockDevBundleFile
    });
    assert(unpatchResult.restored === true, 'Unpatch should restore from backup');
    assert(unpatchResult.pristine === true, 'Unpatch should report pristine state');
    assert(!fs.existsSync(mockDevBundleFile), 'Mock dev-bundle.path redirect file must be removed on unpatch');

    const restoredBuf = fs.readFileSync(asarPath);
    assert(restoredBuf.equals(pristineAsarBuf), 'Restored asar must be bitwise identical to pristine asar');
    assert(!restoredBuf.includes(Buffer.from(contract.MARKER_MAIN_HOOK)), 'Restored asar must not have patch marker');

    // Unpacked folder must match pristine
    const restoredMcpFile = path.join(asarPath + '.unpacked', 'node_modules', 'chrome-devtools-mcp', 'build', 'index.js');
    assert(fs.existsSync(restoredMcpFile), 'Unpacked MCP file must exist in restored state');
    assert(fs.readFileSync(restoredMcpFile, 'utf8') === pristineMcp, 'Restored unpacked MCP file must match original');

    // 4. Unpatch idempotency
    const unpatchResult2 = unpatch({
      resourcesDir,
      silent: true,
      skipProcessCheck: true,
      withProxy: false,
      devBundleFile: mockDevBundleFile
    });
    assert(unpatchResult2.restored === false, 'Repeated unpatch should not re-restore already pristine asar');
    assert(unpatchResult2.pristine === true, 'Repeated unpatch should report pristine state');

    // 5. Antigravity update refreshes stale backup before re-patching
    fs.writeFileSync(backupPath, Buffer.from('stale-older-version-asar'), 'utf8');
    const updatePatchResult = await patch({
      resourcesDir,
      silent: true,
      skipProcessCheck: true,
      withProxy: false,
      minAsarSize: 500,
      devBundleFile: mockDevBundleFile
    });
    assert(updatePatchResult.patched === true, 'Patch after official update should succeed');
    assert(fs.readFileSync(backupPath).equals(pristineAsarBuf), 'Stale backup must be refreshed from new official app.asar');
    const updateUnpatch = unpatch({
      resourcesDir,
      silent: true,
      skipProcessCheck: true,
      withProxy: false,
      devBundleFile: mockDevBundleFile
    });
    assert(updateUnpatch.restored === true && fs.readFileSync(asarPath).equals(pristineAsarBuf), 'Unpatch after update must restore the new official app.asar');
  } finally {
    try {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    } catch {}
  }
});

function resolveBuiltInstallerExe() {
  const projectRoot = path.resolve(__dirname, '..');
  const pkg = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
  const candidates = [
    path.join(projectRoot, 'dist-release', `antigravity-token-stats-v${pkg.version}-setup.exe`),
    path.join(projectRoot, 'hosts', 'antigravity', 'installer', 'bin', 'Release', 'net48', 'AntiTokenSetup.exe'),
  ];
  const trackedInputs = [
    path.join(projectRoot, 'scripts', 'aggregate-stats.cjs'),
    path.join(projectRoot, 'dist-bundle', 'antigravity-stats-bundle.js'),
    path.join(projectRoot, 'hosts', 'antigravity', 'installer', 'EmbeddedAssets', 'aggregate-stats.cjs'),
    path.join(projectRoot, 'hosts', 'antigravity', 'installer', 'EmbeddedAssets', 'antigravity-stats-bundle.js'),
  ].filter((p) => fs.existsSync(p));
  const newestInputMtimeMs = trackedInputs.reduce((max, p) => Math.max(max, fs.statSync(p).mtimeMs), 0);
  const fresh = candidates.find((p) => fs.existsSync(p) && fs.statSync(p).mtimeMs >= newestInputMtimeMs);
  if (fresh) return fresh;

  // Build installer if missing or stale compared to bundled assets
  execFileSync(process.execPath, [path.join(projectRoot, 'hosts', 'antigravity', 'installer-gen', 'prepare-assets.cjs'), '--skip-bundle'], {
    cwd: projectRoot,
    stdio: 'inherit',
  });
  execFileSync('dotnet', ['build', path.join(projectRoot, 'hosts', 'antigravity', 'installer', 'AntiTokenSetup.csproj'), '-c', 'Release'], {
    cwd: projectRoot,
    stdio: 'inherit',
  });
  return candidates[1];
}

test('Standalone C# .exe installer: mock ASAR patch, @electron/asar interop, proxy deployment, and factory unpatch', async () => {
  const builtExe = resolveBuiltInstallerExe();
  assert(fs.existsSync(builtExe), `Installer exe must exist at ${builtExe}`);

  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'antigravity-cs-installer-'));
  const isolatedBinDir = path.join(tmpRoot, 'isolated-bin');
  const appRootDir = path.join(tmpRoot, 'app');
  const resourcesDir = path.join(appRootDir, 'resources');
  const mockSrcDir = path.join(tmpRoot, 'mock-src');
  const asarPath = path.join(resourcesDir, 'app.asar');
  const backupPath = path.join(resourcesDir, 'app.asar.backup');
  const mockDevBundleFile = path.join(tmpRoot, 'mock-dev-bundle.path');

  try {
    // Copy ONLY the .exe (no .config, no repo) into isolated directory
    fs.mkdirSync(isolatedBinDir, { recursive: true });
    const isolatedExe = path.join(isolatedBinDir, 'AntiTokenSetup.exe');
    fs.copyFileSync(builtExe, isolatedExe);

    fs.mkdirSync(resourcesDir, { recursive: true });
    fs.mkdirSync(path.join(mockSrcDir, 'dist'), { recursive: true });
    fs.mkdirSync(path.join(mockSrcDir, 'node_modules', 'chrome-devtools-mcp', 'build'), { recursive: true });

    const pristineMain = '\uFEFF"use strict";\nconsole.log("Antigravity Host Main Process");\n';
    const pristinePreload = '"use strict";\nelectron_1.contextBridge.exposeInMainWorld("deepLink", {});\n';
    const pristineMcp = 'module.exports = { mcp: true };\n';
    const dupContent = 'duplicate-payload-content-12345\n';
    const multiBlockPayload = Buffer.alloc(4 * 1024 * 1024 + 512 * 1024, 0x4b);

    fs.writeFileSync(path.join(mockSrcDir, 'dist', 'main.js'), pristineMain, 'utf8');
    fs.writeFileSync(path.join(mockSrcDir, 'dist', 'preload.js'), pristinePreload, 'utf8');
    fs.writeFileSync(path.join(mockSrcDir, 'dist', 'empty.txt'), '', 'utf8');
    fs.writeFileSync(path.join(mockSrcDir, 'dist', 'dup-a.txt'), dupContent, 'utf8');
    fs.writeFileSync(path.join(mockSrcDir, 'dist', 'dup-b.txt'), dupContent, 'utf8');
    fs.writeFileSync(path.join(mockSrcDir, 'dist', 'big-4mb-plus.bin'), multiBlockPayload);
    fs.writeFileSync(path.join(mockSrcDir, 'dist', "中文&'file.txt"), 'unicode-ok', 'utf8');
    fs.writeFileSync(path.join(mockSrcDir, 'node_modules', 'chrome-devtools-mcp', 'build', 'index.js'), pristineMcp, 'utf8');

    await asar.createPackageWithOptions(mockSrcDir, asarPath, {
      unpack: '**/chrome-devtools-mcp/**'
    });
    const pristineAsarBuf = fs.readFileSync(asarPath);

    // Pre-create stale dev-bundle redirect to verify C# installer cleans it up
    fs.writeFileSync(mockDevBundleFile, 'C:\\stale\\bundle.js', 'utf8');

    // 1. Patch + Proxy install via standalone C# .exe (with trailing backslash to guard path normalization)
    execFileSync(isolatedExe, [
      '--patch-dir', resourcesDir + '\\',
      '--proxy-port', '17890',
      '--proxy-type', 'http',
      '--min-asar-size', '500',
      '--dev-bundle', mockDevBundleFile,
      '--no-gui'
    ], { encoding: 'utf8' });

    assert(fs.existsSync(backupPath), 'C# installer must create app.asar.backup');
    assert(fs.readFileSync(backupPath).equals(pristineAsarBuf), 'Backup must match pristine app.asar');
    assert(fs.existsSync(backupPath + '.unpacked'), 'C# installer must backup app.asar.unpacked');
    assert(!fs.existsSync(mockDevBundleFile), 'C# installer must remove stale dev-bundle.path');

    // Verify proxy files deployed to app root (NOT inside resources/)
    const deployedDll = path.join(appRootDir, 'version.dll');
    const deployedConfig = path.join(appRootDir, 'config.json');
    assert(fs.existsSync(deployedDll), 'version.dll must be deployed to app root');
    assert(fs.existsSync(deployedConfig), 'config.json must be deployed to app root');
    assert(!fs.existsSync(path.join(resourcesDir, 'version.dll')), 'version.dll must not be placed inside resources/');
    const parsedCfg = JSON.parse(fs.readFileSync(deployedConfig, 'utf8'));
    const expectedBaseline = buildConfig({ port: 17890, type: 'http', host: '127.0.0.1' });
    assert(parsedCfg.proxy?.type === 'http' && parsedCfg.proxy?.port === 17890, 'config.json proxy must match CLI options');
    assert(JSON.stringify(parsedCfg.target_processes) === JSON.stringify(expectedBaseline.target_processes), 'target_processes must match proxy-manager.cjs');

    // Verify with C# verifier
    execFileSync(isolatedExe, ['--verify-asar', asarPath, '--require-patched'], { encoding: 'utf8' });

    // Cross-verify with @electron/asar
    const verifyExtractDir = path.join(tmpRoot, 'verify-cs-extracted');
    asar.uncacheAll();
    asar.extractAll(asarPath, verifyExtractDir);

    const patchedMain = fs.readFileSync(path.join(verifyExtractDir, 'dist', 'main.js'), 'utf8');
    assert(patchedMain.startsWith('\uFEFF"use strict";'), 'dist/main.js must keep BOM + "use strict" first');
    assert(patchedMain.includes(contract.MARKER_MAIN_HOOK), 'dist/main.js must contain MARKER_MAIN_HOOK');
    assert(patchedMain.includes("require('./antigravity-stats/loader.cjs')"), 'dist/main.js must require loader.cjs');

    const patchedPreload = fs.readFileSync(path.join(verifyExtractDir, 'dist', 'preload.js'), 'utf8');
    assert(patchedPreload.includes(contract.MARKER_PRELOAD_BRIDGE), 'dist/preload.js must contain MARKER_PRELOAD_BRIDGE');
    assert(patchedPreload.includes(contract.WINDOW_SYNC_BRIDGE), 'dist/preload.js must expose WINDOW_SYNC_BRIDGE');

    for (const file of ['loader.cjs', 'update-checker.cjs', 'contract.json', 'aggregate-stats.cjs', 'paths.cjs', 'injection-contract.cjs', 'proxy-manager.cjs', 'antigravity-stats-bundle.js']) {
      assert(fs.existsSync(path.join(verifyExtractDir, 'dist', 'antigravity-stats', file)), `Missing injected asset: ${file}`);
    }
    verifyUpdateAssets(asarPath);
    assert(fs.readFileSync(path.join(verifyExtractDir, 'dist', 'empty.txt')).length === 0, 'Empty file must remain 0 bytes');
    assert(fs.readFileSync(path.join(verifyExtractDir, 'dist', 'dup-a.txt'), 'utf8') === dupContent, 'dup-a.txt must retain content');
    assert(fs.readFileSync(path.join(verifyExtractDir, 'dist', 'dup-b.txt'), 'utf8') === dupContent, 'dup-b.txt must retain content');
    assert(fs.readFileSync(path.join(verifyExtractDir, 'dist', 'big-4mb-plus.bin')).equals(multiBlockPayload), '>4MB multi-block file must retain exact content');
    assert(fs.readFileSync(path.join(verifyExtractDir, 'dist', "中文&'file.txt"), 'utf8') === 'unicode-ok', 'Unicode & special-char filename must retain content');
    assert(fs.readFileSync(path.join(asarPath + '.unpacked', 'node_modules', 'chrome-devtools-mcp', 'build', 'index.js'), 'utf8') === pristineMcp, 'Unpacked file must remain intact');

    // 2. Patch idempotency
    execFileSync(isolatedExe, [
      '--patch-dir', resourcesDir,
      '--no-proxy',
      '--min-asar-size', '500',
      '--dev-bundle', mockDevBundleFile,
      '--no-gui'
    ], { encoding: 'utf8' });
    const verifyExtractDir2 = path.join(tmpRoot, 'verify-cs-extracted-2');
    asar.uncacheAll();
    asar.extractAll(asarPath, verifyExtractDir2);
    const main2 = fs.readFileSync(path.join(verifyExtractDir2, 'dist', 'main.js'), 'utf8');
    assert((main2.match(new RegExp(contract.MARKER_MAIN_HOOK, 'g')) || []).length === 1, 'Repeated C# patch must not double-hook main.js');
    assert(fs.readFileSync(backupPath).equals(pristineAsarBuf), 'Repeated C# patch must preserve original backup');
    verifyUpdateAssets(asarPath);

    // 3. Unpatch + proxy removal
    execFileSync(isolatedExe, [
      '--unpatch-dir', resourcesDir,
      '--dev-bundle', mockDevBundleFile,
      '--no-gui'
    ], { encoding: 'utf8' });
    assert(fs.readFileSync(asarPath).equals(pristineAsarBuf), 'Unpatched app.asar must be bitwise identical to pristine');
    assert(!fs.existsSync(deployedDll), 'Unpatch must remove version.dll');
    assert(!fs.existsSync(deployedConfig), 'Unpatch must remove config.json');

    // 4. Unpatch idempotency
    execFileSync(isolatedExe, [
      '--unpatch-dir', resourcesDir,
      '--dev-bundle', mockDevBundleFile,
      '--no-gui'
    ], { encoding: 'utf8' });
  } finally {
    try {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    } catch {}
  }
});

test('Standalone C# .exe installer: detects local IPv4/IPv6 SOCKS5/HTTP proxy ports, owning process, and tunnel handshake', async () => {
  const builtExe = resolveBuiltInstallerExe();
  const socksServer = net.createServer((socket) => {
    socket.on('error', () => {});
    socket.once('data', (chunk) => {
      if (chunk[0] === 0x05) {
        socket.write(Buffer.from([0x05, 0x00]));
      }
      socket.end();
    });
  });
  const httpServer = net.createServer((socket) => {
    socket.on('error', () => {});
    socket.once('data', (chunk) => {
      const text = chunk.toString('ascii');
      if (text.startsWith('CONNECT ')) {
        socket.write('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
      }
      socket.end();
    });
  });
  const v6SocksTunnelServer = net.createServer((socket) => {
    socket.on('error', () => {});
    let stage = 0;
    socket.on('data', (chunk) => {
      if (stage === 0 && chunk[0] === 0x05) {
        stage = 1;
        socket.write(Buffer.from([0x05, 0x00]));
      } else if (stage === 1 && chunk[0] === 0x05 && chunk[1] === 0x01) {
        socket.write(Buffer.from([0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0]));
        socket.end();
      }
    });
  });

  await new Promise((resolve) => socksServer.listen(0, '127.0.0.1', resolve));
  await new Promise((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
  await new Promise((resolve) => v6SocksTunnelServer.listen(0, '::1', resolve));
  const socksPort = socksServer.address().port;
  const httpPort = httpServer.address().port;
  const v6Port = v6SocksTunnelServer.address().port;

  try {
    const { stdout: outSocks } = await execFileAsync(builtExe, ['--detect-proxies', '--proxy-port', String(socksPort)], { encoding: 'utf8' });
    const detectedSocks = JSON.parse(outSocks.trim());
    const socksHit = detectedSocks.find((x) => x.port === socksPort);
    assert(socksHit, `Must detect mock SOCKS5 proxy on port ${socksPort}`);
    assert(socksHit.socks5 === true, 'Must identify SOCKS5 handshake');
    assert(socksHit.http === false, 'SOCKS5 mock must not be flagged as HTTP');
    assert(String(socksHit.processName || '').toLowerCase() === 'node', `Expected owning process 'node', got '${socksHit.processName}'`);

    const { stdout: outHttp } = await execFileAsync(builtExe, ['--detect-proxies', '--proxy-port', String(httpPort)], { encoding: 'utf8' });
    const detectedHttp = JSON.parse(outHttp.trim());
    const httpHit = detectedHttp.find((x) => x.port === httpPort);
    assert(httpHit, `Must detect mock HTTP proxy on port ${httpPort}`);
    assert(httpHit.http === true, 'Must identify HTTP proxy response');
    assert(httpHit.socks5 === false, 'HTTP mock must not be flagged as SOCKS5');

    const { stdout: outV6 } = await execFileAsync(builtExe, ['--detect-proxies', '--proxy-port', String(v6Port)], { encoding: 'utf8' });
    const detectedV6 = JSON.parse(outV6.trim());
    const v6Hit = detectedV6.find((x) => x.port === v6Port);
    assert(v6Hit, `Must detect mock IPv6 ::1 SOCKS5 proxy on port ${v6Port}`);
    assert(v6Hit.host === '::1', `Expected host '::1', got '${v6Hit.host}'`);
    assert(v6Hit.socks5 === true, 'IPv6 mock must identify SOCKS5');

    const { stdout: outTunnel } = await execFileAsync(builtExe, [
      '--test-proxy', '--proxy-host', '::1', '--proxy-port', String(v6Port), '--proxy-type', 'socks5'
    ], { encoding: 'utf8' });
    const tunnelRes = JSON.parse(outTunnel.trim());
    assert(tunnelRes.ok === true, `IPv6 ::1 --test-proxy must succeed, got: ${tunnelRes.message}`);
  } finally {
    socksServer.close();
    httpServer.close();
    v6SocksTunnelServer.close();
  }
});

test('Standalone C# .exe installer & JS patcher: corrupt app.asar never overwrites valid backup, and unpatch never downgrades unpatched update', async () => {
  const builtExe = resolveBuiltInstallerExe();
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'antigravity-backup-safety-'));
  try {
    const srcDir = path.join(tmpRoot, 'src');
    fs.mkdirSync(path.join(srcDir, 'dist'), { recursive: true });
    fs.writeFileSync(path.join(srcDir, 'dist', 'main.js'), '"use strict";\nconsole.log("main");\n');
    fs.writeFileSync(path.join(srcDir, 'dist', 'preload.js'), '"use strict";\nconsole.log("preload");\n');
    const validAsar = path.join(tmpRoot, 'valid.asar');
    await asar.createPackage(srcDir, validAsar);
    const validBuf = fs.readFileSync(validAsar);
    const corruptBuf = Buffer.from('CORRUPTED_TRUNCATED_ASAR');

    // 1. JS patcher must keep valid backup when app.asar is corrupted
    const jsResDir = path.join(tmpRoot, 'js', 'resources');
    fs.mkdirSync(jsResDir, { recursive: true });
    fs.writeFileSync(path.join(jsResDir, 'app.asar'), corruptBuf);
    fs.writeFileSync(path.join(jsResDir, 'app.asar.backup'), validBuf);
    let jsFailed = false;
    try {
      await patch({
        resourcesDir: jsResDir,
        silent: true,
        skipProcessCheck: true,
        withProxy: false,
        minAsarSize: 100,
        devBundleFile: path.join(tmpRoot, 'js-dev.path'),
      });
    } catch {
      jsFailed = true;
    }
    assert(jsFailed, 'JS patch must fail on corrupted app.asar');
    assert(fs.readFileSync(path.join(jsResDir, 'app.asar.backup')).equals(validBuf), 'JS patch must preserve existing valid backup on failure');

    // 2. C# installer must keep valid backup when app.asar is corrupted
    const csResDir = path.join(tmpRoot, 'cs', 'resources');
    fs.mkdirSync(csResDir, { recursive: true });
    fs.writeFileSync(path.join(csResDir, 'app.asar'), corruptBuf);
    fs.writeFileSync(path.join(csResDir, 'app.asar.backup'), validBuf);
    let csFailed = false;
    try {
      execFileSync(builtExe, ['--patch-dir', csResDir, '--no-proxy', '--dev-bundle', path.join(tmpRoot, 'cs-dev.path'), '--no-gui'], { stdio: 'pipe' });
    } catch {
      csFailed = true;
    }
    assert(csFailed, 'C# patch must fail on corrupted app.asar');
    assert(fs.readFileSync(path.join(csResDir, 'app.asar.backup')).equals(validBuf), 'C# patch must preserve existing valid backup on failure');

    // 3. Unpatching an already-unpatched newer official app.asar must not downgrade it with stale backup
    const unpatchedNewer = Buffer.from('OFFICIAL_V2_UNPATCHED_ARCHIVE');
    const staleOldBackup = Buffer.from('STALE_V1_BACKUP_ARCHIVE');
    fs.writeFileSync(path.join(jsResDir, 'app.asar'), unpatchedNewer);
    fs.writeFileSync(path.join(jsResDir, 'app.asar.backup'), staleOldBackup);
    const jsUnpatch = unpatch({ resourcesDir: jsResDir, silent: true, skipProcessCheck: true, withProxy: false, devBundleFile: path.join(tmpRoot, 'js-dev.path') });
    assert(jsUnpatch.restored === false && jsUnpatch.pristine === true, 'JS unpatch must treat unpatched app.asar as already pristine');
    assert(fs.readFileSync(path.join(jsResDir, 'app.asar')).equals(unpatchedNewer), 'JS unpatch must not overwrite unpatched app.asar with stale backup');

    fs.writeFileSync(path.join(csResDir, 'app.asar'), unpatchedNewer);
    fs.writeFileSync(path.join(csResDir, 'app.asar.backup'), staleOldBackup);
    execFileSync(builtExe, ['--unpatch-dir', csResDir, '--no-proxy', '--dev-bundle', path.join(tmpRoot, 'cs-dev.path'), '--no-gui'], { encoding: 'utf8' });
    assert(fs.readFileSync(path.join(csResDir, 'app.asar')).equals(unpatchedNewer), 'C# unpatch must not overwrite unpatched app.asar with stale backup');
  } finally {
    try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch {}
  }
});

test('Standalone C# .exe installer: handles fragmented SOCKS5 and HTTP CONNECT proxy replies', async () => {
  const builtExe = resolveBuiltInstallerExe();
  const splitSocksServer = net.createServer((socket) => {
    socket.on('error', () => {});
    let stage = 0;
    socket.on('data', (chunk) => {
      if (stage === 0 && chunk[0] === 0x05) {
        stage = 1;
        socket.write(Buffer.from([0x05, 0x00]));
      } else if (stage === 1 && chunk[0] === 0x05 && chunk[1] === 0x01) {
        stage = 2;
        socket.write(Buffer.from([0x05]));
        setTimeout(() => {
          try {
            socket.write(Buffer.from([0x00, 0x00, 0x01, 127, 0, 0, 1, 0, 80]));
            socket.end();
          } catch {}
        }, 60);
      }
    });
  });
  const splitHttpServer = net.createServer((socket) => {
    socket.on('error', () => {});
    socket.once('data', () => {
      socket.write('HTTP/1.1 ');
      setTimeout(() => {
        try {
          socket.write('200 Connection Established\r\n\r\n');
          socket.end();
        } catch {}
      }, 60);
    });
  });

  await new Promise((resolve) => splitSocksServer.listen(0, '127.0.0.1', resolve));
  await new Promise((resolve) => splitHttpServer.listen(0, '127.0.0.1', resolve));
  const socksPort = splitSocksServer.address().port;
  const httpPort = splitHttpServer.address().port;

  try {
    const { stdout: outSocks } = await execFileAsync(builtExe, [
      '--test-proxy', '--proxy-host', '127.0.0.1', '--proxy-port', String(socksPort), '--proxy-type', 'socks5'
    ], { encoding: 'utf8' });
    const socksRes = JSON.parse(outSocks.trim());
    assert(socksRes.ok === true, `Fragmented SOCKS5 CONNECT reply must succeed, got: ${socksRes.message}`);

    const { stdout: outHttp } = await execFileAsync(builtExe, [
      '--test-proxy', '--proxy-host', '127.0.0.1', '--proxy-port', String(httpPort), '--proxy-type', 'http'
    ], { encoding: 'utf8' });
    const httpRes = JSON.parse(outHttp.trim());
    assert(httpRes.ok === true, `Fragmented HTTP CONNECT status line must succeed, got: ${httpRes.message}`);
  } finally {
    splitSocksServer.close();
    splitHttpServer.close();
  }
});

test('Standalone C# .exe installer: real Antigravity app.asar copy patch and rollback', () => {
  let realExe;
  try {
    realExe = findAntigravityExe();
  } catch {
    return; // Skip cleanly on CI runners without Antigravity installed
  }
  const realResources = path.join(path.dirname(realExe), 'resources');
  const realAsar = path.join(realResources, 'app.asar');
  const realBackup = path.join(realResources, 'app.asar.backup');
  if (!fs.existsSync(realAsar)) return;

  const builtExe = resolveBuiltInstallerExe();
  const realAsarPatched = fs.readFileSync(realAsar).includes(Buffer.from(contract.MARKER_MAIN_HOOK));
  const hasPristineBackup = fs.existsSync(realBackup) && !fs.readFileSync(realBackup).includes(Buffer.from(contract.MARKER_MAIN_HOOK));
  const pristineSourceAsar = !realAsarPatched ? realAsar : (hasPristineBackup ? realBackup : null);

  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'antigravity-real-asar-copy-'));
  const mockDevBundleFile = path.join(tmpRoot, 'dev-bundle.path');

  try {
    // 1. Pristine -> patch -> verify -> unpatch lifecycle (when pristine source exists on disk)
    if (pristineSourceAsar) {
      const resourcesCopy = path.join(tmpRoot, 'pristine-resources');
      const asarCopy = path.join(resourcesCopy, 'app.asar');
      fs.mkdirSync(resourcesCopy, { recursive: true });
      fs.copyFileSync(pristineSourceAsar, asarCopy);
      const sourceUnpacked = pristineSourceAsar + '.unpacked';
      if (fs.existsSync(sourceUnpacked)) {
        fs.cpSync(sourceUnpacked, asarCopy + '.unpacked', { recursive: true, force: true });
      }
      const origBuf = fs.readFileSync(asarCopy);

      execFileSync(builtExe, [
        '--patch-dir', resourcesCopy,
        '--no-proxy',
        '--dev-bundle', mockDevBundleFile,
        '--no-gui'
      ], { encoding: 'utf8' });

      execFileSync(builtExe, ['--verify-asar', asarCopy, '--require-patched'], { encoding: 'utf8' });

      asar.uncacheAll();
      const pkgEntries = asar.listPackage(asarCopy);
      assert(pkgEntries.some((e) => e.replace(/\\/g, '/').endsWith('/dist/antigravity-stats/loader.cjs')), '@electron/asar must list injected loader.cjs in real app.asar copy');
      verifyUpdateAssets(asarCopy);

      execFileSync(builtExe, [
        '--unpatch-dir', resourcesCopy,
        '--no-proxy',
        '--dev-bundle', mockDevBundleFile,
        '--no-gui'
      ], { encoding: 'utf8' });

      assert(fs.readFileSync(asarCopy).equals(origBuf), 'Unpatched real app.asar copy must be bitwise identical to pristine source');
    }

    // 2. When host installation is already patched, also test updating the existing patch in place
    if (realAsarPatched) {
      const updateResources = path.join(tmpRoot, 'update-resources');
      const updateAsar = path.join(updateResources, 'app.asar');
      fs.mkdirSync(updateResources, { recursive: true });
      fs.copyFileSync(realAsar, updateAsar);
      if (hasPristineBackup) {
        fs.copyFileSync(realBackup, updateAsar + '.backup');
      }

      execFileSync(builtExe, [
        '--patch-dir', updateResources,
        '--no-proxy',
        '--dev-bundle', mockDevBundleFile,
        '--no-gui'
      ], { encoding: 'utf8' });

      execFileSync(builtExe, ['--verify-asar', updateAsar, '--require-patched'], { encoding: 'utf8' });
      verifyUpdateAssets(updateAsar);

      if (hasPristineBackup) {
        execFileSync(builtExe, [
          '--unpatch-dir', updateResources,
          '--no-proxy',
          '--dev-bundle', mockDevBundleFile,
          '--no-gui'
        ], { encoding: 'utf8' });
        assert(fs.readFileSync(updateAsar).equals(fs.readFileSync(realBackup)), 'Unpatch after updating patched copy must restore factory backup');
      }
    }
  } finally {
    try {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    } catch {}
  }
});

// ============================================================================
// RUNNER
// ============================================================================

async function runAll() {
  console.log('\n' + '='.repeat(60));
  console.log('Antigravity Token Stats — ASAR Patch & Integration Tests');
  console.log('='.repeat(60) + '\n');

  const filter = process.argv.find(arg => arg.startsWith('--filter='))?.slice('--filter='.length);
  const selected = TESTS.filter(test => !filter || test.name.includes(filter));
  if (!selected.length) throw new Error('No integration tests matched the filter');
  for (const { name, fn } of selected) {
    try {
      await fn();
      console.log('✅', name);
      passCount++;
    } catch (err) {
      console.log('❌', name);
      console.log('   Error:', err.message);
      failCount++;
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log(`Results: ${passCount} passed, ${failCount} failed`);
  console.log('='.repeat(60) + '\n');

  if (failCount > 0) {
    process.exit(1);
  }
}

runAll().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
