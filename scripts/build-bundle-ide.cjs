/**
 * Runs the shared bundle build with HOST_TARGET=antigravity-ide so the webview
 * bundle lands in hosts/antigravity-ide/extension/media/. Exists because npm
 * scripts go through cmd.exe on Windows, where `ENV=x command` is not valid
 * shell syntax.
 */
const { spawnSync } = require('child_process');
const path = require('path');

const repoRoot = path.join(__dirname, '..');
// vite's exports map does not expose ./bin/vite.js, so walk up from the resolved
// package entry to the package root (its package.json) and join the CLI bin.
const pkgJson = require.resolve('vite/package.json');
const viteBin = path.join(path.dirname(pkgJson), 'bin', 'vite.js');
const result = spawnSync(
  process.execPath,
  [viteBin, 'build', '--config', path.join(repoRoot, 'vite.bundle.config.ts')],
  {
    stdio: 'inherit',
    cwd: repoRoot,
    env: { ...process.env, HOST_TARGET: 'antigravity-ide' },
  }
);
process.exitCode = result.status ?? 1;
