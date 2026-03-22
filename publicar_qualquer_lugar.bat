@echo off
cd /d "%~dp0"
echo Iniciando backend + link publico...
node launch_public.js

if exist public_url.txt (
  for /f "usebackq delims=" %%u in ("public_url.txt") do set PUBLIC_URL=%%u
  if not "%PUBLIC_URL%"=="" (
    echo.
    echo Link publico:
    echo %PUBLIC_URL%
    start "" "%PUBLIC_URL%"
  )
)

echo.
echo Se fechar este terminal e os processos Node, o link para de funcionar.
pause
