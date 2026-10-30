#!/usr/bin/env node
process.noAsar = true;
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const { getAntigravityResourcesDir, isAntigravityRunning, getDevBundlePathFile } = require('./paths.cjs');
const contract = require('../../../src/injection-contract.cjs');

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
    if (fs.existsSync(tempTarget)) {
      try { fs.rmSync(tempTarget, { recursive: true, force: true }); } catch {}
    }
    if (targetInstalled && fs.existsSync(oldTarget)) {
      try { fs.rmSync(oldTarget, { recursive: true, force: true }); } catch {}
    }
  }
}

function unpatch(options = {}) {
  const silent = Boolean(options.silent);
  const log = (...args) => { if (!silent) console.log(...args); };

  log('======================================================');
  log('↺ Restoring Antigravity 2.0 to Factory State (Unpatch)');
  log('======================================================\n');

  if (isAntigravityRunning()) {
    if (options.killRunning) {
      log('Closing running Antigravity process...');
      try {
        execFileSync('taskkill', ['/F', '/IM', 'Antigravity.exe', '/T'], { stdio: 'ignore' });
      } catch {}
    } else if (!options.skipProcessCheck) {
      throw new Error('Cannot restore app.asar because Antigravity is currently running. Please close Antigravity and try again.');
    }
  }

  const resourcesDir = options.resourcesDir || getAntigravityResourcesDir();
  const asarPath = path.join(resourcesDir, 'app.asar');
  const backupPath = path.join(resourcesDir, 'app.asar.backup');

  let isModified = false;
  if (fs.existsSync(asarPath)) {
    try {
      const content = fs.readFileSync(asarPath);
      isModified = content.includes(Buffer.from(contract.MARKER_MAIN_HOOK));
    } catch (err) {
      isModified = true;
    }
  }

  // Clean dev-bundle.path redirect file if present
  if (!options.skipDevRedirect) {
    try {
      const devBundleFile = options.devBundleFile || getDevBundlePathFile();
      if (fs.existsSync(devBundleFile)) {
        fs.rmSync(devBundleFile, { force: true });
        log('   ✓ Removed dev-bundle redirect file');
      }
    } catch (e) {}
  }

  const backupExists = fs.existsSync(backupPath);

  if (!isModified) {
    if (!backupExists || (fs.existsSync(asarPath) && fs.readFileSync(asarPath).equals(fs.readFileSync(backupPath)))) {
      log('[Clean] app.asar is already in pristine factory state. No patch detected.');
      return { restored: false, pristine: true };
    }
  }

  if (!backupExists) {
    log('⚠️  [Warning] app.asar appears modified, but no backup file (app.asar.backup) was found.');
    return { restored: false, pristine: false };
  }

  log('[Restore] Restoring pristine app.asar from backup...');
  try {
    safeAtomicReplace(backupPath, asarPath);
    const backupUnpacked = backupPath + '.unpacked';
    const targetUnpacked = asarPath + '.unpacked';
    if (fs.existsSync(backupUnpacked)) {
      safeReplaceDirectory(backupUnpacked, targetUnpacked);
    } else if (fs.existsSync(targetUnpacked)) {
      try { fs.rmSync(targetUnpacked, { recursive: true, force: true }); } catch {}
    }
    try {
      const asar = require('@electron/asar');
      asar.uncacheAll();
    } catch (e) {}
  } catch (err) {
    if (err.code === 'EBUSY') {
      throw new Error('Cannot restore app.asar because Antigravity is currently running. Please close Antigravity and try again.');
    }
    throw err;
  }

  // Restore factory state by also removing proxy DLL and config if present
  try {
    const projectRoot = typeof __RELEASE_ROOT !== 'undefined'
      ? __RELEASE_ROOT
      : path.resolve(__dirname, '..', '..', '..');
    const candidates = [
      path.join(projectRoot, 'scripts', 'proxy-manager.cjs'),
      path.join(projectRoot, 'dist', 'proxy-manager.cjs'),
    ];
    let pm = null;
    for (const c of candidates) {
      if (fs.existsSync(c)) {
        pm = require(c);
        break;
      }
    }
    if (!pm) {
      pm = require('../../../scripts/proxy-manager.cjs');
    }
    pm.uninstallProxy('desktop');
    log('   ✓ Removed transparent proxy files from desktop');
  } catch {}

  log('\n======================================================');
  log('✓ SUCCESS: Antigravity 2.0 app.asar has been restored to factory state.');
  log('======================================================\n');
  return { restored: true, pristine: true };
}

if (require.main === module) {
  const cliOptions = {
    killRunning: process.argv.includes('--kill') || process.argv.includes('--force'),
    skipProcessCheck: process.argv.includes('--skip-process-check'),
  };
  try {
    unpatch(cliOptions);
  } catch (err) {
    console.error('\n❌ [Unpatch Error]:', err.message);
    process.exit(1);
  }
}

module.exports = {
  getAntigravityResourcesDir,
  isAntigravityRunning,
  safeAtomicReplace,
  safeReplaceDirectory,
  unpatch
};
