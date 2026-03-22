function normalizeBase(raw) {
  const value = String(raw || "").trim();
  if (!value) return "";
  try {
    const parsed = new URL(value.startsWith("http") ? value : `https://${value}`);
    parsed.search = "";
    parsed.hash = "";
    parsed.pathname = parsed.pathname.replace(/\/+$/, "");
    return parsed.toString().replace(/\/+$/, "");
  } catch {
    return "";
  }
}

const argBase = process.argv[2] || process.env.CHECK_BASE_URL || process.env.PUBLIC_API_BASE_URL || "";
const base = normalizeBase(argBase);

if (!base) {
  console.error("Uso: node scripts/check-health.mjs https://seu-site.com");
  process.exit(1);
}

const endpoint = `${base}/api/health`;

try {
  const response = await fetch(endpoint, {
    method: "GET",
    headers: { Accept: "application/json" }
  });
  const raw = await response.text();
  let payload = null;

  try {
    payload = JSON.parse(raw);
  } catch {
    payload = raw;
  }

  if (!response.ok) {
    console.error(`[health] ERRO HTTP ${response.status} em ${endpoint}`);
    console.error(payload);
    process.exit(1);
  }

  if (!payload || payload.ok !== true) {
    console.error(`[health] Endpoint respondeu sem ok=true em ${endpoint}`);
    console.error(payload);
    process.exit(1);
  }

  console.log(`[health] OK em ${endpoint}`);
  console.log(payload);
} catch (error) {
  console.error(`[health] Falha ao consultar ${endpoint}`);
  console.error(String(error?.message || error));
  process.exit(1);
}

