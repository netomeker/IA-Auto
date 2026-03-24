import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const defaultModel = "deepseek-ai/deepseek-v3.2";

function normalizeBase(raw) {
  const value = String(raw || "").trim();
  if (!value) return "";

  try {
    const isLocalHostWithoutScheme = /^(localhost|127\.0\.0\.1|0\.0\.0\.0)(:\d+)?(\/|$)/i.test(value);
    const parsed = value.startsWith("http://") || value.startsWith("https://")
      ? new URL(value)
      : new URL(`${isLocalHostWithoutScheme ? "http" : "https"}://${value}`);

    parsed.search = "";
    parsed.hash = "";
    parsed.pathname = parsed.pathname.replace(/\/+$/, "");
    return parsed.toString().replace(/\/+$/, "");
  } catch {
    return "";
  }
}

function readTextFileSafe(filePath) {
  try {
    if (!fs.existsSync(filePath)) return "";
    return String(fs.readFileSync(filePath, "utf8") || "").trim();
  } catch {
    return "";
  }
}

function readBaseFromExistingConfig() {
  const files = [
    path.join(root, "config.js"),
    path.join(root, "public", "config.js")
  ];

  for (const filePath of files) {
    const raw = readTextFileSafe(filePath);
    if (!raw) continue;

    const match = raw.match(/window\.CENTRAL_IA_CONFIG\s*=\s*(\{[\s\S]*\})\s*;?\s*$/);
    if (!match?.[1]) continue;

    try {
      const parsed = JSON.parse(match[1]);
      const base = normalizeBase(String(parsed.apiBaseUrl || parsed.apiEndpoint || ""));
      if (base) {
        return base;
      }
    } catch {
      // Ignore malformed config and continue.
    }
  }

  return "";
}

function readBackupFromExistingConfig() {
  const files = [
    path.join(root, "config.js"),
    path.join(root, "public", "config.js")
  ];

  for (const filePath of files) {
    const raw = readTextFileSafe(filePath);
    if (!raw) continue;

    const match = raw.match(/window\.CENTRAL_IA_CONFIG\s*=\s*(\{[\s\S]*\})\s*;?\s*$/);
    if (!match?.[1]) continue;

    try {
      const parsed = JSON.parse(match[1]);
      const backup = normalizeBase(String(parsed.backendUrl || ""));
      if (backup) {
        return backup;
      }
    } catch {
      // Ignore malformed config and continue.
    }
  }

  return "";
}

function resolveApiBaseUrl() {
  const explicit = normalizeBase(
    process.env.PUBLIC_API_BASE_URL ||
      process.env.API_BASE_URL ||
      process.env.CENTRAL_IA_API_BASE_URL ||
      ""
  );

  if (explicit) {
    return {
      value: explicit,
      source: "variavel de ambiente"
    };
  }

  const fromTrackedBackendFile = normalizeBase(readTextFileSafe(path.join(root, "public_backend_url.txt")));
  if (fromTrackedBackendFile) {
    return {
      value: fromTrackedBackendFile,
      source: "public_backend_url.txt"
    };
  }

  const fromExistingConfig = readBaseFromExistingConfig();
  if (fromExistingConfig) {
    return {
      value: fromExistingConfig,
      source: "config.js existente"
    };
  }

  const fromPublicUrlFile = normalizeBase(readTextFileSafe(path.join(root, "public_url.txt")));
  if (fromPublicUrlFile) {
    return {
      value: fromPublicUrlFile,
      source: "public_url.txt"
    };
  }

  return {
    value: "",
    source: "mesmo dominio do frontend"
  };
}

function buildConfig() {
  const resolvedBase = resolveApiBaseUrl();
  const apiBaseUrl = resolvedBase.value;
  const backupBase = normalizeBase(process.env.PUBLIC_API_BACKUP_BASE_URL || readBackupFromExistingConfig() || "");

  const model = String(process.env.PUBLIC_MODEL || process.env.NVIDIA_MODEL || defaultModel).trim() || defaultModel;

  return {
    apiBaseUrl,
    apiEndpoint: apiBaseUrl,
    backendUrl: backupBase,
    defaultModel: model,
    _source: resolvedBase.source
  };
}

function writeConfigFile(targetPath, config) {
  const content = `window.CENTRAL_IA_CONFIG = ${JSON.stringify(config, null, 2)};\n`;
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, content, "utf8");
}

const configWithMeta = buildConfig();
const { _source, ...config } = configWithMeta;

writeConfigFile(path.join(root, "public", "config.js"), config);
writeConfigFile(path.join(root, "config.js"), config);

const safeBase = config.apiBaseUrl || "(mesmo dominio do frontend)";
console.log(`[config] apiBaseUrl: ${safeBase}`);
console.log(`[config] origem apiBaseUrl: ${_source}`);
console.log(`[config] defaultModel: ${config.defaultModel}`);
