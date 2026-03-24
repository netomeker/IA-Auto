type ApiRoute = "/api/health" | "/api/chat" | "/api/chat-stream";

const LAST_API_BASE_KEY = "central_ia_last_api_base";
const RETRYABLE_STATUS = new Set([401, 403, 404, 405, 408, 500, 502, 503, 504]);
const RETRY_DELAYS_MS = [0, 900, 2200, 4500];

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

function useStoredBase() {
  if (typeof window === "undefined") {
    return false;
  }

  const host = String(window.location.hostname || "").toLowerCase();
  return !host.endsWith(".github.io");
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

function getRuntimeBases() {
  if (typeof window === "undefined") {
    return [];
  }

  const host = String(window.location.hostname || "").toLowerCase();
  const isGithubPages = host.endsWith(".github.io");

  // GitHub Pages e estatico e nao suporta backend no mesmo dominio.
  // Evita fallback enganoso para /api no proprio Pages.
  const origin = isGithubPages ? "" : normalizeBase(window.location.origin);
  const local = isGithubPages
    ? []
    : [
      normalizeBase("http://127.0.0.1:3000"),
      normalizeBase("http://localhost:3000")
    ];

  return unique([origin, ...local]);
}

function getCandidates(preferredBase?: string) {
  const configured = getConfiguredBases();
  const stored = useStoredBase() ? getStoredBase() : "";

  return unique([
    normalizeBase(preferredBase || ""),
    ...configured,
    stored,
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

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function fetchWithApiFallback(
  route: ApiRoute,
  init: RequestInit,
  preferredBase?: string
) {
  const candidates = getCandidates(preferredBase);
  const tried: string[] = [];
  const errors: string[] = [];
  const maxRounds = route === "/api/health" ? 2 : 4;

  for (let round = 0; round < maxRounds; round += 1) {
    const roundErrors: string[] = [];

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
          roundErrors.push(`${url} -> HTTP ${response.status}`);
          continue;
        }

        return { response, url, base, tried };
      } catch (error) {
        roundErrors.push(`${url} -> ${String(error)}`);
      }
    }

    if (roundErrors.length) {
      errors.push(`[round ${round + 1}] ${roundErrors.join(" | ")}`);
    }

    if (round < maxRounds - 1) {
      const delayMs = RETRY_DELAYS_MS[Math.min(round + 1, RETRY_DELAYS_MS.length - 1)] || 0;
      if (delayMs > 0) {
        await wait(delayMs);
      }
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
