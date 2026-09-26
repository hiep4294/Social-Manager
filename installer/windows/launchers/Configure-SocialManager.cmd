@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0installer\windows\configure.ps1" -InstallDir "%~dp0"
echo.
pause
