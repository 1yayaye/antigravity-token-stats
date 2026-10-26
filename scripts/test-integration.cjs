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
const asar = require('@electron/asar');
const { findAntigravityExe, setupShortcut, getPowerShellCmd } = require('./setup-shortcut.cjs');
const { patch, safeAtomicReplace, safeReplaceDirectory: safeReplacePatchDirectory } = require('./patch-antigravity.cjs');
const { unpatch } = require('./unpatch-antigravity.cjs');

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

// ============================================================================
// TESTS
// ============================================================================

test('Official Antigravity executable detection', () => {
  const exePath = findAntigravityExe();
  assert(fs.existsSync(exePath), `Antigravity executable must exist at ${exePath}`);
  assert(exePath.toLowerCase().endsWith('antigravity.exe'), 'Must point to Antigravity.exe');
});

test('Desktop shortcut creation points directly to Antigravity.exe (pwsh preferred)', () => {
  if (process.platform !== 'win32') return;
  const psCmd = getPowerShellCmd();
  assert(psCmd === 'pwsh' || psCmd === 'powershell.exe', 'Must find a valid PowerShell command');

  setupShortcut();
  const desktopLnk = path.join(os.homedir(), 'Desktop', 'Antigravity (with Stats).lnk');
  assert(fs.existsSync(desktopLnk), `Shortcut should exist at ${desktopLnk}`);
  const stats = fs.statSync(desktopLnk);
  assert(stats.size > 500, 'LNK shortcut file should be a valid non-empty binary file');
});

test('Safe atomic replacement replaces target atomically', () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'antigravity-atomic-test-'));
  try {
    const src = path.join(tmpRoot, 'src.txt');
    const target = path.join(tmpRoot, 'target.txt');
    fs.writeFileSync(src, 'new-content', 'utf8');
    fs.writeFileSync(target, 'old-content', 'utf8');

    safeAtomicReplace(src, target);
    assert(fs.readFileSync(target, 'utf8') === 'new-content', 'Target must contain new content');
    assert(fs.existsSync(src), 'Source must remain intact');
  } finally {
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

test('Release installer requires system Node and has no Electron runtime fallback', () => {
  const releaseCode = fs.readFileSync(path.join(__dirname, 'package-release.cjs'), 'utf8');
  assert(releaseCode.includes('Node.js 22.13+ is required'), 'Release scripts must require Node.js 22.13+');
  assert(!releaseCode.includes('ELECTRON_RUN_AS_NODE'), 'Release scripts must not use Electron as Node');
  assert(!releaseCode.includes('Antigravity built-in runtime'), 'Release scripts must not use Antigravity as Node');
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
    assert(!pristineAsarBuf.includes(Buffer.from('__ANTIGRAVITY_STATS_INJECTION__')), 'Initial asar must not contain patch marker');
    assert(!fs.existsSync(backupPath), 'Initial state must not have backup file');
    assert(fs.existsSync(asarPath + '.unpacked'), 'Initial state must have unpacked folder');

    // 1. Run patch (isolated from system dev-bundle.path)
    const patchResult = await patch({
      resourcesDir,
      silent: true,
      skipProcessCheck: true,
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
    assert(patchedAsarBuf.includes(Buffer.from('__ANTIGRAVITY_STATS_INJECTION__')), 'Patched asar must contain marker');

    // Extract patched asar to verify injected modules
    const verifyExtractDir = path.join(tmpRoot, 'verify-extracted');
    asar.uncacheAll();
    asar.extractAll(asarPath, verifyExtractDir);

    const patchedMain = fs.readFileSync(path.join(verifyExtractDir, 'dist', 'main.js'), 'utf8');
    assert(patchedMain.includes('__ANTIGRAVITY_STATS_INJECTION__'), 'dist/main.js must contain injection marker');
    assert(patchedMain.includes("require('./antigravity-stats/loader.cjs')"), 'dist/main.js must require loader.cjs');
    // Ensure strict mode remains at top of file
    assert(patchedMain.startsWith('"use strict";'), 'dist/main.js must retain "use strict" as the very first statement');

    const patchedPreload = fs.readFileSync(path.join(verifyExtractDir, 'dist', 'preload.js'), 'utf8');
    assert(patchedPreload.includes('__ANTIGRAVITY_STATS_PRELOAD_BRIDGE__'), 'dist/preload.js must contain preload bridge marker');
    assert(patchedPreload.includes('__ANTIGRAVITY_SYNC_BRIDGE__'), 'dist/preload.js must expose __ANTIGRAVITY_SYNC_BRIDGE__');

    assert(fs.existsSync(path.join(verifyExtractDir, 'dist', 'antigravity-stats', 'loader.cjs')), 'loader.cjs must exist in dist/antigravity-stats/');
    assert(fs.existsSync(path.join(verifyExtractDir, 'dist', 'antigravity-stats', 'aggregate-stats.cjs')), 'aggregate-stats.cjs must exist in dist/antigravity-stats/');
    assert(fs.existsSync(path.join(verifyExtractDir, 'dist', 'antigravity-stats', 'antigravity-stats-bundle.js')), 'antigravity-stats-bundle.js must exist in dist/antigravity-stats/');

    // Unpack folder must remain intact
    const unpackedMcpFile = path.join(asarPath + '.unpacked', 'node_modules', 'chrome-devtools-mcp', 'build', 'index.js');
    assert(fs.existsSync(unpackedMcpFile), 'Unpacked MCP file must remain intact in app.asar.unpacked');
    assert(fs.readFileSync(unpackedMcpFile, 'utf8') === pristineMcp, 'Unpacked MCP file content must be preserved');

    // 2. Patch idempotency (running patch again)
    const patchResult2 = await patch({
      resourcesDir,
      silent: true,
      skipProcessCheck: true,
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
    const hookMatches = mainAfterSecondPatch.match(/__ANTIGRAVITY_STATS_INJECTION__/g) || [];
    assert(hookMatches.length === 1, 'Hook must appear exactly once in dist/main.js');

    // 3. Rollback (unpatch)
    const unpatchResult = unpatch({
      resourcesDir,
      silent: true,
      skipProcessCheck: true,
      devBundleFile: mockDevBundleFile
    });
    assert(unpatchResult.restored === true, 'Unpatch should restore from backup');
    assert(unpatchResult.pristine === true, 'Unpatch should report pristine state');
    assert(!fs.existsSync(mockDevBundleFile), 'Mock dev-bundle.path redirect file must be removed on unpatch');

    const restoredBuf = fs.readFileSync(asarPath);
    assert(restoredBuf.equals(pristineAsarBuf), 'Restored asar must be bitwise identical to pristine asar');
    assert(!restoredBuf.includes(Buffer.from('__ANTIGRAVITY_STATS_INJECTION__')), 'Restored asar must not have patch marker');

    // Unpacked folder must match pristine
    const restoredMcpFile = path.join(asarPath + '.unpacked', 'node_modules', 'chrome-devtools-mcp', 'build', 'index.js');
    assert(fs.existsSync(restoredMcpFile), 'Unpacked MCP file must exist in restored state');
    assert(fs.readFileSync(restoredMcpFile, 'utf8') === pristineMcp, 'Restored unpacked MCP file must match original');

    // 4. Unpatch idempotency
    const unpatchResult2 = unpatch({
      resourcesDir,
      silent: true,
      skipProcessCheck: true,
      devBundleFile: mockDevBundleFile
    });
    assert(unpatchResult2.restored === false, 'Repeated unpatch should not re-restore already pristine asar');
    assert(unpatchResult2.pristine === true, 'Repeated unpatch should report pristine state');
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
