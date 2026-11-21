@echo off
cd /d "%~dp0"
if not exist GlideYT.exe powershell.exe -NoProfile -ExecutionPolicy Bypass -File apps\windows\build.ps1
if not exist GlideYT.exe exit /b 1
start "" "%~dp0GlideYT.exe"
