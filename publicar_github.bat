@echo off
setlocal
cd /d "%~dp0"

echo ==========================================
echo  Publicar projeto no GitHub
echo ==========================================
echo.
echo Cole a URL HTTPS do seu repositorio vazio.
echo Exemplo: https://github.com/SEU_USUARIO/central-ia.git
set /p REPO_URL=URL do repositorio: 

if "%REPO_URL%"=="" (
  echo URL nao informada. Encerrando.
  pause
  exit /b 1
)

git rev-parse --is-inside-work-tree >nul 2>&1
if errorlevel 1 (
  echo Erro: esta pasta nao e um repositorio git.
  pause
  exit /b 1
)

git remote get-url origin >nul 2>&1
if errorlevel 1 (
  git remote add origin "%REPO_URL%"
) else (
  git remote set-url origin "%REPO_URL%"
)

git branch -M main
git push -u origin main
if errorlevel 1 (
  echo.
  echo Falha no push.
  echo Se pedir login, complete no navegador e rode este arquivo novamente.
  pause
  exit /b 1
)

echo.
echo Sucesso! Codigo enviado para GitHub.
pause

