@echo off
cd /d "%~dp0"
if "%AI_PROVIDER%"=="" set AI_PROVIDER=auto
if "%LOCAL_MODEL%"=="" set LOCAL_MODEL=gemma3:4b
echo Iniciando backend + link publico...
node launch_public.js

if exist public_url.txt (
  for /f "usebackq delims=" %%u in ("public_url.txt") do set PUBLIC_URL=%%u
  if not "%PUBLIC_URL%"=="" (
    echo.
    echo Link publico:
    echo %PUBLIC_URL%
    start "" "%PUBLIC_URL%"

    echo.
    echo Sincronizando URL no GitHub Pages...
    node scripts\sync-github-pages-url.mjs "%PUBLIC_URL%"
    if errorlevel 1 (
      echo Falha ao sincronizar no GitHub. O link publico direto ainda funciona.
    )
  )
)

echo.
echo Se fechar este terminal e os processos Node, o link para de funcionar.
pause
