@echo off
rem Double-click this to push this machine's AI usage data to the Token Manager VPS.
rem Pass -Full to re-send everything: sync.bat -Full
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0sync-windows.ps1" %*
echo.
pause
