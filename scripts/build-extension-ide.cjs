/**
 * Bundles the Antigravity IDE extension host (extension/src/extension.ts) to a
 * single CommonJS file. esbuild is used instead of tsc emit because the source
 * type-imports from the repo's shared src/ (e.g. stats.types), which would
 * violate any tsc rootDir scoped to the host; type checking happens via the
 * root tsconfig (`npm run build`).
 */
const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const repoRoot = path.join(__dirname, '..');
const extensionRoot = path.join(repoRoot, 'hosts', 'antigravity-ide', 'extension');

esbuild.buildSync({
  entryPoints: [path.join(extensionRoot, 'src', 'extension.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'es2022',
  outfile: path.join(extensionRoot, 'out', 'extension.js'),
  external: ['vscode'],
  sourcemap: true,
});

// Bundle the aggregation engine next to the compiled host so an extension copied
// to ~/.antigravity-ide/extensions/ loads it without the repo around.
fs.copyFileSync(
  path.join(repoRoot, 'scripts', 'aggregate-stats.cjs'),
  path.join(extensionRoot, 'out', 'aggregate-stats.cjs'),
);
fs.copyFileSync(
  path.join(repoRoot, 'scripts', 'proxy-manager.cjs'),
  path.join(extensionRoot, 'out', 'proxy-manager.cjs'),
);
const extVendorDir = path.join(extensionRoot, 'vendor', 'proxy', 'win-x64');
fs.mkdirSync(extVendorDir, { recursive: true });
const srcVendorDir = path.join(repoRoot, 'vendor', 'proxy', 'win-x64');
if (fs.existsSync(srcVendorDir)) {
  fs.cpSync(srcVendorDir, extVendorDir, { recursive: true });
}
console.log('[TokenStats IDE] Extension host bundled to hosts/antigravity-ide/extension/out/extension.js');
