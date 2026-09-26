@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0installer\windows\start-social-manager.ps1" -InstallDir "%~dp0"
