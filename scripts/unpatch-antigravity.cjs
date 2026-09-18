const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

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

function unpatch(options = {}) {
  const silent = options.silent || false;
  const log = (...args) => { if (!silent) console.log(...args); };

  log('=== Unpatching Antigravity 2.0 Desktop ===');

  const resourcesDir = options.resourcesDir || getAntigravityResourcesDir();
  const asarPath = path.join(resourcesDir, 'app.asar');
  const backupPath = path.join(resourcesDir, 'app.asar.backup');

  let isModified = false;
  if (fs.existsSync(asarPath)) {
    try {
      const content = fs.readFileSync(asarPath);
      isModified = content.includes(Buffer.from('__ANTIGRAVITY_STATS_INJECTION__'));
    } catch (e) {
      // ignore read error
    }
  }

  if (!isModified && !fs.existsSync(backupPath)) {
    log('[Clean] app.asar is in pristine factory state. No patch detected.');
    return { restored: false, pristine: true };
  }

  if (!fs.existsSync(backupPath)) {
    log('[Warning] app.asar appears modified, but no backup file (app.asar.backup) was found.');
    return { restored: false, pristine: false };
  }

  log('[Restore] Restoring pristine app.asar from backup...');
  try {
    fs.copyFileSync(backupPath, asarPath);
  } catch (err) {
    if (err.code === 'EBUSY') {
      throw new Error('Cannot restore app.asar because Antigravity is currently running. Please close Antigravity and try again.');
    }
    throw err;
  }

  log('\n======================================================');
  log('✓ SUCCESS: Antigravity 2.0 app.asar has been restored to factory state.');
  log('======================================================\n');
  return { restored: true, pristine: true };
}

if (require.main === module) {
  try {
    unpatch();
  } catch (err) {
    console.error('[Unpatch Error]:', err.message);
    process.exit(1);
  }
}

module.exports = {
  getAntigravityResourcesDir,
  unpatch
};
