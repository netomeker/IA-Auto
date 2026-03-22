@echo off
cd /d "%~dp0"
start "" http://127.0.0.1:3000
echo Dica: o servidor le .env automaticamente (NVIDIA_API_KEY).
echo Alternativa: set NVIDIA_API_KEY=sua_chave
node server.js
