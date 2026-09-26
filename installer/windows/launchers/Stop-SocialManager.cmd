@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0installer\windows\stop-social-manager.ps1" -InstallDir "%~dp0"
pause
