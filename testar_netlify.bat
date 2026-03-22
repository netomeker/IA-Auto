@echo off
setlocal
cd /d "%~dp0"

echo ==========================================
echo  Testar deploy do Netlify
echo ==========================================
echo.
echo Cole sua URL do Netlify (sem /api/health no final)
echo Exemplo: https://central-ia-exemplo.netlify.app
set /p SITE_URL=URL do site: 

if "%SITE_URL%"=="" (
  echo URL nao informada. Encerrando.
  pause
  exit /b 1
)

npm run check:health -- "%SITE_URL%"
if errorlevel 1 (
  echo.
  echo API ainda nao respondeu ok=true.
  echo Verifique NVIDIA_API_KEY no Netlify.
  pause
  exit /b 1
)

echo.
echo Deploy validado com sucesso.
pause

