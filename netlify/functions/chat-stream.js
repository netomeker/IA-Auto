const DEFAULT_MODEL = process.env.NVIDIA_MODEL || "deepseek-ai/deepseek-v3.2";
const NVIDIA_ENDPOINT = "https://integrate.api.nvidia.com/v1/chat/completions";

function cleanApiKey(raw) {
  const value = String(raw || "").trim();
  if (!value) return "";
  return value.replace(/^Authorization\s*:\s*/i, "").replace(/^Bearer\s+/i, "").trim();
}

function sanitizeHistory(input) {
  if (!Array.isArray(input)) return [];
  return input
    .filter((item) => item && (item.role === "user" || item.role === "assistant") && typeof item.content === "string")
    .slice(-8)
    .map((item) => ({ role: item.role, content: item.content }));
}

function textFromMixed(value) {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";
  return value
    .map((part) => {
      if (typeof part === "string") return part;
      if (part && typeof part.text === "string") return part.text;
      if (part && typeof part.content === "string") return part.content;
      return "";
    })
    .join("");
}

function firstTextCandidate(candidates) {
  for (const candidate of candidates) {
    const text = textFromMixed(candidate);
    if (text) return text;
  }
  return "";
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

function parseJsonBody(event) {
  try {
    return event.body ? JSON.parse(event.body) : {};
  } catch (_error) {
    return null;
  }
}

function buildSystemPrompt(body) {
  const base = "Voce e um assistente pratico e objetivo para produtividade profissional. Se perguntarem quem e o criador deste chat, responda exatamente: \"O criador deste chat e netin do roi.\"";
  const contextProfile = String(body?.contextProfile || "").trim();
  if (!contextProfile) {
    return base;
  }
  return `${base}\n\nContexto de trabalho do usuario:\n${contextProfile}`;
}

function sse(body) {
  return {
    statusCode: 200,
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET,POST,OPTIONS",
      "access-control-allow-headers": "Content-Type, Authorization, Accept"
    },
    body
  };
}

exports.handler = async function handler(event) {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: { "access-control-allow-origin": "*" } };
  }

  if (event.httpMethod !== "POST") {
    return sse(`event: error\ndata: ${JSON.stringify({ ok: false, error: "Metodo nao permitido." })}\n\n`);
  }

  const body = parseJsonBody(event);
  if (!body) {
    return sse(`event: error\ndata: ${JSON.stringify({ ok: false, error: "JSON invalido." })}\n\n`);
  }

  const message = String(body.message || "").trim();
  const history = sanitizeHistory(body.history);
  const serverApiKey = cleanApiKey(process.env.NVIDIA_API_KEY || "");
  const clientApiKey = cleanApiKey(body.apiKey || "");
  const apiKey = serverApiKey || clientApiKey;
  const model = String(body.model || DEFAULT_MODEL).trim() || DEFAULT_MODEL;

  if (!message) {
    return sse(`event: error\ndata: ${JSON.stringify({ ok: false, error: "Mensagem vazia." })}\n\n`);
  }

  if (!apiKey) {
    return sse(`event: error\ndata: ${JSON.stringify({ ok: false, error: "NVIDIA_API_KEY ausente no backend." })}\n\n`);
  }

  const payload = {
    model,
    messages: [
      { role: "system", content: buildSystemPrompt(body) },
      ...history,
      { role: "user", content: message }
    ],
    temperature: Number(body.temperature ?? 0.7),
    top_p: Number(body.top_p ?? 0.95),
    max_tokens: Number(body.max_tokens ?? 2048),
    seed: Number(body.seed ?? 42),
    stream: false,
    chat_template_kwargs: {
      thinking: Boolean(body.thinking ?? false)
    }
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120000);

  try {
    const upstream = await fetch(NVIDIA_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });

    if (!upstream.ok) {
      const raw = await upstream.text();
      return sse(`event: error\ndata: ${JSON.stringify({ ok: false, error: raw || `Erro HTTP ${upstream.status}` })}\n\n`);
    }

    const data = await upstream.json();
    const answer = extractAssistantText(data);

    if (!answer) {
      return sse(`event: error\ndata: ${JSON.stringify({ ok: false, error: "Resposta vazia da NVIDIA." })}\n\n`);
    }

    const events = [
      `event: chunk\ndata: ${JSON.stringify({ delta: answer, answerLength: answer.length })}\n\n`,
      `event: done\ndata: ${JSON.stringify({ ok: true, answer, provider: "netlify-nvidia-proxy", model })}\n\n`
    ];

    return sse(events.join(""));
  } catch (error) {
    if (error && error.name === "AbortError") {
      return sse(`event: error\ndata: ${JSON.stringify({ ok: false, error: "Tempo limite ao consultar a NVIDIA." })}\n\n`);
    }
    return sse(`event: error\ndata: ${JSON.stringify({ ok: false, error: String(error?.message || error || "Falha interna.") })}\n\n`);
  } finally {
    clearTimeout(timeout);
  }
};
