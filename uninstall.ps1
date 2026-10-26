$ErrorActionPreference = 'Stop'

Set-Location -LiteralPath $PSScriptRoot

function Fail([string]$Message) {
  Write-Host "`n[Uninstall failed] $Message" -ForegroundColor Red
  exit 1
}

Write-Host "`nAntigravity Token Stats Uninstaller" -ForegroundColor Cyan
Write-Host "Project: $PSScriptRoot`n"

# 1. Check if Antigravity is running
$running = Get-Process -Name Antigravity -ErrorAction SilentlyContinue
if ($running) {
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

# 2. Run unpatch script
Write-Host "[1/2] Restoring pristine factory app.asar..." -ForegroundColor Yellow
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  Fail "Node.js was not found to execute unpatch script."
}

& $node.Source "$PSScriptRoot\scripts\unpatch-antigravity.cjs"
if ($LASTEXITCODE -ne 0) {
  Fail "app.asar restore failed."
}

# 3. Clean shortcuts
Write-Host "[2/2] Cleaning up Token Stats shortcuts..." -ForegroundColor Yellow
$shortcutName = "Antigravity (with Stats).lnk"
$desktopDir = [System.Environment]::GetFolderPath("Desktop")
$startMenuDir = [System.IO.Path]::Combine($env:APPDATA, "Microsoft\Windows\Start Menu\Programs")

$shortcuts = @(
  [System.IO.Path]::Combine($desktopDir, $shortcutName),
  [System.IO.Path]::Combine($startMenuDir, $shortcutName)
)

foreach ($sc in $shortcuts) {
  if (Test-Path $sc) {
    Remove-Item -Force $sc -ErrorAction SilentlyContinue
    Write-Host "   ✓ Removed: $sc" -ForegroundColor Gray
  }
}

Write-Host "`n======================================================" -ForegroundColor Green
Write-Host "✓ Factory restore complete! Antigravity is unpatched." -ForegroundColor Green
Write-Host "======================================================`n"
