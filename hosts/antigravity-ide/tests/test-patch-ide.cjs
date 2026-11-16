const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const vm = require('node:vm');
const { patchIde, unpatchIde } = require('../scripts/patch-ide.cjs');
const { MARKER_IDE_MAIN_HOOK } = require('../../../src/injection-contract.cjs');

// Exercise launch arguments and closed-process refusal without patching or starting any real app.
function launcherScenario(port, patchError) {
  const calls = [];
  const processStub = { env: port === undefined ? {} : { ANTIGRAVITY_IDE_CDP_PORT: port }, exitCode: 0 };
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../../../scripts/dev-ide.cjs'), 'utf8'), {
    process: processStub,
    console: { log() {}, error() {} },
    require(name) {
      if (name === 'node:path') return path;
      if (name === './proxy-manager.cjs') return { findIdeDir: () => 'C:/Fixture IDE' };
      if (name === '../hosts/antigravity-ide/scripts/patch-ide.cjs') return {
        patchIde(options) {
          calls.push({ type: 'patch', installDir: options.installDir });
          if (patchError) throw patchError;
          return options;
        },
      };
      if (name === 'node:child_process') return {
        spawn(executable, args, options) {
          calls.push({ type: 'spawn', executable, args: Array.from(args), shell: options.shell });
          return { once(event, callback) { if (event === 'spawn') callback(); }, unref() {} };
        },
      };
      throw new Error(`Unexpected launcher dependency: ${name}`);
    },
  });
  return { calls, status: processStub.exitCode };
}
const launched = launcherScenario('9222');
assert.equal(launched.status, 0);
assert.deepEqual(launched.calls.map(call => call.type), ['patch', 'spawn']);
assert.equal(launched.calls[1].executable, path.join('C:/Fixture IDE', 'Antigravity IDE.exe'));
assert.deepEqual(launched.calls[1].args, ['--remote-debugging-port=9222']);
assert.equal(launched.calls[1].shell, false);
assert.deepEqual(launcherScenario().calls[1].args, []);
assert.equal(launcherScenario('9222; echo unsafe').calls.length, 0, 'invalid port cannot reach patch or spawn');
const refused = launcherScenario(undefined, new Error('Close IDE first'));
assert.equal(refused.status, 1);
assert.equal(refused.calls.length, 1, 'failed installation never launches the app');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'antitoken-ide-patch-'));
const installDir = path.join(root, 'IDE');
const app = path.join(installDir, 'resources', 'app');
const main = path.join(app, 'out', 'main.js');
const backup = `${main}.antitoken-backup`;
const installedAssets = path.join(app, 'out', 'antitoken');
const assetsDir = path.join(root, 'assets');
const options = { installDir, assetsDir };
const names = ['loader.cjs', 'quota-service.cjs', 'aggregate-stats.cjs', 'injection-contract.cjs', 'antigravity-stats-ide-bundle.js'];
const pristine = Buffer.concat([
  Buffer.from('\ufeff// native ESM fixture\r\n'),
  Buffer.alloc(13 * 1024 * 1024, 32),
  Buffer.from('\r\nexport const original = true;\r\n'),
]);
fs.mkdirSync(path.dirname(main), { recursive: true });
fs.mkdirSync(assetsDir);
const manifest = { name: 'Antigravity IDE', main: './out/main.js', type: 'module' };
const writeManifest = value => fs.writeFileSync(path.join(app, 'package.json'), JSON.stringify(value));
writeManifest(manifest);
fs.writeFileSync(main, pristine);
for (const name of names) fs.writeFileSync(path.join(assetsDir, name), `// first ${name}\n`);

try {
  assert.equal(patchIde(options).backupCreated, true);
  assert.deepEqual(fs.readFileSync(backup), pristine, 'backup preserves all original bytes');
  const patched = fs.readFileSync(main);
  assert.equal(patched.toString().split(MARKER_IDE_MAIN_HOOK).length - 1, 1);
  const hook = Buffer.from(`// ${MARKER_IDE_MAIN_HOOK}\nimport './antitoken/loader.cjs';\n`);
  assert.deepEqual(patched, Buffer.concat([hook, pristine]));
  assert.equal(spawnSync(process.execPath, ['--check', main], { encoding: 'utf8' }).status, 0, 'prefixed ESM remains valid');
  fs.writeFileSync(path.join(assetsDir, 'loader.cjs'), '// updated loader\n');
  assert.equal(patchIde(options).backupCreated, false);
  assert.deepEqual(fs.readFileSync(main), patched, 'repeat install does not duplicate hook');
  assert.deepEqual(fs.readFileSync(backup), pristine, 'repeat install never overwrites backup');
  assert.equal(fs.readFileSync(path.join(installedAssets, 'loader.cjs'), 'utf8'), '// updated loader\n');
  fs.writeFileSync(path.join(installedAssets, 'unrelated.txt'), 'keep');
  fs.writeFileSync(main, Buffer.concat([patched, Buffer.from('// foreign change\n')]));
  const foreign = fs.readFileSync(main);
  assert.throws(() => patchIde(options), /differs from both/);
  assert.throws(() => unpatchIde(options), /differs from both/);
  assert.deepEqual(fs.readFileSync(main), foreign, 'foreign edits are preserved');
  assert.deepEqual(fs.readFileSync(backup), pristine);
  fs.writeFileSync(main, patched);
  unpatchIde(options);
  assert.deepEqual(fs.readFileSync(main), pristine, 'uninstall restores exact native bytes');
  assert.equal(fs.readFileSync(path.join(installedAssets, 'unrelated.txt'), 'utf8'), 'keep');
  for (const name of names) assert.equal(fs.existsSync(path.join(installedAssets, name)), false);
  unpatchIde(options);
  patchIde(options);
  unpatchIde(options);
  assert.deepEqual(fs.readFileSync(main), pristine, 'reinstall and repeated uninstall remain reversible');
  writeManifest({ ...manifest, name: 'Antigravity' });
  assert.throws(() => patchIde(options), /refusing to patch another app/);
  assert.throws(() => unpatchIde(options), /refusing to patch another app/);
  writeManifest({ ...manifest, main: 'dist/main.js' });
  assert.throws(() => patchIde(options), /refusing to patch another app/);
  writeManifest({ ...manifest, main: 'out/main.js' });
  assert.throws(() => patchIde(options), /refusing to patch another app/);
  writeManifest({ ...manifest, type: 'commonjs' });
  assert.throws(() => patchIde(options), /refusing to patch another app/);
  writeManifest(manifest);
  fs.unlinkSync(backup);
  fs.unlinkSync(path.join(assetsDir, 'loader.cjs'));
  assert.throws(() => patchIde(options), /ENOENT/);
  assert.equal(fs.existsSync(backup), false, 'missing build assets do not create a backup');
  fs.writeFileSync(path.join(assetsDir, 'loader.cjs'), '// rebuilt loader\n');
  fs.writeFileSync(main, patched);
  assert.throws(() => patchIde(options), /pristine backup is missing or already patched/);
  assert.throws(() => unpatchIde(options), /pristine backup is missing or already patched/);
  assert.deepEqual(fs.readFileSync(main), patched);
  fs.writeFileSync(main, pristine);
  fs.writeFileSync(path.join(installedAssets, 'loader.cjs'), '// unowned\n');
  assert.throws(() => patchIde(options), /Unowned Token Stats assets/);
  assert.equal(fs.existsSync(backup), false);
  assert.deepEqual(fs.readFileSync(main), pristine);
  assert.equal(unpatchIde(options).restored, false, 'uninstall without backup leaves unowned assets alone');
  assert.equal(fs.readFileSync(path.join(installedAssets, 'loader.cjs'), 'utf8'), '// unowned\n');
  fs.unlinkSync(path.join(installedAssets, 'loader.cjs'));
  fs.mkdirSync(path.join(installedAssets, 'loader.cjs'));
  assert.throws(() => patchIde(options), /unexpected file type/);
  assert.equal(fs.existsSync(backup), false, 'file-type collisions fail before backup or mutation');
  console.log('IDE patch fixtures passed: exact rollback, repeat install, asset update, foreign-edit and wrong-app protection.');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
