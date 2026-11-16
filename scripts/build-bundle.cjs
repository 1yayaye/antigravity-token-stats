/**
 * Builds the desktop injection bundles: the main stats bundle plus the optional
 * Chinese translation pack. Two invocations are required because Vite's lib mode
 * supports a single entry per build; running the main bundle first (it empties
 * dist-bundle/) keeps the zh-pack from being wiped.
 */
const { spawnSync } = require('child_process');
const path = require('path');

const repoRoot = path.join(__dirname, '..');
// vite's exports map does not expose ./bin/vite.js, so walk up from the resolved
// package entry to the package root (its package.json) and join the CLI bin.
const pkgJson = require.resolve('vite/package.json');
const viteBin = path.join(path.dirname(pkgJson), 'bin', 'vite.js');

for (const hostTarget of ['antigravity', 'antigravity-zh-pack']) {
  const result = spawnSync(
    process.execPath,
    [viteBin, 'build', '--config', path.join(repoRoot, 'vite.bundle.config.ts')],
    {
      stdio: 'inherit',
      cwd: repoRoot,
      env: { ...process.env, HOST_TARGET: hostTarget },
    }
  );
  if (result.status !== 0) {
    process.exitCode = result.status ?? 1;
    break;
  }
}
