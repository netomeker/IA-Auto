# Deploy da Central IA (modo universal)

## 1) Rodar local
1. Abra terminal na pasta do projeto.
2. Configure sua chave NVIDIA (uma opção):
   - Criar arquivo `.env`:
     - `NVIDIA_API_KEY=SUA_CHAVE`
     - `NVIDIA_MODEL=deepseek-ai/deepseek-v3.2`
     - `PORT=3000`
   - Ou no PowerShell:
     - `$env:NVIDIA_API_KEY="SUA_CHAVE"`
3. Build do frontend:
   - `npm run build`
4. Inicie:
   - `npm start`
5. Abra: `http://127.0.0.1:3000`

## 2) Publicar para qualquer pessoa usar (recomendado)
Hospede o projeto completo (frontend + backend juntos) em um servico Node.
Assim qualquer pessoa entra no link e o chat ja funciona sem configurar nada.

### Config automatica (ja pronta)
O build agora gera automaticamente `public/config.js` e `config.js` com base nas variaveis:
- `PUBLIC_API_BASE_URL`
- `PUBLIC_MODEL`

Comandos utilitarios:
1. `npm run prepare:config`
2. `npm run check:health -- https://seu-dominio.com`

### Netlify (frontend + backend no mesmo dominio)
Este projeto agora ja vem com:
1. `netlify.toml`
2. funcoes em `netlify/functions` para:
   - `/api/health`
   - `/api/chat`
   - `/api/chat-stream`

Passos:
1. Suba no GitHub.
2. Conecte no Netlify.
3. Em **Site configuration > Environment variables**, adicione:
   - `NVIDIA_API_KEY = sua_chave_nvidia` (obrigatoria)
   - opcional: `NVIDIA_MODEL = deepseek-ai/deepseek-v3.2`
4. Deploy.
5. Teste:
   - `https://seu-site.netlify.app/api/health`
   - deve retornar `ok: true`.
   - opcional no terminal: `npm run check:health -- https://seu-site.netlify.app`

### Render (recomendado)
1. Suba este projeto no GitHub.
2. No Render, crie servico a partir do repositorio (o arquivo `render.yaml` ja esta pronto).
3. Defina variavel de ambiente:
   - `NVIDIA_API_KEY = sua_chave_nvidia` (obrigatoria)
4. Deploy.
5. Use a URL final, exemplo:
   - `https://seu-app.onrender.com`
6. Teste:
   - `GET https://seu-app.onrender.com/api/health`
   - Deve retornar `ok: true`.

## 3) Se quiser manter GitHub Pages
GitHub Pages hospeda apenas frontend. Nesse caso voce ainda precisa de backend publico separado.

1. Publique backend (Render/Railway/Fly/VM).
2. Edite `index.html` e preencha o bloco:
   - `window.CENTRAL_IA_CONFIG = { apiBaseUrl: "https://seu-backend.com" }`
3. Publique no GitHub Pages.

Sugestao pratica:
1. Publique o backend no Netlify deste mesmo projeto.
2. No GitHub Pages, use `apiBaseUrl` apontando para esse dominio Netlify.

### GitHub Pages automatico (ja pronto neste projeto)
Este projeto ja inclui workflow: `.github/workflows/deploy-pages.yml`.

1. Suba no GitHub.
2. Em **Settings > Pages**, selecione **GitHub Actions**.
3. Em **Settings > Secrets and variables > Actions > Variables**, crie:
   - `PUBLIC_API_BASE_URL` = URL publica do backend (ex: `https://seu-app.onrender.com`)
   - opcional: `PUBLIC_MODEL` = modelo padrao
4. Faça push na branch `main` (ou `master`).
5. O frontend vai para GitHub Pages com a API publica configurada.
6. Teste saude da API:
   - `npm run check:health -- https://sua-api.com`

Importante:
1. Sem `PUBLIC_API_BASE_URL`, o frontend no Pages nao consegue acessar IA com PC desligado.
2. O backend precisa responder `GET /api/health` com `ok: true`.

## 4) Seguranca recomendada
- Nao exponha chave no frontend.
- Use apenas `NVIDIA_API_KEY` no backend.
- Se quiser restringir uso, adicione autenticacao no endpoint `/api/chat-stream`.

## 5) Endpoints disponiveis
- `POST /api/chat` (resposta completa)
- `POST /api/chat-stream` (stream em tempo real)
- `GET /api/health`

## 6) Erro comum: HTTP 405 em `127.0.0.1:5500`
Isso acontece quando o frontend esta aberto em servidor estatico (Live Server) sem backend Node nessa mesma porta.

Como corrigir:
1. Rode o backend:
   - `node server.js`
2. Abra:
   - `http://127.0.0.1:3000`
3. Se quiser continuar no Live Server, mantenha backend rodando na 3000.

## 7) Checklist rapido para deploy 100% funcional
1. `NVIDIA_API_KEY` configurada no host (Render/Railway/etc).
2. URL publica responde:
   - `GET /api/health` com `ok: true`.
3. Frontend e backend no mesmo dominio (recomendado), ou `apiBaseUrl` no `index.html`.
4. Testar envio no chat em aba anonima (sem cache/localStorage antigo).

## 8) Regra de seguranca para producao
1. Nao use chave no frontend.
2. Mantenha `NVIDIA_API_KEY` apenas no backend.
3. Compartilhe apenas a URL publica do site.

## 9) Link publico imediato (qualquer lugar)
Para abrir um link publico direto do seu PC:

1. Execute `publicar_qualquer_lugar.bat`
2. O link sera salvo em `public_url.txt`
3. Compartilhe esse link

Observacoes:
1. O PC precisa ficar ligado com o Node rodando.
2. Para encerrar o link, execute `parar_link_publico.bat`.
