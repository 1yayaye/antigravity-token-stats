#!/usr/bin/env node
/**
 * Prepares embedded assets for the C# single-file GUI installer (AntiTokenSetup.exe).
 * Reads contract constants from src/injection-contract.cjs and proxy config template
 * from scripts/proxy-manager.cjs so C# never duplicates JS/CJS single-source facts.
 */

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const projectRoot = path.resolve(__dirname, '..', '..', '..');
const pkg = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
const contract = require(path.join(projectRoot, 'src', 'injection-contract.cjs'));
const { buildConfig } = require(path.join(projectRoot, 'scripts', 'proxy-manager.cjs'));

const skipBundle = process.argv.includes('--skip-bundle');
const bundlePath = path.join(projectRoot, 'dist-bundle', 'antigravity-stats-bundle.js');

if (!skipBundle || !fs.existsSync(bundlePath)) {
  console.log('[prepare-assets] Building antigravity-stats-bundle.js...');
  const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  execFileSync(npmCmd, ['run', 'build:bundle'], {
    cwd: projectRoot,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
}

if (!fs.existsSync(bundlePath)) {
  throw new Error(`Expected bundle at ${bundlePath}`);
}

const outDir = path.join(projectRoot, 'hosts', 'antigravity', 'installer', 'EmbeddedAssets');
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

// 1. Export contract + package version
const contractPayload = {
  version: pkg.version,
  ...contract,
};
fs.writeFileSync(
  path.join(outDir, 'contract.json'),
  JSON.stringify(contractPayload, null, 2),
  'utf8'
);

// 2. Export baseline proxy config template from proxy-manager.cjs
const proxyTemplate = buildConfig({ port: 7890, type: 'socks5', host: '127.0.0.1' });
fs.writeFileSync(
  path.join(outDir, 'proxy-config-template.json'),
  JSON.stringify(proxyTemplate, null, 2),
  'utf8'
);

// 3. Copy runtime injection scripts, bundle, and proxy DLL
const filesToCopy = [
  { src: bundlePath, name: 'antigravity-stats-bundle.js' },
  { src: path.join(projectRoot, 'hosts', 'antigravity', 'scripts', 'loader.cjs'), name: 'loader.cjs' },
  { src: path.join(projectRoot, 'scripts', 'aggregate-stats.cjs'), name: 'aggregate-stats.cjs' },
  { src: path.join(projectRoot, 'hosts', 'antigravity', 'scripts', 'paths.cjs'), name: 'paths.cjs' },
  { src: path.join(projectRoot, 'src', 'injection-contract.cjs'), name: 'injection-contract.cjs' },
  { src: path.join(projectRoot, 'scripts', 'proxy-manager.cjs'), name: 'proxy-manager.cjs' },
  { src: path.join(projectRoot, 'vendor', 'proxy', 'win-x64', 'version.dll'), name: 'version.dll' },
];

for (const item of filesToCopy) {
  if (!fs.existsSync(item.src)) {
    throw new Error(`Missing required installer asset: ${item.src}`);
  }
  fs.copyFileSync(item.src, path.join(outDir, item.name));
}

console.log(`[prepare-assets] Prepared ${filesToCopy.length + 2} assets for v${pkg.version} in ${outDir}`);
