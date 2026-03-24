const DEFAULT_MODEL = "deepseek-ai/deepseek-v3.2";
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

function buildSystemPrompt(body) {
  const base = [
    "Voce e um copiloto tecnico focado em codigo, debug, arquitetura e performance.",
    "Responda em portugues claro, com passos objetivos e patch final quando necessario."
  ].join(" ");
  const contextProfile = String(body?.contextProfile || "").trim();
  if (!contextProfile) return base;
  return `${base}\n\nContexto do usuario:\n${contextProfile}`;
}

function corsHeaders() {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "Content-Type, Authorization, Accept"
  };
}

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...corsHeaders(),
      "content-type": "application/json; charset=utf-8"
    }
  });
}

export function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

export async function onRequestPost(context) {
  let body = {};
  try {
    body = await context.request.json();
  } catch (_error) {
    return json({ ok: false, error: "JSON invalido." }, 400);
  }

  const message = String(body.message || "").trim();
  const history = sanitizeHistory(body.history);
  const serverApiKey = cleanApiKey(context.env.NVIDIA_API_KEY || "");
  const clientApiKey = cleanApiKey(body.apiKey || "");
  const apiKey = serverApiKey || clientApiKey;
  const model = String(body.model || context.env.NVIDIA_MODEL || DEFAULT_MODEL).trim() || DEFAULT_MODEL;

  if (!message) {
    return json({ ok: false, error: "Mensagem vazia." }, 400);
  }

  if (!apiKey) {
    return json({ ok: false, error: "NVIDIA_API_KEY ausente no backend." }, 400);
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
      return json({ ok: false, error: raw || `Erro HTTP ${upstream.status}` }, upstream.status);
    }

    const data = await upstream.json();
    const answer = extractAssistantText(data);
    if (!answer) {
      return json({ ok: false, error: "Resposta vazia da NVIDIA." }, 502);
    }

    return json({
      ok: true,
      answer,
      provider: "cloudflare-nvidia-proxy",
      model
    });
  } catch (error) {
    if (error && error.name === "AbortError") {
      return json({ ok: false, error: "Tempo limite ao consultar a NVIDIA." }, 504);
    }
    return json({ ok: false, error: String(error?.message || error || "Falha interna.") }, 500);
  } finally {
    clearTimeout(timeout);
  }
}

