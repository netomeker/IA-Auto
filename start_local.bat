@echo off
cd /d "%~dp0"
if "%AI_PROVIDER%"=="" set AI_PROVIDER=ollama
if "%LOCAL_MODEL%"=="" set LOCAL_MODEL=gemma3:4b
start "" http://127.0.0.1:3000
echo Modo AI: %AI_PROVIDER%
echo Modelo local padrao: %LOCAL_MODEL%
echo Este modo usa Ollama local por padrao (sem depender de credito NVIDIA).
node server.js
