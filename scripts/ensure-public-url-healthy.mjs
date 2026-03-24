import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const urlFile = path.join(root, "public_url.txt");
const maxAttempts = Math.max(1, Number(process.env.PUBLIC_URL_HEALTH_ATTEMPTS || 6));

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readPublicUrl() {
  try {
    if (!fs.existsSync(urlFile)) return "";
    return String(fs.readFileSync(urlFile, "utf8") || "").trim();
  } catch {
    return "";
  }
}

async function isHealthy(baseUrl) {
  const url = String(baseUrl || "").trim();
  if (!url) return false;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);

  try {
    const response = await fetch(`${url}/api/health`, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: controller.signal
    });
    if (!response.ok) return false;
    const data = await response.json().catch(() => null);
    return Boolean(data && data.ok === true);
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

function runLaunchPublic() {
  const result = spawnSync(process.execPath, ["launch_public.js"], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });

  const output = [result.stdout || "", result.stderr || ""].join("\n").trim();
  if (output) {
    console.log(output);
  }
}

let lastUrl = "";
let lastHealthy = false;

for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
  runLaunchPublic();
  const url = readPublicUrl();
  lastUrl = url || lastUrl;

  const healthy = await isHealthy(url);
  lastHealthy = healthy;

  console.log(`[ensure] tentativa ${attempt}/${maxAttempts} -> ${url || "(sem url)"} | healthy=${healthy}`);

  if (healthy && url) {
    console.log(`PUBLIC_URL=${url}`);
    process.exit(0);
  }

  await wait(2200);
}

console.error(`[ensure] ERRO: nao foi possivel obter URL publica saudavel. Ultima URL: ${lastUrl || "(sem url)"}`);
process.exit(lastHealthy ? 0 : 1);
