@echo off
setlocal
cd /d "%~dp0"

if not exist auto_sync.pid (
  echo Nenhum auto-sync ativo (auto_sync.pid nao encontrado).
  goto :eof
)

set /p PID=<auto_sync.pid
if "%PID%"=="" (
  echo PID invalido.
  goto :cleanup
)

echo Encerrando processo %PID%...
taskkill /PID %PID% /F >nul 2>&1
if errorlevel 1 (
  echo Nao foi possivel encerrar PID %PID% (talvez ja tenha parado).
) else (
  echo Auto-sync encerrado.
)

:cleanup
del /f /q auto_sync.pid >nul 2>&1
endlocal
