@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0installer\windows\login-facebook.ps1" -InstallDir "%~dp0"
echo.
pause
