@echo off
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
