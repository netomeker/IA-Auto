const DEFAULT_MODEL = "deepseek-ai/deepseek-v3.2";

function cleanApiKey(raw) {
  const value = String(raw || "").trim();
  if (!value) return "";
  return value.replace(/^Authorization\s*:\s*/i, "").replace(/^Bearer\s+/i, "").trim();
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

export function onRequestGet(context) {
  const model = String(context.env.NVIDIA_MODEL || DEFAULT_MODEL).trim() || DEFAULT_MODEL;
  const hasServerKey = Boolean(cleanApiKey(context.env.NVIDIA_API_KEY || ""));

  return json({
    ok: true,
    status: "up",
    provider: "cloudflare-nvidia-proxy",
    model,
    hasServerKey
  });
}

