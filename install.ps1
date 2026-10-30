param(
  [switch]$Dev,
  [switch]$Force,
  [switch]$NoProxy,
  [int]$ProxyPort = 7890,
  [string]$ProxyType = 'socks5'
)

$ErrorActionPreference = 'Stop'

Set-Location -LiteralPath $PSScriptRoot

function Fail([string]$Message) {
  Write-Host "`n[Install failed] $Message" -ForegroundColor Red
  exit 1
}

Write-Host "`nAntigravity Token Stats installer (app.asar Native Patch)" -ForegroundColor Cyan
Write-Host "Project: $PSScriptRoot`n"

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
      Fail "Installation aborted. Please close Antigravity and run the installer again."
    }
  }
}

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  Fail 'Node.js 22.13+ is required. Install it from https://nodejs.org/ and run this installer again.'
}

try {
  $nodeVersion = (& node -p "process.versions.node").Trim()
  $version = [version]$nodeVersion
} catch {
  Fail 'Could not read the installed Node.js version.'
}

if ($version -lt [version]'22.13.0') {
  Fail "Node.js $nodeVersion was found, but Node.js 22.13+ is required. Update it from https://nodejs.org/."
}

$npm = Get-Command npm.cmd -ErrorAction SilentlyContinue
if (-not $npm) {
  Fail 'npm was not found. Reinstall Node.js 22.13+ and make sure npm is on PATH.'
}

Write-Host "[1/3] Installing dependencies..." -ForegroundColor Yellow
& $npm.Source install --no-audit --no-fund
if ($LASTEXITCODE -ne 0) { Fail 'npm install failed.' }

Write-Host "[2/3] Building the injection bundle..." -ForegroundColor Yellow
& $npm.Source run build:bundle
if ($LASTEXITCODE -ne 0) { Fail 'The bundle build failed.' }

Write-Host "[3/3] Patching Antigravity app.asar..." -ForegroundColor Yellow
$patchArgs = @()
if ($NoProxy) {
  $patchArgs += "--no-proxy"
} else {
  $patchArgs += "--proxy-port=$ProxyPort"
  $patchArgs += "--proxy-type=$ProxyType"
}
& $npm.Source run patch -- $patchArgs
if ($LASTEXITCODE -ne 0) { Fail 'app.asar patch failed. Make sure Antigravity is closed before installing.' }

if ($Dev) {
  Write-Host "   ⚡ Setting up Dev Bundle redirect link..." -ForegroundColor Cyan
  $antiTokenDir = Join-Path $env:LOCALAPPDATA 'AntiToken'
  if (-not (Test-Path $antiTokenDir)) {
    New-Item -ItemType Directory -Path $antiTokenDir -Force | Out-Null
  }
  $bundlePath = Join-Path $PSScriptRoot 'dist-bundle\antigravity-stats-bundle.js'
  Set-Content -Path (Join-Path $antiTokenDir 'dev-bundle.path') -Value $bundlePath -Force
  Write-Host "   ✓ Dev mode active: rebuilds will reload automatically in Antigravity." -ForegroundColor Green
}

# Clean up any legacy redundant shortcuts
$legacyShortcuts = @(
  [System.IO.Path]::Combine([System.Environment]::GetFolderPath("Desktop"), "Antigravity (with Stats).lnk"),
  [System.IO.Path]::Combine($env:APPDATA, "Microsoft\Windows\Start Menu\Programs\Antigravity (with Stats).lnk")
)
foreach ($sc in $legacyShortcuts) {
  if (Test-Path $sc) {
    Remove-Item -Force $sc -ErrorAction SilentlyContinue
  }
}

Write-Host "`n======================================================" -ForegroundColor Green
Write-Host "✓ Installation and patching complete!" -ForegroundColor Green
Write-Host "Launch Antigravity normally from your existing shortcut or taskbar."
Write-Host "Press Alt+T or open Settings -> Usage Stats to view dashboard."
Write-Host "To restore original factory state at any time, run:"
Write-Host "  npm run unpatch  (or double-click uninstall.cmd)"
Write-Host "======================================================`n"
