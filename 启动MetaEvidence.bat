@echo off
chcp 65001 >nul
set "APP_DIR=%~dp0"
set "PYTHON=C:\Users\ASUS\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe"

powershell.exe -NoProfile -WindowStyle Hidden -Command "$listener = Get-NetTCPConnection -LocalPort 8765 -State Listen -ErrorAction SilentlyContinue; if (-not $listener) { Start-Process -WindowStyle Hidden -FilePath '%PYTHON%' -ArgumentList 'meta_gateway.py','--port','8765','--host','127.0.0.1' -WorkingDirectory '%APP_DIR%' }"
timeout /t 1 /nobreak >nul
start "" "http://127.0.0.1:8765/?release=20260818c#dashboard"
exit /b 0
