const esbuild = require('esbuild');
const fs = require('node:fs');
const path = require('node:path');
const { builtinModules } = require('node:module');

const root = path.resolve(__dirname, '..');
const host = path.join(root, 'hosts', 'antigravity-ide');
const output = path.join(host, 'dist');
fs.mkdirSync(output, { recursive: true });
esbuild.buildSync({
  entryPoints: [path.join(host, 'src', 'quota-service.ts')],
  outfile: path.join(output, 'quota-service.cjs'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  external: ['electron', ...builtinModules, 'node:*'],
  // Use Electron's network stack so the IDE's configured proxy applies to every request.
  banner: { js: 'const antitokenElectron = require("electron");' },
  define: { fetch: 'antitokenElectron.net.fetch' },
});
for (const [source, name] of [
  [path.join(host, 'scripts', 'loader.cjs'), 'loader.cjs'],
  [path.join(root, 'scripts', 'aggregate-stats.cjs'), 'aggregate-stats.cjs'],
  [path.join(root, 'src', 'injection-contract.cjs'), 'injection-contract.cjs'],
]) fs.copyFileSync(source, path.join(output, name));
console.log('[TokenStats IDE] Native host built in hosts/antigravity-ide/dist');
