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

function buildConfig() {
  const apiBaseUrl = normalizeBase(
    process.env.PUBLIC_API_BASE_URL ||
      process.env.API_BASE_URL ||
      process.env.CENTRAL_IA_API_BASE_URL ||
      ""
  );

  const model = String(process.env.PUBLIC_MODEL || process.env.NVIDIA_MODEL || defaultModel).trim() || defaultModel;

  return {
    apiBaseUrl,
    apiEndpoint: apiBaseUrl,
    defaultModel: model
  };
}

function writeConfigFile(targetPath, config) {
  const content = `window.CENTRAL_IA_CONFIG = ${JSON.stringify(config, null, 2)};\n`;
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, content, "utf8");
}

const config = buildConfig();

writeConfigFile(path.join(root, "public", "config.js"), config);
writeConfigFile(path.join(root, "config.js"), config);

const safeBase = config.apiBaseUrl || "(mesmo dominio do frontend)";
console.log(`[config] apiBaseUrl: ${safeBase}`);
console.log(`[config] defaultModel: ${config.defaultModel}`);

