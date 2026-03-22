@echo off
cd /d "%~dp0"

if exist public_tunnel.pid (
  for /f "usebackq delims=" %%p in ("public_tunnel.pid") do set TPID=%%p
  if not "%TPID%"=="" (
    taskkill /PID %TPID% /F >nul 2>nul
  )
  del /q public_tunnel.pid >nul 2>nul
)

echo Link publico encerrado.
echo (Backend local pode continuar ativo na porta 3000.)
pause
