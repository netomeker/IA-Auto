const DEFAULT_MODEL = process.env.NVIDIA_MODEL || "deepseek-ai/deepseek-v3.2";

function cleanApiKey(raw) {
  const value = String(raw || "").trim();
  if (!value) return "";
  return value.replace(/^Authorization\s*:\s*/i, "").replace(/^Bearer\s+/i, "").trim();
}

function json(statusCode, payload) {
  return {
    statusCode,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET,POST,OPTIONS",
      "access-control-allow-headers": "Content-Type, Authorization, Accept"
    },
    body: JSON.stringify(payload)
  };
}

exports.handler = async function handler(event) {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: { "access-control-allow-origin": "*" } };
  }

  if (event.httpMethod !== "GET") {
    return json(405, { ok: false, error: "Metodo nao permitido." });
  }

  return json(200, {
    ok: true,
    status: "up",
    provider: "netlify-nvidia-proxy",
    stream: true,
    model: DEFAULT_MODEL,
    hasServerKey: Boolean(cleanApiKey(process.env.NVIDIA_API_KEY || ""))
  });
};
