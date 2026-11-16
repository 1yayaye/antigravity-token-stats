#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { MARKER_IDE_MAIN_HOOK } = require('../../../src/injection-contract.cjs');

const assetNames = [
  'antigravity-stats-ide-bundle.js', 'quota-service.cjs', 'aggregate-stats.cjs',
  'injection-contract.cjs', 'loader.cjs',
];
const hook = Buffer.from(`// ${MARKER_IDE_MAIN_HOOK}\nimport './antitoken/loader.cjs';\n`);

function readTarget(options) {
  const selected = options.installDir || require('../../../scripts/proxy-manager.cjs').findIdeDir();
  if (!selected) throw new Error('Antigravity IDE was not found. Use --dir PATH.');
  const installDir = fs.realpathSync(selected);
  const appDir = path.join(installDir, 'resources', 'app');
  const manifest = JSON.parse(fs.readFileSync(path.join(appDir, 'package.json'), 'utf8'));
  if (manifest.name !== 'Antigravity IDE' || manifest.main !== './out/main.js' || manifest.type !== 'module') {
    throw new Error('Expected Antigravity IDE with an ES-module ./out/main.js; refusing to patch another app.');
  }
  const mainPath = path.join(appDir, 'out', 'main.js');
  const backupPath = `${mainPath}.antitoken-backup`;
  const targetAssets = path.join(appDir, 'out', 'antitoken');
  for (const file of [mainPath, backupPath, targetAssets, ...assetNames.map(name => path.join(targetAssets, name))]) {
    if (!fs.existsSync(file)) continue;
    const stat = fs.lstatSync(file);
    if (stat.isSymbolicLink() || (file === targetAssets ? !stat.isDirectory() : !stat.isFile())) {
      throw new Error(`Refusing to modify an unexpected file type: ${file}`);
    }
  }
  const current = fs.readFileSync(mainPath);
  const hasBackup = fs.existsSync(backupPath);
  const pristine = hasBackup ? fs.readFileSync(backupPath) : current;
  if (pristine.includes(MARKER_IDE_MAIN_HOOK) || pristine.includes('./antitoken/loader.cjs')) {
    throw new Error('The pristine backup is missing or already patched; refusing to overwrite it.');
  }
  const patched = Buffer.concat([hook, pristine]);
  if (!current.equals(pristine) && !current.equals(patched)) {
    throw new Error('main.js differs from both the pristine backup and the expected patch. Preserve the foreign changes first.');
  }
  return { installDir, mainPath, backupPath, targetAssets, current, pristine, patched, hasBackup };
}

function requireClosed(installDir) {
  if (process.platform !== 'win32') return;
  let processes;
  try {
    processes = JSON.parse(execFileSync('pwsh', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command',
      'ConvertTo-Json -Compress -InputObject @(Get-CimInstance Win32_Process -Filter "Name = \'Antigravity IDE.exe\'" -ErrorAction Stop | Select-Object ExecutablePath)',
    ], { encoding: 'utf8', windowsHide: true, timeout: 10000 }));
  } catch {
    throw new Error('Could not verify that Antigravity IDE is closed; no files were changed.');
  }
  const executable = path.join(installDir, 'Antigravity IDE.exe').toLowerCase();
  if (processes.some(item => !item.ExecutablePath || path.resolve(item.ExecutablePath).toLowerCase() === executable)) {
    throw new Error('Close Antigravity IDE before installing or removing Token Stats.');
  }
}

function writeAtomic(file, bytes) {
  const temporary = `${file}.antitoken-tmp`;
  fs.writeFileSync(temporary, bytes, { flag: 'wx' });
  try {
    fs.renameSync(temporary, file);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}

function patchIde(options = {}) {
  const target = readTarget(options);
  const assetsDir = options.assetsDir || path.join(__dirname, '..', 'dist');
  const assets = assetNames.map(name => [name, fs.readFileSync(path.join(assetsDir, name))]);
  if (!target.hasBackup && assetNames.some(name => fs.existsSync(path.join(target.targetAssets, name)))) {
    throw new Error('Unowned Token Stats assets exist without a pristine backup; refusing to overwrite them.');
  }
  requireClosed(target.installDir);
  if (!target.hasBackup) fs.copyFileSync(target.mainPath, target.backupPath, fs.constants.COPYFILE_EXCL);
  fs.mkdirSync(target.targetAssets, { recursive: true });
  for (const [name, bytes] of assets) writeAtomic(path.join(target.targetAssets, name), bytes);
  if (!target.current.equals(target.patched)) writeAtomic(target.mainPath, target.patched);
  return { installDir: target.installDir, patched: true, backupCreated: !target.hasBackup };
}

function unpatchIde(options = {}) {
  const target = readTarget(options);
  requireClosed(target.installDir);
  if (!target.hasBackup) return { installDir: target.installDir, restored: false };
  if (!target.current.equals(target.pristine)) writeAtomic(target.mainPath, target.pristine);
  for (const name of assetNames) fs.rmSync(path.join(target.targetAssets, name), { force: true });
  if (fs.existsSync(target.targetAssets) && fs.readdirSync(target.targetAssets).length === 0) fs.rmdirSync(target.targetAssets);
  // Keep the original backup across uninstall/reinstall; never silently re-baseline an app update.
  return { installDir: target.installDir, restored: true };
}

if (require.main === module) {
  try {
    const options = {};
    let uninstall = false;
    for (let i = 2; i < process.argv.length; i++) {
      const arg = process.argv[i];
      if (arg === '--uninstall') uninstall = true;
      else if (arg === '--dir' && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')) options.installDir = process.argv[++i];
      else throw new Error('Usage: node patch-ide.cjs [--uninstall] [--dir PATH]');
    }
    const result = uninstall ? unpatchIde(options) : patchIde(options);
    console.log(`[TokenStats IDE] ${uninstall ? 'Restored' : 'Installed'}: ${result.installDir}`);
  } catch (error) {
    console.error(`[TokenStats IDE] ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { patchIde, unpatchIde };
