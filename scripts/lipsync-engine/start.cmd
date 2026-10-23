@echo off
rem Arranca el adaptador local de lip-sync para Editor IA.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start.ps1" %*
if errorlevel 1 pause
