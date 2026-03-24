const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const DIST_ROOT = path.join(ROOT, 'dist');
loadEnvFile(path.join(ROOT, '.env'));

const HOST = process.env.HOST || '0.0.0.0';
const PORT = Number(process.env.PORT || 3000);

const DEFAULT_NVIDIA_MODEL = process.env.NVIDIA_MODEL || 'deepseek-ai/deepseek-v3.2';
const DEFAULT_LOCAL_MODEL = process.env.LOCAL_MODEL || process.env.OLLAMA_MODEL || 'gemma3:4b';
const NVIDIA_ENDPOINT = process.env.NVIDIA_ENDPOINT || 'https://integrate.api.nvidia.com/v1/chat/completions';
const OLLAMA_ENDPOINT = process.env.OLLAMA_ENDPOINT || 'http://127.0.0.1:11434/v1/chat/completions';
const OLLAMA_TAGS_ENDPOINT = process.env.OLLAMA_TAGS_ENDPOINT || 'http://127.0.0.1:11434/api/tags';
const AI_PROVIDER_MODE = normalizeProvider(process.env.AI_PROVIDER || 'auto');

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

function normalizeProvider(raw) {
  const value = String(raw || '').trim().toLowerCase();
  if (value === 'nvidia' || value === 'ollama' || value === 'auto') {
    return value;
  }
  return 'auto';
}

function normalizeOllamaModel(raw) {
  let value = String(raw || '').trim();
  if (!value) return '';
  value = value.replace(/^ollama:/i, '').trim();
  if (!value) return '';
  if (value.includes('/') || /\s/.test(value)) return '';
  return value;
}

function resolveOllamaModel(rawModel) {
  return normalizeOllamaModel(rawModel) || DEFAULT_LOCAL_MODEL;
}

function buildBaseMessages(body, message, history) {
  return [
    { role: 'system', content: buildSystemPrompt(body) },
    ...history,
    { role: 'user', content: message }
  ];
}

function buildNvidiaPayload(body, message, history, stream, model) {
  return {
    model: String(model || DEFAULT_NVIDIA_MODEL).trim() || DEFAULT_NVIDIA_MODEL,
    messages: buildBaseMessages(body, message, history),
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

function buildOllamaPayload(body, message, history, stream, model) {
  return {
    model: resolveOllamaModel(model),
    messages: buildBaseMessages(body, message, history),
    temperature: Number(body.temperature ?? 0.7),
    top_p: Number(body.top_p ?? 0.95),
    max_tokens: Number(body.max_tokens ?? 2048),
    stream
  };
}

function buildNvidiaHeaders(apiKey) {
  return {
    Authorization: `Bearer ${apiKey}`,
    Accept: 'application/json',
    'Content-Type': 'application/json'
  };
}

function buildOllamaHeaders() {
  return {
    Accept: 'application/json',
    'Content-Type': 'application/json'
  };
}

function createProviderError(provider, status, message) {
  const error = new Error(String(message || 'Falha no provedor de IA.'));
  error.provider = provider;
  error.status = Number(status || 0);
  return error;
}

function providerErrorText(error) {
  const provider = String(error?.provider || 'backend').trim();
  const status = Number(error?.status || 0);
  const message = String(error?.message || error || 'Falha interna.');
  const clean = message.replace(/\s+/g, ' ').trim();

  if (status > 0) {
    return `[${provider}] HTTP ${status}: ${clean}`;
  }
  return `[${provider}] ${clean}`;
}

function validatePayload(body) {
  const message = String(body.message || '').trim();
  const history = sanitizeHistory(body.history);
  const serverApiKey = cleanApiKey(process.env.NVIDIA_API_KEY || '');
  const clientApiKey = cleanApiKey(body.apiKey || '');
  const apiKey = serverApiKey || clientApiKey;
  const requestedModel = String(body.model || '').trim();
  const requestedProvider = normalizeProvider(body.provider || body.aiProvider || AI_PROVIDER_MODE);

  if (!message) {
    return { ok: false, error: 'Mensagem vazia.' };
  }

  return {
    ok: true,
    message,
    history,
    apiKey,
    requestedModel,
    requestedProvider
  };
}

function resolveProviderOrder(validation) {
  const order = [];
  const mode = normalizeProvider(validation.requestedProvider || AI_PROVIDER_MODE);

  if (mode === 'nvidia') {
    order.push('nvidia');
    order.push('ollama');
  } else if (mode === 'ollama') {
    order.push('ollama');
    order.push('nvidia');
  } else {
    if (validation.apiKey) {
      order.push('nvidia');
    }
    order.push('ollama');
  }

  if (!order.length) {
    order.push('ollama');
  }

  return [...new Set(order)];
}

async function requestNvidiaJson(body, validation) {
  if (!validation.apiKey) {
    throw createProviderError('nvidia', 400, 'NVIDIA_API_KEY ausente no backend.');
  }

  const model = validation.requestedModel || DEFAULT_NVIDIA_MODEL;
  const payload = buildNvidiaPayload(body, validation.message, validation.history, false, model);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120000);

  try {
    const upstream = await fetch(NVIDIA_ENDPOINT, {
      method: 'POST',
      headers: buildNvidiaHeaders(validation.apiKey),
      body: JSON.stringify(payload),
      signal: controller.signal
    });

    if (!upstream.ok) {
      const text = await upstream.text();
      throw createProviderError('nvidia', upstream.status, text || `Erro HTTP ${upstream.status}`);
    }

    const data = await upstream.json().catch(() => null);
    const answer = extractAssistantText(data || {});
    if (!answer) {
      throw createProviderError('nvidia', 502, 'Resposta vazia da NVIDIA.');
    }

    return {
      answer,
      provider: 'nvidia',
      model: payload.model
    };
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw createProviderError('nvidia', 504, 'Tempo limite ao consultar a NVIDIA.');
    }
    if (error?.provider) {
      throw error;
    }
    throw createProviderError('nvidia', 500, error?.message || 'Falha ao consultar a NVIDIA.');
  } finally {
    clearTimeout(timeout);
  }
}

async function requestOllamaJson(body, validation) {
  const model = resolveOllamaModel(validation.requestedModel || DEFAULT_LOCAL_MODEL);
  const payload = buildOllamaPayload(body, validation.message, validation.history, false, model);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 180000);

  try {
    const upstream = await fetch(OLLAMA_ENDPOINT, {
      method: 'POST',
      headers: buildOllamaHeaders(),
      body: JSON.stringify(payload),
      signal: controller.signal
    });

    if (!upstream.ok) {
      const text = await upstream.text();
      throw createProviderError('ollama', upstream.status, text || `Erro HTTP ${upstream.status}`);
    }

    const data = await upstream.json().catch(() => null);
    const answer = extractAssistantText(data || {});
    if (!answer) {
      throw createProviderError('ollama', 502, 'Resposta vazia do Ollama.');
    }

    return {
      answer,
      provider: 'ollama-local',
      model: payload.model
    };
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw createProviderError('ollama', 504, 'Tempo limite ao consultar o Ollama local.');
    }
    if (error?.provider) {
      throw error;
    }
    throw createProviderError('ollama', 500, error?.message || 'Falha ao consultar o Ollama local.');
  } finally {
    clearTimeout(timeout);
  }
}

async function streamFromNvidia(body, validation, res, state) {
  if (!validation.apiKey) {
    throw createProviderError('nvidia', 400, 'NVIDIA_API_KEY ausente no backend.');
  }

  const model = validation.requestedModel || DEFAULT_NVIDIA_MODEL;
  const payload = buildNvidiaPayload(body, validation.message, validation.history, true, model);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 180000);

  try {
    const upstream = await fetch(NVIDIA_ENDPOINT, {
      method: 'POST',
      headers: buildNvidiaHeaders(validation.apiKey),
      body: JSON.stringify(payload),
      signal: controller.signal
    });

    if (!upstream.ok) {
      const text = await upstream.text();
      throw createProviderError('nvidia', upstream.status, text || `Erro HTTP ${upstream.status}`);
    }

    if (!upstream.body) {
      throw createProviderError('nvidia', 502, 'Stream indisponivel na resposta da NVIDIA.');
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
        throw createProviderError('nvidia', 502, message);
      }

      const delta = extractDeltaText(parsed);
      if (delta) {
        state.emitted = true;
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
    if (!streamClosedByProvider && trailing && trailing.startsWith('{')) {
      const parsed = parseMaybeJson(trailing);
      if (parsed) {
        const delta = extractDeltaText(parsed);
        if (delta) {
          state.emitted = true;
          answer += delta;
          sendSseEvent(res, 'chunk', { delta, answerLength: answer.length });
        }
      }
    }

    const finalAnswer = answer.trim();
    if (!finalAnswer) {
      throw createProviderError('nvidia', 502, 'Resposta vazia da NVIDIA.');
    }

    sendSseEvent(res, 'done', {
      ok: true,
      answer: finalAnswer,
      provider: 'nvidia',
      model: payload.model
    });
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw createProviderError('nvidia', 504, 'Tempo limite ao consultar a NVIDIA.');
    }
    if (error?.provider) {
      throw error;
    }
    throw createProviderError('nvidia', 500, error?.message || 'Falha ao consultar a NVIDIA.');
  } finally {
    clearTimeout(timeout);
  }
}

async function streamFromOllamaSingleChunk(body, validation, res, state) {
  const result = await requestOllamaJson(body, validation);
  const text = String(result.answer || '').trim();
  if (!text) {
    throw createProviderError('ollama', 502, 'Resposta vazia do Ollama.');
  }

  state.emitted = true;
  sendSseEvent(res, 'chunk', { delta: text, answerLength: text.length, event: 'single' });
  sendSseEvent(res, 'done', {
    ok: true,
    answer: text,
    provider: result.provider,
    model: result.model,
    streamMode: 'single-chunk'
  });
}

async function queryOllamaHealth(timeoutMs = 2200) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(OLLAMA_TAGS_ENDPOINT, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal
    });

    if (!response.ok) {
      return {
        available: false,
        model: resolveOllamaModel(''),
        error: `HTTP ${response.status}`
      };
    }

    const payload = await response.json().catch(() => ({}));
    const models = Array.isArray(payload?.models) ? payload.models : [];
    const names = models
      .map((entry) => String(entry?.name || entry?.model || '').trim())
      .filter(Boolean);

    const desired = resolveOllamaModel(DEFAULT_LOCAL_MODEL);
    const selectedModel = names.includes(desired) ? desired : (names[0] || desired);

    return {
      available: names.length > 0,
      model: selectedModel,
      installedModels: names
    };
  } catch (error) {
    return {
      available: false,
      model: resolveOllamaModel(DEFAULT_LOCAL_MODEL),
      error: String(error?.message || error || 'Ollama offline')
    };
  } finally {
    clearTimeout(timeout);
  }
}

function resolvePreferredProvider(mode, hasNvidiaKey, hasLocalModel) {
  const normalized = normalizeProvider(mode || AI_PROVIDER_MODE);
  if (normalized === 'nvidia') {
    if (hasNvidiaKey) return 'nvidia';
    if (hasLocalModel) return 'ollama';
    return 'none';
  }

  if (normalized === 'ollama') {
    if (hasLocalModel) return 'ollama';
    if (hasNvidiaKey) return 'nvidia';
    return 'none';
  }

  if (hasNvidiaKey) return 'nvidia';
  if (hasLocalModel) return 'ollama';
  return 'none';
}

async function handleChat(req, res) {
  try {
    const body = await readJsonBody(req);
    const validation = validatePayload(body);

    if (!validation.ok) {
      sendJson(res, 400, { ok: false, error: validation.error });
      return;
    }

    const providers = resolveProviderOrder(validation);
    const errors = [];

    for (const provider of providers) {
      try {
        const result = provider === 'nvidia'
          ? await requestNvidiaJson(body, validation)
          : await requestOllamaJson(body, validation);

        sendJson(res, 200, {
          ok: true,
          answer: result.answer,
          provider: result.provider,
          model: result.model
        });
        return;
      } catch (error) {
        errors.push(error);
      }
    }

    const last = errors[errors.length - 1];
    const status = Number(last?.status || 502);
    const safeStatus = status >= 400 && status <= 599 ? status : 502;
    const merged = errors.map(providerErrorText).join(' | ') || 'Nenhum provedor respondeu.';
    sendJson(res, safeStatus, { ok: false, error: merged });
  } catch (error) {
    const message = error && error.name === 'AbortError'
      ? 'Tempo limite ao consultar provedor de IA.'
      : (error.message || 'Falha interna.');
    sendJson(res, 500, { ok: false, error: message });
  }
}

async function handleChatStream(req, res) {
  sendSseHeaders(res);

  try {
    const body = await readJsonBody(req);
    const validation = validatePayload(body);

    if (!validation.ok) {
      sendSseEvent(res, 'error', { ok: false, error: validation.error });
      res.end();
      return;
    }

    const providers = resolveProviderOrder(validation);
    const errors = [];
    const state = { emitted: false };

    for (const provider of providers) {
      try {
        if (provider === 'nvidia') {
          await streamFromNvidia(body, validation, res, state);
        } else {
          await streamFromOllamaSingleChunk(body, validation, res, state);
        }
        res.end();
        return;
      } catch (error) {
        errors.push(error);

        if (state.emitted) {
          sendSseEvent(res, 'error', { ok: false, error: providerErrorText(error) });
          res.end();
          return;
        }
      }
    }

    const merged = errors.map(providerErrorText).join(' | ') || 'Nenhum provedor respondeu.';
    sendSseEvent(res, 'error', { ok: false, error: merged });
    res.end();
  } catch (error) {
    const message = error && error.name === 'AbortError'
      ? 'Tempo limite ao consultar provedor de IA.'
      : (error.message || 'Falha interna.');

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
    const hasNvidiaKey = Boolean(cleanApiKey(process.env.NVIDIA_API_KEY || ''));
    const localState = await queryOllamaHealth(2200);
    const preferred = resolvePreferredProvider(AI_PROVIDER_MODE, hasNvidiaKey, localState.available);
    const selectedProvider = preferred === 'ollama'
      ? 'ollama-local'
      : preferred === 'nvidia'
        ? 'nvidia-proxy'
        : 'none';
    const selectedModel = preferred === 'ollama'
      ? localState.model
      : preferred === 'nvidia'
        ? (String(process.env.NVIDIA_MODEL || DEFAULT_NVIDIA_MODEL).trim() || DEFAULT_NVIDIA_MODEL)
        : resolveOllamaModel(DEFAULT_LOCAL_MODEL);

    sendJson(res, 200, {
      ok: true,
      status: 'up',
      provider: selectedProvider,
      providerMode: AI_PROVIDER_MODE,
      stream: true,
      model: selectedModel,
      hasServerKey: hasNvidiaKey || localState.available,
      hasNvidiaKey,
      hasLocalModel: localState.available,
      localModel: localState.model,
      ollamaEndpoint: OLLAMA_ENDPOINT
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
  console.log(`Modo de provedor AI: ${AI_PROVIDER_MODE}`);
  if (!cleanApiKey(process.env.NVIDIA_API_KEY || '')) {
    console.log('NVIDIA_API_KEY nao encontrada. Backend vai tentar Ollama local automaticamente.');
  }
  console.log(`Ollama endpoint: ${OLLAMA_ENDPOINT} (modelo padrao: ${resolveOllamaModel(DEFAULT_LOCAL_MODEL)})`);
});
