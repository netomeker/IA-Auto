@echo off
cd /d "%~dp0"
if "%AI_PROVIDER%"=="" set AI_PROVIDER=ollama
if "%LOCAL_MODEL%"=="" set LOCAL_MODEL=gemma3:4b
echo Iniciando modo manter online no GitHub Pages...
echo.
echo Link do seu site:
echo https://netomeker.github.io/IA-Auto/
echo.
echo Deixe este terminal aberto para manter funcionando com PC ligado.
echo.
start "" "https://netomeker.github.io/IA-Auto/"
node scripts\keep-github-online-local.mjs
echo.
echo Processo encerrado.
pause
