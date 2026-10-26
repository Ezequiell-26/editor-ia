@echo off
rem Actualiza Olyvia con el codigo actual del repo.
rem Doble clic en este archivo. La ventana queda abierta al terminar.

setlocal
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\actualizar-olyvia.ps1"

echo.
echo Presiona Enter para cerrar.
pause >nul
endlocal
