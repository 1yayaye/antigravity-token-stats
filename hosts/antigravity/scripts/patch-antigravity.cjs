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
const { getAntigravityResourcesDir, findAntigravityExe, isAntigravityRunning, getDevBundlePathFile } = require('./paths.cjs');
const contract = require('../../../src/injection-contract.cjs');

function safeAtomicReplace(sourceFile, targetFile) {
  const tempTarget = `${targetFile}.tmp.${Date.now()}`;
  try {
    fs.copyFileSync(sourceFile, tempTarget);
    try {
      fs.renameSync(tempTarget, targetFile);
    } catch (renameErr) {
      if (renameErr.code === 'EBUSY' || renameErr.code === 'EPERM') {
        fs.copyFileSync(sourceFile, targetFile);
      } else {
        throw renameErr;
      }
    }
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

  // Two layouts call this code: the repo checkout (three levels below the project
  // root) and the release ZIP (esbuild-bundled to <zip>/bin/, where the banner from
  // package-release.cjs defines __RELEASE_ROOT as the ZIP root).
  const projectRoot = typeof __RELEASE_ROOT !== 'undefined'
    ? __RELEASE_ROOT
    : path.resolve(__dirname, '..', '..', '..');

  const bundleCandidates = [
    options.bundlePath,
    path.join(projectRoot, 'dist-bundle', 'antigravity-stats-bundle.js'),
    path.join(projectRoot, 'dist', 'antigravity-stats-bundle.js')
  ].filter(Boolean);
  const bundlePath = bundleCandidates.find(p => fs.existsSync(p)) || bundleCandidates[0];

  const loaderCandidates = [
    options.loaderSource,
    path.join(__dirname, 'loader.cjs'),
    path.join(projectRoot, 'dist', 'loader.cjs')
  ].filter(Boolean);
  const loaderSource = loaderCandidates.find(p => fs.existsSync(p)) || loaderCandidates[0];

  const aggregateCandidates = [
    options.aggregateSource,
    path.join(projectRoot, 'scripts', 'aggregate-stats.cjs'),
    path.join(projectRoot, 'dist', 'aggregate-stats.cjs')
  ].filter(Boolean);
  const aggregateSource = aggregateCandidates.find(p => fs.existsSync(p)) || aggregateCandidates[0];

  const pathsSourceCandidates = [
    path.join(__dirname, 'paths.cjs'),
    path.join(projectRoot, 'dist', 'paths.cjs')
  ];
  const pathsSource = pathsSourceCandidates.find(p => fs.existsSync(p)) || pathsSourceCandidates[0];

  const contractSourceCandidates = [
    path.join(projectRoot, 'src', 'injection-contract.cjs'),
    path.join(projectRoot, 'dist', 'injection-contract.cjs')
  ];
  const contractSource = contractSourceCandidates.find(p => fs.existsSync(p)) || contractSourceCandidates[0];

  const proxyCandidates = [
    options.proxyManagerSource,
    path.join(projectRoot, 'scripts', 'proxy-manager.cjs'),
    path.join(projectRoot, 'dist', 'proxy-manager.cjs')
  ].filter(Boolean);
  const proxyManagerSource = proxyCandidates.find(p => fs.existsSync(p)) || proxyCandidates[0];

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

  if (!fs.existsSync(proxyManagerSource)) {
    throw new Error(`Proxy manager script not found at: ${proxyManagerSource}`);
  }

  // Backup protection
  const initialContent = fs.readFileSync(asarPath);
  const alreadyModified = initialContent.includes(Buffer.from(contract.MARKER_MAIN_HOOK));

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
    if (!mainContent.includes(contract.MARKER_MAIN_HOOK)) {
      const mainHook = `\n// ${contract.MARKER_MAIN_HOOK}\ntry { require('./antigravity-stats/loader.cjs'); } catch (e) { console.error('[TokenStats Loader Error]:', e); }\n`;
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
    if (!preloadContent.includes(contract.MARKER_PRELOAD_BRIDGE)) {
      const preloadHook = `
// ${contract.MARKER_PRELOAD_BRIDGE}
try {
  const _electron = require('electron');
  const _cb = _electron.contextBridge || (typeof electron_1 !== 'undefined' ? electron_1.contextBridge : null);
  const _ipc = _electron.ipcRenderer || (typeof electron_1 !== 'undefined' ? electron_1.ipcRenderer : null);
  if (_cb && _ipc) {
    _cb.exposeInMainWorld('${contract.WINDOW_SYNC_BRIDGE}', {
      requestSync: (payload) => _ipc.invoke('${contract.IPC_REQUEST_SYNC}', payload),
    });
  }
} catch (e) {
  try {
    electron_1.contextBridge.exposeInMainWorld('${contract.WINDOW_SYNC_BRIDGE}', {
      requestSync: (payload) => electron_1.ipcRenderer.invoke('${contract.IPC_REQUEST_SYNC}', payload),
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
    fs.copyFileSync(pathsSource, path.join(statsDir, 'paths.cjs'));
    fs.copyFileSync(contractSource, path.join(statsDir, 'injection-contract.cjs'));
    fs.copyFileSync(proxyManagerSource, path.join(statsDir, 'proxy-manager.cjs'));
    fs.copyFileSync(bundlePath, path.join(statsDir, 'antigravity-stats-bundle.js'));
    log('   ✓ Copied loader, aggregate engine, proxy manager, and UI bundle into dist/antigravity-stats/');

    // Record DX redirect
    if (!options.skipDevRedirect) {
      try {
        const devBundleFile = options.devBundleFile || getDevBundlePathFile();
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
    if (!verifyBuf.includes(Buffer.from(contract.MARKER_MAIN_HOOK))) {
      throw new Error(`Repacked asar does not contain ${contract.MARKER_MAIN_HOOK} marker`);
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

    const shouldInstallProxy = options.withProxy !== false && !process.argv.includes('--no-proxy');
    if (shouldInstallProxy) {
      try {
        const proxyManager = require(proxyManagerSource);
        const port = Number(options.proxyPort || 7890);
        const type = options.proxyType || 'socks5';
        proxyManager.installProxy('desktop', { port, type, skipProcessCheck: true });
        log(`   ✓ Transparent proxy deployed alongside Antigravity.exe (${type}://127.0.0.1:${port})`);
      } catch (err) {
        log(`   ⚠️ Proxy installation skipped: ${err.message}`);
      }
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
  const cliOptions = {
    killRunning: process.argv.includes('--kill') || process.argv.includes('--force'),
    skipProcessCheck: process.argv.includes('--skip-process-check'),
    withProxy: !process.argv.includes('--no-proxy'),
    proxyPort: (process.argv.find(a => a.startsWith('--proxy-port=')) || '').split('=')[1] || undefined,
    proxyType: (process.argv.find(a => a.startsWith('--proxy-type=')) || '').split('=')[1] || undefined,
  };
  patch(cliOptions).catch(err => {
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
