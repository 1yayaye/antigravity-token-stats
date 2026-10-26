#!/usr/bin/env node
process.noAsar = true;
/**
 * Antigravity 2.0 ASAR Patcher
 * Programmatically patches app.asar using @electron/asar with factory backup and rollback safety.
 */

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const asar = require('@electron/asar');

function getAntigravityResourcesDir() {
  if (process.env.ANTIGRAVITY_RESOURCES && fs.existsSync(process.env.ANTIGRAVITY_RESOURCES)) {
    return process.env.ANTIGRAVITY_RESOURCES;
  }

  const candidates = [
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Programs', 'antigravity', 'resources') : null,
    path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'antigravity', 'resources'),
    process.env.PROGRAMFILES ? path.join(process.env.PROGRAMFILES, 'Antigravity', 'resources') : null,
    process.env['PROGRAMFILES(X86)'] ? path.join(process.env['PROGRAMFILES(X86)'], 'Antigravity', 'resources') : null,
    'C:\\Program Files\\Antigravity\\resources',
    'C:\\Program Files (x86)\\Antigravity\\resources'
  ].filter(Boolean);

  for (const dir of candidates) {
    if (fs.existsSync(dir)) return dir;
  }

  return path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'antigravity', 'resources');
}

function findAntigravityExe() {
  if (process.env.ANTIGRAVITY_EXE && fs.existsSync(process.env.ANTIGRAVITY_EXE)) {
    return process.env.ANTIGRAVITY_EXE;
  }
  const resDir = getAntigravityResourcesDir();
  const exeInParent = path.join(path.dirname(resDir), 'Antigravity.exe');
  if (fs.existsSync(exeInParent)) return exeInParent;
  const candidates = [
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Programs', 'antigravity', 'Antigravity.exe') : null,
    path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'antigravity', 'Antigravity.exe'),
    process.env.PROGRAMFILES ? path.join(process.env.PROGRAMFILES, 'Antigravity', 'Antigravity.exe') : null,
    process.env['PROGRAMFILES(X86)'] ? path.join(process.env['PROGRAMFILES(X86)'], 'Antigravity', 'Antigravity.exe') : null
  ].filter(Boolean);
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  throw new Error('Antigravity.exe not found');
}

function isAntigravityRunning() {
  if (process.platform !== 'win32') return false;
  try {
    const out = execFileSync('tasklist', ['/FI', 'IMAGENAME eq Antigravity.exe', '/FO', 'CSV', '/NH'], { encoding: 'utf8' });
    return out.toLowerCase().includes('antigravity.exe');
  } catch {
    return false;
  }
}

function safeAtomicReplace(sourceFile, targetFile) {
  const tempTarget = `${targetFile}.tmp.${Date.now()}`;
  try {
    fs.copyFileSync(sourceFile, tempTarget);
    fs.renameSync(tempTarget, targetFile);
  } finally {
    if (fs.existsSync(tempTarget)) {
      try { fs.rmSync(tempTarget, { force: true }); } catch {}
    }
  }
}

function safeReplaceDirectory(sourceDir, targetDir) {
  const tempTarget = `${targetDir}.tmp.${Date.now()}`;
  const oldTarget = `${targetDir}.old.${Date.now()}`;
  let targetMoved = false;
  let targetInstalled = false;
  try {
    fs.cpSync(sourceDir, tempTarget, { recursive: true, force: true });
    if (fs.existsSync(targetDir)) {
      fs.renameSync(targetDir, oldTarget);
      targetMoved = true;
    }
    fs.renameSync(tempTarget, targetDir);
    targetInstalled = true;
  } catch (err) {
    try {
      if (targetInstalled && fs.existsSync(targetDir)) fs.rmSync(targetDir, { recursive: true, force: true });
      if (targetMoved && fs.existsSync(oldTarget)) fs.renameSync(oldTarget, targetDir);
    } catch {}
    throw err;
  } finally {
    if (targetInstalled && fs.existsSync(oldTarget)) {
      try { fs.rmSync(oldTarget, { recursive: true, force: true }); } catch {}
    }
    if (fs.existsSync(tempTarget)) {
      try { fs.rmSync(tempTarget, { recursive: true, force: true }); } catch {}
    }
  }
}

async function patch(options = {}) {
  const silent = Boolean(options.silent);
  const log = (...args) => { if (!silent) console.log(...args); };

  log('======================================================');
  log('🔧 Patching Antigravity 2.0 Desktop (app.asar)');
  log('======================================================\n');

  const resourcesDir = options.resourcesDir || getAntigravityResourcesDir();
  const asarPath = path.join(resourcesDir, 'app.asar');
  const backupPath = path.join(resourcesDir, 'app.asar.backup');
  const projectRoot = path.resolve(__dirname, '..');

  const bundleCandidates = [
    options.bundlePath,
    path.join(projectRoot, 'dist-bundle', 'antigravity-stats-bundle.js'),
    path.join(projectRoot, 'dist', 'antigravity-stats-bundle.js'),
    path.join(__dirname, '..', 'dist', 'antigravity-stats-bundle.js')
  ].filter(Boolean);
  const bundlePath = bundleCandidates.find(p => fs.existsSync(p)) || bundleCandidates[0];

  const loaderCandidates = [
    options.loaderSource,
    path.join(__dirname, 'loader.cjs'),
    path.join(projectRoot, 'dist', 'loader.cjs'),
    path.join(__dirname, '..', 'dist', 'loader.cjs')
  ].filter(Boolean);
  const loaderSource = loaderCandidates.find(p => fs.existsSync(p)) || loaderCandidates[0];

  const aggregateCandidates = [
    options.aggregateSource,
    path.join(__dirname, 'aggregate-stats.cjs'),
    path.join(projectRoot, 'dist', 'aggregate-stats.cjs'),
    path.join(__dirname, '..', 'dist', 'aggregate-stats.cjs')
  ].filter(Boolean);
  const aggregateSource = aggregateCandidates.find(p => fs.existsSync(p)) || aggregateCandidates[0];

  if (isAntigravityRunning()) {
    if (options.killRunning) {
      log('Closing running Antigravity process...');
      try {
        execFileSync('taskkill', ['/F', '/IM', 'Antigravity.exe', '/T'], { stdio: 'ignore' });
      } catch {}
    } else if (!options.skipProcessCheck) {
      throw new Error('Antigravity is currently running. Please close Antigravity before applying the patch to avoid file lock (EBUSY) errors.');
    }
  }

  if (!fs.existsSync(asarPath)) {
    throw new Error(`Target app.asar not found at: ${asarPath}`);
  }

  if (!fs.existsSync(bundlePath)) {
    throw new Error(`Token Stats bundle not found at: ${bundlePath}\nPlease run "npm run build:bundle" first.`);
  }

  if (!fs.existsSync(loaderSource)) {
    throw new Error(`Loader script not found at: ${loaderSource}`);
  }

  if (!fs.existsSync(aggregateSource)) {
    throw new Error(`Aggregate stats script not found at: ${aggregateSource}`);
  }

  // Backup protection
  const initialContent = fs.readFileSync(asarPath);
  const alreadyModified = initialContent.includes(Buffer.from('__ANTIGRAVITY_STATS_INJECTION__'));

  let backupCreated = false;
  if (!fs.existsSync(backupPath)) {
    if (alreadyModified) {
      log('⚠️  Notice: app.asar is already modified and no factory backup was found.');
    } else {
      log('[1/5] Creating factory backup: app.asar.backup...');
      fs.copyFileSync(asarPath, backupPath);
      const initialUnpacked = asarPath + '.unpacked';
      const backupUnpacked = backupPath + '.unpacked';
      if (fs.existsSync(initialUnpacked) && !fs.existsSync(backupUnpacked)) {
        fs.cpSync(initialUnpacked, backupUnpacked, { recursive: true, force: true });
      }
      backupCreated = true;
      log('   ✓ Factory backup saved.');
    }
  } else {
    log('[1/5] Verified existing factory backup: app.asar.backup');
  }

  // Temporary working directory
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'antigravity-patch-'));
  const extractDir = path.join(tempDir, 'extracted');

  try {
    log('[2/5] Extracting app.asar package...');
    asar.extractAll(asarPath, extractDir);

    log('[3/5] Injecting Token Stats modules & hooks...');
    // Hook dist/main.js
    const mainFile = path.join(extractDir, 'dist', 'main.js');
    if (!fs.existsSync(mainFile)) {
      throw new Error(`Expected dist/main.js in extracted archive at: ${mainFile}`);
    }
    let mainContent = fs.readFileSync(mainFile, 'utf8');
    if (!mainContent.includes('__ANTIGRAVITY_STATS_INJECTION__')) {
      const mainHook = "\n// __ANTIGRAVITY_STATS_INJECTION__\ntry { require('./antigravity-stats/loader.cjs'); } catch (e) { console.error('[TokenStats Loader Error]:', e); }\n";
      const strictMatch = mainContent.match(/^(\s*['"]use strict['"];?\r?\n?)/);
      if (strictMatch) {
        mainContent = strictMatch[0] + mainHook + mainContent.slice(strictMatch[0].length);
      } else {
        mainContent = mainHook + mainContent;
      }
      fs.writeFileSync(mainFile, mainContent, 'utf8');
      log('   ✓ Injected main process hook into dist/main.js');
    } else {
      log('   ✓ dist/main.js already contains hook');
    }

    // Hook dist/preload.js
    const preloadFile = path.join(extractDir, 'dist', 'preload.js');
    if (!fs.existsSync(preloadFile)) {
      throw new Error(`Expected dist/preload.js in extracted archive at: ${preloadFile}`);
    }
    let preloadContent = fs.readFileSync(preloadFile, 'utf8');
    if (!preloadContent.includes('__ANTIGRAVITY_STATS_PRELOAD_BRIDGE__')) {
      const preloadHook = `
// __ANTIGRAVITY_STATS_PRELOAD_BRIDGE__
try {
  const _electron = require('electron');
  const _cb = _electron.contextBridge || (typeof electron_1 !== 'undefined' ? electron_1.contextBridge : null);
  const _ipc = _electron.ipcRenderer || (typeof electron_1 !== 'undefined' ? electron_1.ipcRenderer : null);
  if (_cb && _ipc) {
    _cb.exposeInMainWorld('__ANTIGRAVITY_SYNC_BRIDGE__', {
      requestSync: (payload) => _ipc.invoke('antigravity:request-sync', payload),
    });
  }
} catch (e) {
  try {
    electron_1.contextBridge.exposeInMainWorld('__ANTIGRAVITY_SYNC_BRIDGE__', {
      requestSync: (payload) => electron_1.ipcRenderer.invoke('antigravity:request-sync', payload),
    });
  } catch (err) {}
}
`;
      preloadContent = preloadContent + preloadHook;
      fs.writeFileSync(preloadFile, preloadContent, 'utf8');
      log('   ✓ Injected contextBridge IPC bridge into dist/preload.js');
    } else {
      log('   ✓ dist/preload.js already contains preload bridge');
    }

    // Injected dist/antigravity-stats/ directory
    const statsDir = path.join(extractDir, 'dist', 'antigravity-stats');
    fs.mkdirSync(statsDir, { recursive: true });
    fs.copyFileSync(loaderSource, path.join(statsDir, 'loader.cjs'));
    fs.copyFileSync(aggregateSource, path.join(statsDir, 'aggregate-stats.cjs'));
    fs.copyFileSync(bundlePath, path.join(statsDir, 'antigravity-stats-bundle.js'));
    log('   ✓ Copied loader, aggregate engine, and UI bundle into dist/antigravity-stats/');

    // Record DX redirect
    if (!options.skipDevRedirect) {
      try {
        const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
        const defaultDevBundleFile = path.join(localAppData, 'AntiToken', 'dev-bundle.path');
        const devBundleFile = options.devBundleFile || defaultDevBundleFile;
        fs.mkdirSync(path.dirname(devBundleFile), { recursive: true });
        fs.writeFileSync(devBundleFile, bundlePath, 'utf8');
        log(`   ✓ Configured dev-bundle redirect: ${bundlePath}`);
      } catch (e) {
        log(`   ⚠️ Failed to set dev-bundle.path: ${e.message}`);
      }
    }

    // Repack asar
    log('[4/5] Repacking app.asar (unpacking chrome-devtools-mcp)...');
    const newAsarPath = path.join(tempDir, 'app.asar');
    await asar.createPackageWithOptions(extractDir, newAsarPath, {
      unpack: '**/chrome-devtools-mcp/**'
    });

    // Verification
    const minSize = options.minAsarSize !== undefined ? options.minAsarSize : 1024 * 1024 * 3;
    const stat = fs.statSync(newAsarPath);
    if (stat.size < minSize) {
      throw new Error(`Generated asar size (${stat.size} bytes) is below minimum threshold (${minSize} bytes)`);
    }

    const verifyBuf = fs.readFileSync(newAsarPath);
    if (!verifyBuf.includes(Buffer.from('__ANTIGRAVITY_STATS_INJECTION__'))) {
      throw new Error('Repacked asar does not contain __ANTIGRAVITY_STATS_INJECTION__ marker');
    }
    log(`   ✓ Repacked archive validated (${(stat.size / 1024 / 1024).toFixed(2)} MB)`);

    // Safe atomic replacement
    log('[5/5] Applying patched app.asar...');
    try {
      safeAtomicReplace(newAsarPath, asarPath);
      const newUnpacked = newAsarPath + '.unpacked';
      const targetUnpacked = asarPath + '.unpacked';
      if (fs.existsSync(newUnpacked)) {
        safeReplaceDirectory(newUnpacked, targetUnpacked);
      }
      asar.uncacheAll();
    } catch (err) {
      if (err.code === 'EBUSY') {
        throw new Error('Failed to replace app.asar because Antigravity is currently running. Please close Antigravity and retry.');
      }
      throw err;
    }

    log('\n======================================================');
    log('✓ SUCCESS: Antigravity 2.0 has been successfully patched!');
    log('  Launch Antigravity normally via desktop shortcut or:');
    log('  npm run launch');
    log('======================================================\n');

    return {
      patched: true,
      backupCreated,
      asarPath
    };
  } finally {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  }
}

if (require.main === module) {
  patch().catch(err => {
    console.error('\n❌ [Patch Error]:', err.message || err);
    process.exit(1);
  });
}

module.exports = {
  getAntigravityResourcesDir,
  findAntigravityExe,
  isAntigravityRunning,
  safeAtomicReplace,
  safeReplaceDirectory,
  patch
};
