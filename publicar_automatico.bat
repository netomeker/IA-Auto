@echo off
cd /d "%~dp0"
if "%AI_PROVIDER%"=="" set AI_PROVIDER=ollama
if "%LOCAL_MODEL%"=="" set LOCAL_MODEL=gemma3:4b
node scripts\keep-github-online-local.mjs
