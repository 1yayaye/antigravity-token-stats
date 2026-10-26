#!/usr/bin/env node
/**
 * Release Packaging Script for Antigravity Token Stats
 *
 * Produces a lightweight, self-contained ZIP archive for end-users:
 * - Pre-compiled web injection bundle
 * - Bundled standalone patcher & unpatcher
 * - Double-clickable install.cmd and uninstall.cmd
 * - Requires system Node.js 22.13+ to run the installer
 */

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const esbuild = require('esbuild');

const projectRoot = path.resolve(__dirname, '..');
const pkgPath = path.join(projectRoot, 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));

console.log('======================================================');
console.log(`📦 Packaging Release: ${pkg.name} v${pkg.version}`);
console.log('======================================================\n');

// 1. Build the injection bundle
console.log('[1/5] Building injection bundle via Vite...');
const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
execFileSync(npmCmd, ['run', 'build:bundle'], { cwd: projectRoot, stdio: 'inherit', shell: true });

const bundlePath = path.join(projectRoot, 'dist-bundle', 'antigravity-stats-bundle.js');
if (!fs.existsSync(bundlePath)) {
  throw new Error(`Expected bundle at ${bundlePath} after build:bundle.`);
}

// 2. Set up release staging directory
const distReleaseDir = path.join(projectRoot, 'dist-release');
const stagingDir = path.join(distReleaseDir, 'staging');

if (fs.existsSync(stagingDir)) {
  fs.rmSync(stagingDir, { recursive: true, force: true });
}
fs.mkdirSync(path.join(stagingDir, 'bin'), { recursive: true });
fs.mkdirSync(path.join(stagingDir, 'dist'), { recursive: true });

// 3. Bundle standalone patch & unpatch tools using esbuild
console.log('\n[2/5] Bundling standalone patch & unpatch binaries with esbuild...');
const esbuildBanner = 'process.noAsar = true;\nconst __import_meta_url = require("node:url").pathToFileURL(__filename).href;\n';
const esbuildDefine = { 'import.meta.url': '__import_meta_url' };

esbuild.buildSync({
  entryPoints: [path.join(__dirname, 'patch-antigravity.cjs')],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  outfile: path.join(stagingDir, 'bin', 'patch.cjs'),
  banner: { js: esbuildBanner },
  define: esbuildDefine
});

esbuild.buildSync({
  entryPoints: [path.join(__dirname, 'unpatch-antigravity.cjs')],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  outfile: path.join(stagingDir, 'bin', 'unpatch.cjs'),
  banner: { js: esbuildBanner },
  define: esbuildDefine
});

fs.copyFileSync(
  path.join(__dirname, 'setup-shortcut.cjs'),
  path.join(stagingDir, 'bin', 'setup-shortcut.cjs')
);

// 4. Copy runtime assets
console.log('[3/5] Copying runtime injection assets...');
fs.copyFileSync(bundlePath, path.join(stagingDir, 'dist', 'antigravity-stats-bundle.js'));
fs.copyFileSync(path.join(__dirname, 'loader.cjs'), path.join(stagingDir, 'dist', 'loader.cjs'));
fs.copyFileSync(path.join(__dirname, 'aggregate-stats.cjs'), path.join(stagingDir, 'dist', 'aggregate-stats.cjs'));

// 5. Generate release-tailored scripts
console.log('[4/5] Generating release installer scripts...');

const releaseInstallCmd = `@echo off
setlocal
where pwsh >nul 2>nul
if %errorlevel% equ 0 (
  pwsh -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1" %*
) else (
  PowerShell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1" %*
)
if errorlevel 1 (
  echo.
  echo Installation failed. See the message above.
  pause
  exit /b 1
)
echo.
echo Installation complete. You can close this window.
pause
`;

const releaseUninstallCmd = `@echo off
setlocal
where pwsh >nul 2>nul
if %errorlevel% equ 0 (
  pwsh -NoProfile -ExecutionPolicy Bypass -File "%~dp0uninstall.ps1" %*
) else (
  PowerShell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0uninstall.ps1" %*
)
if errorlevel 1 (
  echo.
  echo Uninstallation failed. See the message above.
  pause
  exit /b 1
)
echo.
echo Uninstallation complete. You can close this window.
pause
`;

const releaseInstallPs1 = `param(
  [switch]$Force
)

$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot

function Fail([string]$Message) {
  Write-Host "\`n[Install failed] $Message" -ForegroundColor Red
  exit 1
}

Write-Host "\`nAntigravity Token Stats — Release Installer" -ForegroundColor Cyan
Write-Host "============================================\`n"

# 1. Process Check
$running = Get-Process -Name Antigravity -ErrorAction SilentlyContinue
if ($running) {
  if ($Force) {
    Write-Host "Antigravity is running. Force closing..." -ForegroundColor Gray
    Stop-Process -Name Antigravity -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 1
  } else {
    Write-Host "Antigravity is currently running." -ForegroundColor Yellow
    $reply = Read-Host "Close Antigravity automatically to continue installation? (Y/n)"
    if ($reply -eq '' -or $reply -match '^[Yy]') {
      Write-Host "Closing Antigravity..." -ForegroundColor Gray
      Stop-Process -Name Antigravity -Force -ErrorAction SilentlyContinue
      Start-Sleep -Seconds 1
    } else {
      Fail "Installation aborted. Please close Antigravity and run installer again."
    }
  }
}

# 2. Require system Node.js 22.13+
$sysNode = Get-Command node -ErrorAction SilentlyContinue
if (-not $sysNode) {
  Fail "Node.js 22.13+ is required. Install it from https://nodejs.org/ and run the installer again."
}
try {
  $vStr = (& node -p "process.versions.node").Trim()
  if ([version]$vStr -lt [version]'22.13.0') {
    Fail "Node.js 22.13+ is required; found $vStr. Upgrade Node.js and run the installer again."
  }
  $nodeExe = $sysNode.Source
  Write-Host "✓ Using system Node.js ($vStr)" -ForegroundColor Green
} catch {
  Fail "Could not determine the installed Node.js version. Install Node.js 22.13+ and run the installer again."
}

function Run-Script([string]$scriptPath) {
  & $nodeExe $scriptPath
  if ($LASTEXITCODE -ne 0) {
    Fail "Execution of $scriptPath failed."
  }
}

# 3. Patch Antigravity
Write-Host "\`n[1/2] Patching Antigravity app.asar..." -ForegroundColor Yellow
Run-Script (Join-Path $PSScriptRoot "bin\\patch.cjs")

# 4. Create/Verify Shortcuts
Write-Host "[2/2] Updating Desktop and Start Menu shortcuts..." -ForegroundColor Yellow
Run-Script (Join-Path $PSScriptRoot "bin\\setup-shortcut.cjs")

Write-Host "\`n======================================================" -ForegroundColor Green
Write-Host "✓ Installation and patching complete!" -ForegroundColor Green
Write-Host "Open Antigravity and press Alt+T or go to Settings -> Usage Stats." -ForegroundColor Cyan
Write-Host "To restore pristine factory state at any time, run uninstall.cmd." -ForegroundColor Gray
Write-Host "======================================================\`n"

if (-not $Force) {
  $launch = Read-Host "Launch Antigravity now? (Y/n)"
  if ($launch -eq '' -or $launch -match '^[Yy]') {
    $exe = "$env:LOCALAPPDATA\\Programs\\antigravity\\Antigravity.exe"
    if (Test-Path $exe) {
      Start-Process $exe
    }
  }
}
`;

const releaseUninstallPs1 = `param(
  [switch]$Force
)

$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot

function Fail([string]$Message) {
  Write-Host "\`n[Uninstall failed] $Message" -ForegroundColor Red
  exit 1
}

Write-Host "\`nAntigravity Token Stats — Uninstaller" -ForegroundColor Cyan
Write-Host "======================================\`n"

$running = Get-Process -Name Antigravity -ErrorAction SilentlyContinue
if ($running) {
  if ($Force) {
    Write-Host "Closing Antigravity..." -ForegroundColor Gray
    Stop-Process -Name Antigravity -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 1
  } else {
    Write-Host "Antigravity is currently running." -ForegroundColor Yellow
    $reply = Read-Host "Close Antigravity automatically to restore factory state? (Y/n)"
    if ($reply -eq '' -or $reply -match '^[Yy]') {
      Write-Host "Closing Antigravity..." -ForegroundColor Gray
      Stop-Process -Name Antigravity -Force -ErrorAction SilentlyContinue
      Start-Sleep -Seconds 1
    } else {
      Fail "Uninstallation aborted. Please close Antigravity and try again."
    }
  }
}

# Require system Node.js 22.13+
$sysNode = Get-Command node -ErrorAction SilentlyContinue
if (-not $sysNode) {
  Fail "Node.js 22.13+ is required. Install it from https://nodejs.org/ and run the uninstaller again."
}
try {
  $vStr = (& node -p "process.versions.node").Trim()
  if ([version]$vStr -lt [version]'22.13.0') {
    Fail "Node.js 22.13+ is required; found $vStr. Upgrade Node.js and run the uninstaller again."
  }
  $nodeExe = $sysNode.Source
} catch {
  Fail "Could not determine the installed Node.js version. Install Node.js 22.13+ and run the uninstaller again."
}

Write-Host "[1/2] Restoring pristine factory app.asar..." -ForegroundColor Yellow
& $nodeExe (Join-Path $PSScriptRoot "bin\\unpatch.cjs")

if ($LASTEXITCODE -ne 0) {
  Fail "app.asar restore failed."
}

Write-Host "[2/2] Cleaning up Token Stats shortcuts..." -ForegroundColor Yellow
$shortcutLocations = @(
  [System.IO.Path]::Combine([System.Environment]::GetFolderPath("Desktop"), "Antigravity (with Stats).lnk"),
  [System.IO.Path]::Combine($env:APPDATA, "Microsoft\\Windows\\Start Menu\\Programs\\Antigravity (with Stats).lnk")
)
foreach ($sc in $shortcutLocations) {
  if (Test-Path $sc) {
    Remove-Item -Force $sc -ErrorAction SilentlyContinue
    Write-Host "   ✓ Removed: $sc" -ForegroundColor Gray
  }
}

Write-Host "\`n======================================================" -ForegroundColor Green
Write-Host "✓ Factory restore complete! Antigravity is unpatched." -ForegroundColor Green
Write-Host "======================================================\`n"
`;

const releaseReadme = `======================================================
Antigravity Token Stats v${pkg.version}
======================================================

【中文说明】
运行要求：Windows 系统需预装 Node.js 22.13+。
1. 安装：
   直接双击运行 "install.cmd" 即可完成自动安装与注入。
   若 Antigravity 正在运行，安装程序会提示并协助自动关闭。

2. 使用：
   启动 Antigravity 客户端后：
   - 快捷键：按下 Alt+T (macOS: Option+T) 随时呼出/隐藏统计面板
   - 菜单路径：在左侧设置菜单点击「Settings → Usage Stats」
   - 支持实时 Token 消耗统计、缓存命中率、周/月额度重置倒计时与价值折算

3. 卸载 / 还原出厂状态：
   随时双击运行 "uninstall.cmd"，即可 100% 恢复官方初始 app.asar 状态。

------------------------------------------------------

【English Instructions】
Requirement: Node.js 22.13+ must be installed on Windows.
1. Install:
   Double-click "install.cmd" to automatically patch your Antigravity client.
   If Antigravity is currently running, the installer will offer to close it safely.

2. Usage:
   Launch Antigravity:
   - Shortcut: Press Alt+T to toggle the stats dashboard.
   - Menu: Click Settings -> Usage Stats.

3. Uninstall:
   Double-click "uninstall.cmd" at any time to restore factory app.asar.

======================================================
`;

fs.writeFileSync(path.join(stagingDir, 'install.cmd'), releaseInstallCmd, 'utf8');
fs.writeFileSync(path.join(stagingDir, 'install.ps1'), releaseInstallPs1, 'utf8');
fs.writeFileSync(path.join(stagingDir, 'uninstall.cmd'), releaseUninstallCmd, 'utf8');
fs.writeFileSync(path.join(stagingDir, 'uninstall.ps1'), releaseUninstallPs1, 'utf8');
fs.writeFileSync(path.join(stagingDir, 'README.txt'), releaseReadme, 'utf8');

// 6. Compress into ZIP archive
console.log('\n[5/5] Compressing into release ZIP archive...');
const zipName = `antigravity-token-stats-v${pkg.version}.zip`;
const zipPath = path.join(distReleaseDir, zipName);

if (fs.existsSync(zipPath)) {
  fs.rmSync(zipPath, { force: true });
}

function getPowerShellCmd() {
  try {
    execFileSync('pwsh', ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.Major'], { stdio: 'ignore' });
    return 'pwsh';
  } catch {
    return 'powershell.exe';
  }
}

const psCmd = getPowerShellCmd();
const compressScript = `Compress-Archive -Path '${stagingDir}\\*' -DestinationPath '${zipPath}' -Force`;
execFileSync(psCmd, ['-NoProfile', '-NonInteractive', '-Command', compressScript], { stdio: 'inherit' });

// Clean staging directory
fs.rmSync(stagingDir, { recursive: true, force: true });

const stats = fs.statSync(zipPath);
const sizeKb = (stats.size / 1024).toFixed(1);

console.log('\n======================================================');
console.log(`✓ Release package created successfully!`);
console.log(`  File: ${zipPath}`);
console.log(`  Size: ${sizeKb} KB`);
console.log('======================================================\n');
