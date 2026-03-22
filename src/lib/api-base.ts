type ApiRoute = "/api/health" | "/api/chat" | "/api/chat-stream";

const LAST_API_BASE_KEY = "central_ia_last_api_base";
const RETRYABLE_STATUS = new Set([404, 405, 502, 503, 504]);

function normalizeBase(raw: string) {
  const value = String(raw || "").trim();
  if (!value) return "";

  try {
    if (value.startsWith("/") && typeof window !== "undefined") {
      const relative = new URL(value, window.location.origin);
      const normalizedRelative = `${relative.origin}${relative.pathname}`.replace(/\/+$/, "");
      return normalizeBase(normalizedRelative);
    }

    const isLocalHostWithoutScheme = /^(localhost|127\.0\.0\.1|0\.0\.0\.0)(:\d+)?(\/|$)/i.test(value);
    const parsed = value.startsWith("http://") || value.startsWith("https://")
      ? new URL(value)
      : new URL(`${isLocalHostWithoutScheme ? "http" : "https"}://${value}`);

    let pathname = parsed.pathname.replace(/\/+$/, "");
    pathname = pathname.replace(/\/api\/chat-stream$/i, "/api");
    pathname = pathname.replace(/\/api\/chat$/i, "/api");

    parsed.pathname = pathname || "/";
    parsed.search = "";
    parsed.hash = "";

    const base = parsed.toString().replace(/\/+$/, "");
    return base === "https:" || base === "http:" ? "" : base;
  } catch (_error) {
    return "";
  }
}

function unique(items: string[]) {
  return [...new Set(items.filter(Boolean))];
}

function getStoredBase() {
  if (typeof window === "undefined") {
    return "";
  }

  try {
    return normalizeBase(localStorage.getItem(LAST_API_BASE_KEY) || "");
  } catch (_error) {
    return "";
  }
}

function storeBase(base: string) {
  if (typeof window === "undefined" || !base) {
    return;
  }

  try {
    localStorage.setItem(LAST_API_BASE_KEY, base);
  } catch (_error) {
    // Ignore localStorage failures.
  }
}

function getConfiguredBases() {
  if (typeof window === "undefined") {
    return [];
  }

  const cfg = window.CENTRAL_IA_CONFIG || {};
  return unique([
    normalizeBase(String(cfg.apiBaseUrl || "")),
    normalizeBase(String(cfg.apiEndpoint || "")),
    normalizeBase(String(cfg.apiBase || "")),
    normalizeBase(String(cfg.backendUrl || ""))
  ]);
}

function getGithubNetlifyGuesses() {
  if (typeof window === "undefined") {
    return [];
  }

  const host = String(window.location.hostname || "").toLowerCase();
  if (!host.endsWith(".github.io")) {
    return [];
  }

  const user = host.replace(/\.github\.io$/i, "");
  const repo = window.location.pathname.split("/").filter(Boolean)[0] || "";

  return unique([
    normalizeBase(repo ? `https://${repo}.netlify.app` : ""),
    normalizeBase(user ? `https://${user}.netlify.app` : "")
  ]);
}

function getRuntimeBases() {
  if (typeof window === "undefined") {
    return [];
  }

  const origin = normalizeBase(window.location.origin);
  const local = [
    normalizeBase("http://127.0.0.1:3000"),
    normalizeBase("http://localhost:3000")
  ];

  return unique([origin, ...local, ...getGithubNetlifyGuesses()]);
}

function getCandidates(preferredBase?: string) {
  return unique([
    normalizeBase(preferredBase || ""),
    getStoredBase(),
    ...getConfiguredBases(),
    ...getRuntimeBases()
  ]);
}

function routeFromBase(base: string, route: ApiRoute) {
  if (!base) {
    return route;
  }

  if (/\/api$/i.test(base)) {
    return `${base}${route.replace(/^\/api/i, "")}`;
  }

  return `${base}${route}`;
}

export async function fetchWithApiFallback(
  route: ApiRoute,
  init: RequestInit,
  preferredBase?: string
) {
  const candidates = getCandidates(preferredBase);
  const tried: string[] = [];
  const errors: string[] = [];

  for (const base of candidates) {
    const url = routeFromBase(base, route);
    tried.push(url);

    try {
      const response = await fetch(url, init);

      if (response.ok) {
        storeBase(base);
        return { response, url, base, tried };
      }

      if (RETRYABLE_STATUS.has(response.status)) {
        errors.push(`${url} -> HTTP ${response.status}`);
        continue;
      }

      return { response, url, base, tried };
    } catch (error) {
      errors.push(`${url} -> ${String(error)}`);
    }
  }

  throw new Error(`Falha ao conectar backend. Tentativas: ${errors.join(" | ") || tried.join(" | ")}`);
}

export async function probeApiHealth() {
  try {
    const { response, base } = await fetchWithApiFallback(
      "/api/health",
      { method: "GET", cache: "no-store", headers: { Accept: "application/json" } }
    );

    if (!response.ok) {
      return { ok: false as const, base, status: response.status };
    }

    const payload = await response.json().catch(() => null);
    return { ok: true as const, base, payload };
  } catch (error) {
    return { ok: false as const, base: "", error: String(error) };
  }
}
