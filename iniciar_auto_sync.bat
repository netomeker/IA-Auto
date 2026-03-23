@echo off
setlocal
cd /d "%~dp0"

echo Iniciando auto-sync em background...
start "CentralIA Auto Sync" /min node scripts\auto-sync-public-endpoint.mjs
echo OK. Use parar_auto_sync.bat para encerrar.

endlocal
