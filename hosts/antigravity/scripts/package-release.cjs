#!/usr/bin/env node
/**
 * Release Packaging Script for Antigravity Token Stats
 *
 * Produces a single zero-dependency Windows GUI installer (.exe):
 * - Builds the production injection bundle
 * - Exports contract & proxy template from single-source JS modules
 * - Compiles the C# WinForms (net48) standalone installer with embedded assets
 * - Outputs ONLY the .exe into dist-release/
 */

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const projectRoot = path.resolve(__dirname, '..', '..', '..');
const pkgPath = path.join(projectRoot, 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));

console.log('======================================================');
console.log(`📦 Packaging Release (.exe only): ${pkg.name} v${pkg.version}`);
console.log('======================================================\n');

// 1. Prepare embedded assets (builds bundle + exports contract.json + proxy template)
console.log('[1/3] Preparing embedded installer assets...');
const prepareScript = path.join(projectRoot, 'hosts', 'antigravity', 'installer-gen', 'prepare-assets.cjs');
const prepareArgs = [prepareScript];
if (process.argv.includes('--skip-bundle')) {
  prepareArgs.push('--skip-bundle');
}
execFileSync(process.execPath, prepareArgs, { cwd: projectRoot, stdio: 'inherit' });

// 2. Build the C# WinForms single-file installer
console.log('\n[2/3] Compiling AntiTokenSetup.exe (net48 WinForms)...');
const csprojPath = path.join(projectRoot, 'hosts', 'antigravity', 'installer', 'AntiTokenSetup.csproj');
execFileSync(
  'dotnet',
  ['build', csprojPath, '-c', 'Release', `-p:Version=${pkg.version}`],
  { cwd: projectRoot, stdio: 'inherit' }
);

const compiledExe = path.join(projectRoot, 'hosts', 'antigravity', 'installer', 'bin', 'Release', 'net48', 'AntiTokenSetup.exe');
if (!fs.existsSync(compiledExe)) {
  throw new Error(`Expected compiled installer at ${compiledExe}`);
}

// 3. Output ONLY the .exe to dist-release/
console.log('\n[3/3] Writing release artifact to dist-release/...');
const distReleaseDir = path.join(projectRoot, 'dist-release');
fs.rmSync(distReleaseDir, { recursive: true, force: true });
fs.mkdirSync(distReleaseDir, { recursive: true });

const exeName = `antigravity-token-stats-v${pkg.version}-setup.exe`;
const releaseExePath = path.join(distReleaseDir, exeName);
fs.copyFileSync(compiledExe, releaseExePath);

const stats = fs.statSync(releaseExePath);
const sizeMb = (stats.size / (1024 * 1024)).toFixed(2);

console.log('\n======================================================');
console.log('✓ Release installer created successfully!');
console.log(`  File: ${releaseExePath}`);
console.log(`  Size: ${sizeMb} MB`);
console.log('======================================================\n');
