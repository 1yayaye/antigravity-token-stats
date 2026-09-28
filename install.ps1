$ErrorActionPreference = 'Stop'

Set-Location -LiteralPath $PSScriptRoot

function Fail([string]$Message) {
  Write-Host "`n[Install failed] $Message" -ForegroundColor Red
  exit 1
}

Write-Host "`nAntigravity Token Stats installer" -ForegroundColor Cyan
Write-Host "Project: $PSScriptRoot`n"

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

Write-Host "[3/3] Creating the Antigravity (with Stats) shortcut..." -ForegroundColor Yellow
& $npm.Source run setup:shortcut
if ($LASTEXITCODE -ne 0) { Fail 'Shortcut creation failed.' }

Write-Host "`nInstallation complete." -ForegroundColor Green
Write-Host 'Use the new desktop shortcut, or run: npm run launch'
Write-Host 'If Antigravity is installed somewhere unusual, set ANTIGRAVITY_EXE to its .exe path.'
