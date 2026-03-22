const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const DIST_ROOT = path.join(ROOT, 'dist');
loadEnvFile(path.join(ROOT, '.env'));

const HOST = process.env.HOST || '0.0.0.0';
const PORT = Number(process.env.PORT || 3000);

const DEFAULT_MODEL = process.env.NVIDIA_MODEL || 'deepseek-ai/deepseek-v3.2';
const NVIDIA_ENDPOINT = 'https://integrate.api.nvidia.com/v1/chat/completions';

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8'
};

function cacheControlForExt(ext) {
  if (ext === '.html') return 'no-cache';
  if (ext === '.css' || ext === '.js') return 'public, max-age=86400';
  if (ext === '.json' || ext === '.map') return 'public, max-age=3600';
  if (ext === '.png' || ext === '.jpg' || ext === '.jpeg' || ext === '.svg' || ext === '.ico') {
    return 'public, max-age=604800, immutable';
  }
  return 'public, max-age=900';
}

function staticHeaders(contentType, ext) {
  return {
    'Content-Type': contentType,
    'Cache-Control': cacheControlForExt(ext),
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin'
  };
}

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return;
  }

  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    raw.split(/\r?\n/).forEach((line) => {
      const trimmed = String(line || '').trim();
      if (!trimmed || trimmed.startsWith('#')) {
        return;
      }

      const separator = trimmed.indexOf('=');
      if (separator <= 0) {
        return;
      }

      const key = trimmed.slice(0, separator).trim();
      let value = trimmed.slice(separator + 1).trim();

      if (!key || process.env[key] !== undefined) {
        return;
      }

      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith('\'') && value.endsWith('\''))
      ) {
        value = value.slice(1, -1);
      }

      process.env[key] = value;
    });
  } catch (error) {
    console.log(`Aviso: não foi possível ler .env (${error.message}).`);
  }
}

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept');
}

function sendJson(res, status, payload) {
  setCors(res);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

function sendSseHeaders(res) {
  setCors(res);
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
}

function sendSseEvent(res, eventName, payload) {
  const safeEvent = String(eventName || 'message').replace(/[^a-zA-Z0-9_-]/g, '');
  res.write(`event: ${safeEvent}\n`);
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function cleanApiKey(raw) {
  const value = String(raw || '').trim();
  if (!value) return '';
  return value.replace(/^Authorization\s*:\s*/i, '').replace(/^Bearer\s+/i, '').trim();
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';

    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 1024 * 1024) {
        reject(new Error('Payload muito grande.'));
        req.destroy();
      }
    });

    req.on('end', () => {
      if (!data) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(data));
      } catch (_error) {
        reject(new Error('JSON inválido.'));
      }
    });

    req.on('error', reject);
  });
}

function resolveStaticFile(urlPath) {
  let decodedPath = '/';

  try {
    decodedPath = decodeURIComponent(String(urlPath || '/').split('?')[0] || '/');
  } catch (_error) {
    return null;
  }

  const target = decodedPath === '/' ? 'index.html' : decodedPath.replace(/^\/+/, '');
  const normalized = path.normalize(target);
  const roots = [DIST_ROOT, ROOT].filter((dir, index, list) => list.indexOf(dir) === index);

  for (const baseDir of roots) {
    const rootPath = path.resolve(baseDir);
    const absolute = path.resolve(rootPath, normalized);
    const insideRoot = absolute === rootPath || absolute.startsWith(`${rootPath}${path.sep}`);
    if (!insideRoot) {
      continue;
    }

    if (fs.existsSync(absolute)) {
      const stats = fs.statSync(absolute);
      if (stats.isFile()) {
        return absolute;
      }
    }
  }

  const spaFallbacks = [
    path.join(DIST_ROOT, 'index.html'),
    path.join(ROOT, 'index.html')
  ];

  for (const fallback of spaFallbacks) {
    if (fs.existsSync(fallback)) {
      return fallback;
    }
  }

  return null;
}

function sanitizeHistory(input) {
  if (!Array.isArray(input)) {
    return [];
  }

  return input
    .filter((item) => item && (item.role === 'user' || item.role === 'assistant') && typeof item.content === 'string')
    .slice(-8)
    .map((item) => ({ role: item.role, content: item.content }));
}

function textFromMixed(value) {
  if (typeof value === 'string') {
    return value;
  }

  if (Array.isArray(value)) {
    return value
      .map((part) => {
        if (typeof part === 'string') return part;
        if (part && typeof part.text === 'string') return part.text;
        if (part && typeof part.content === 'string') return part.content;
        return '';
      })
      .join('');
  }

  return '';
}

function firstTextCandidate(candidates) {
  for (const candidate of candidates) {
    const text = textFromMixed(candidate);
    if (text) {
      return text;
    }
  }

  return '';
}

function extractAssistantText(payload) {
  const choice = Array.isArray(payload?.choices) ? payload.choices[0] : null;
  const message = choice?.message || {};

  return firstTextCandidate([
    message.content,
    message.reasoning_content,
    message.thinking,
    choice?.text,
    payload?.content
  ]).trim();
}

function extractDeltaText(payload) {
  const choice = Array.isArray(payload?.choices) ? payload.choices[0] : null;
  const delta = choice?.delta || choice?.message || {};

  return firstTextCandidate([
    delta.content,
    delta.reasoning_content,
    delta.thinking,
    choice?.text,
    payload?.content
  ]);
}

function parseMaybeJson(raw) {
  try {
    return JSON.parse(raw);
  } catch (_error) {
    return null;
  }
}

function buildSystemPrompt(body) {
  const base = 'Voce e um assistente pratico e objetivo para produtividade profissional. Se perguntarem quem e o criador deste chat, responda exatamente: "O criador deste chat e netin do roi."';
  const contextProfile = String(body?.contextProfile || '').trim();
  if (!contextProfile) {
    return base;
  }
  return `${base}\n\nContexto de trabalho do usuario:\n${contextProfile}`;
}

function buildNvidiaPayload(body, message, history, stream) {
  return {
    model: String(body.model || DEFAULT_MODEL).trim(),
    messages: [
      { role: 'system', content: buildSystemPrompt(body) },
      ...history,
      { role: 'user', content: message }
    ],
    temperature: Number(body.temperature ?? 0.7),
    top_p: Number(body.top_p ?? 0.95),
    max_tokens: Number(body.max_tokens ?? 2048),
    seed: Number(body.seed ?? 42),
    stream,
    chat_template_kwargs: {
      thinking: Boolean(body.thinking ?? false)
    }
  };
}

function buildUpstreamHeaders(apiKey) {
  return {
    Authorization: `Bearer ${apiKey}`,
    Accept: 'application/json',
    'Content-Type': 'application/json'
  };
}

function validatePayload(body) {
  const message = String(body.message || '').trim();
  const history = sanitizeHistory(body.history);
  const serverApiKey = cleanApiKey(process.env.NVIDIA_API_KEY || '');
  const clientApiKey = cleanApiKey(body.apiKey || '');
  const apiKey = serverApiKey || clientApiKey;

  if (!message) {
    return { ok: false, error: 'Mensagem vazia.' };
  }

  if (!apiKey) {
    return { ok: false, error: 'API key não configurada no backend (NVIDIA_API_KEY).' };
  }

  return {
    ok: true,
    message,
    history,
    apiKey,
    model: String(body.model || DEFAULT_MODEL).trim() || DEFAULT_MODEL
  };
}

async function handleChat(req, res) {
  try {
    const body = await readJsonBody(req);
    const validation = validatePayload(body);

    if (!validation.ok) {
      sendJson(res, 400, { ok: false, error: validation.error });
      return;
    }

    const payload = buildNvidiaPayload(body, validation.message, validation.history, false);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120000);

    try {
      const upstream = await fetch(NVIDIA_ENDPOINT, {
        method: 'POST',
        headers: buildUpstreamHeaders(validation.apiKey),
        body: JSON.stringify(payload),
        signal: controller.signal
      });

      if (!upstream.ok) {
        const text = await upstream.text();
        sendJson(res, upstream.status, { ok: false, error: text || `Erro HTTP ${upstream.status}` });
        return;
      }

      const data = await upstream.json();
      const answer = extractAssistantText(data);

      if (!answer) {
        sendJson(res, 502, { ok: false, error: 'Resposta vazia da NVIDIA.' });
        return;
      }

      sendJson(res, 200, {
        ok: true,
        answer,
        provider: 'nvidia',
        model: validation.model
      });
    } finally {
      clearTimeout(timeout);
    }
  } catch (error) {
    const message = error && error.name === 'AbortError'
      ? 'Tempo limite ao consultar a NVIDIA.'
      : (error.message || 'Falha interna.');
    sendJson(res, 500, { ok: false, error: message });
  }
}

async function handleChatStream(req, res) {
  try {
    const body = await readJsonBody(req);
    const validation = validatePayload(body);

    if (!validation.ok) {
      sendSseHeaders(res);
      sendSseEvent(res, 'error', { ok: false, error: validation.error });
      res.end();
      return;
    }

    const payload = buildNvidiaPayload(body, validation.message, validation.history, true);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 180000);

    sendSseHeaders(res);

    try {
      const upstream = await fetch(NVIDIA_ENDPOINT, {
        method: 'POST',
        headers: buildUpstreamHeaders(validation.apiKey),
        body: JSON.stringify(payload),
        signal: controller.signal
      });

      if (!upstream.ok) {
        const text = await upstream.text();
        sendSseEvent(res, 'error', { ok: false, error: text || `Erro HTTP ${upstream.status}` });
        res.end();
        return;
      }

      if (!upstream.body) {
        sendSseEvent(res, 'error', { ok: false, error: 'Stream indisponível na resposta da NVIDIA.' });
        res.end();
        return;
      }

      const decoder = new TextDecoder();
      let buffer = '';
      let answer = '';
      let streamClosedByProvider = false;

      function processSseEventBlock(block) {
        let eventName = 'message';
        const dataLines = [];

        for (const rawLine of block.split('\n')) {
          const line = rawLine.trimEnd();
          if (!line) continue;

          if (line.startsWith('event:')) {
            eventName = line.slice(6).trim() || 'message';
            continue;
          }

          if (line.startsWith('data:')) {
            dataLines.push(line.slice(5).trimStart());
          }
        }

        const dataRaw = dataLines.join('\n').trim();
        if (!dataRaw) {
          return;
        }

        if (dataRaw === '[DONE]') {
          streamClosedByProvider = true;
          return;
        }

        const parsed = parseMaybeJson(dataRaw);
        if (!parsed) {
          return;
        }

        if (parsed.error) {
          const message = typeof parsed.error === 'string' ? parsed.error : JSON.stringify(parsed.error);
          sendSseEvent(res, 'error', { ok: false, error: message });
          return;
        }

        const delta = extractDeltaText(parsed);
        if (delta) {
          answer += delta;
          sendSseEvent(res, 'chunk', { delta, answerLength: answer.length, event: eventName });
        }

        const finishReason = parsed?.choices?.[0]?.finish_reason;
        if (finishReason) {
          streamClosedByProvider = true;
        }
      }

      for await (const chunk of upstream.body) {
        buffer += decoder.decode(chunk, { stream: true }).replace(/\r/g, '');

        while (true) {
          const marker = buffer.indexOf('\n\n');
          if (marker === -1) {
            break;
          }

          const block = buffer.slice(0, marker);
          buffer = buffer.slice(marker + 2);
          processSseEventBlock(block);

          if (streamClosedByProvider) {
            break;
          }
        }

        if (streamClosedByProvider) {
          break;
        }
      }

      const trailing = buffer.trim();
      if (!streamClosedByProvider && trailing) {
        if (trailing.startsWith('{')) {
          const parsed = parseMaybeJson(trailing);
          if (parsed) {
            const delta = extractDeltaText(parsed);
            if (delta) {
              answer += delta;
              sendSseEvent(res, 'chunk', { delta, answerLength: answer.length });
            }
          }
        }
      }

      sendSseEvent(res, 'done', {
        ok: true,
        answer: answer.trim(),
        provider: 'nvidia',
        model: validation.model
      });

      res.end();
    } finally {
      clearTimeout(timeout);
    }
  } catch (error) {
    const message = error && error.name === 'AbortError'
      ? 'Tempo limite ao consultar a NVIDIA.'
      : (error.message || 'Falha interna.');

    if (!res.headersSent) {
      sendSseHeaders(res);
    }

    sendSseEvent(res, 'error', { ok: false, error: message });
    res.end();
  }
}

function serveStatic(urlPath, res) {
  const filePath = resolveStaticFile(urlPath);
  if (!filePath) {
    sendJson(res, 404, { ok: false, error: 'Arquivo não encontrado.' });
    return;
  }

  fs.stat(filePath, (statErr, stats) => {
    if (statErr || !stats.isFile()) {
      sendJson(res, 404, { ok: false, error: 'Arquivo não encontrado.' });
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = CONTENT_TYPES[ext] || 'application/octet-stream';

    fs.readFile(filePath, (readErr, content) => {
      if (readErr) {
        sendJson(res, 500, { ok: false, error: 'Erro ao ler arquivo.' });
        return;
      }

      res.writeHead(200, staticHeaders(contentType, ext));
      res.end(content);
    });
  });
}

const server = http.createServer(async (req, res) => {
  setCors(res);

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host}`);
  const routePath = url.pathname.replace(/\/+$/, '') || '/';

  if (req.method === 'GET' && routePath === '/api/health') {
    sendJson(res, 200, {
      ok: true,
      status: 'up',
      provider: 'nvidia-proxy',
      stream: true,
      model: DEFAULT_MODEL,
      hasServerKey: Boolean(cleanApiKey(process.env.NVIDIA_API_KEY || ''))
    });
    return;
  }

  if (req.method === 'GET' && (routePath === '/api/chat' || routePath === '/api/chat-stream')) {
    sendJson(res, 200, {
      ok: true,
      status: 'up',
      hint: 'Use POST para enviar mensagens.',
      endpoints: {
        chat: '/api/chat',
        stream: '/api/chat-stream',
        health: '/api/health'
      }
    });
    return;
  }

  if (req.method === 'POST' && routePath === '/api/chat') {
    await handleChat(req, res);
    return;
  }

  if (req.method === 'POST' && routePath === '/api/chat-stream') {
    await handleChatStream(req, res);
    return;
  }

  if (req.method !== 'GET') {
    sendJson(res, 405, {
      ok: false,
      error: 'Método não permitido.',
      method: req.method,
      path: routePath,
      allowed: ['GET', 'POST', 'OPTIONS']
    });
    return;
  }

  serveStatic(url.pathname, res);
});

server.listen(PORT, HOST, () => {
  console.log(`Central IA online em http://${HOST}:${PORT}`);
  console.log('Endpoints IA: POST /api/chat e POST /api/chat-stream');
  if (!cleanApiKey(process.env.NVIDIA_API_KEY || '')) {
    console.log('Aviso: defina NVIDIA_API_KEY para uso público sem chave no frontend.');
  }
});
