import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const urlFile = path.join(root, "public_url.txt");
const checkIntervalMs = Math.max(10000, Number(process.env.GH_LOCAL_CHECK_MS || 45000));
const failThreshold = Math.max(1, Number(process.env.GH_LOCAL_FAIL_THRESHOLD || 2));
const retryDelayMs = 6000;

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function log(message) {
  console.log(`[keepalive] ${new Date().toISOString()} ${message}`);
}

function readPublicUrl() {
  try {
    if (!fs.existsSync(urlFile)) return "";
    return String(fs.readFileSync(urlFile, "utf8") || "").trim();
  } catch {
    return "";
  }
}

function runNodeScript(scriptPath, args = []) {
  const result = spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });

  const output = [result.stdout || "", result.stderr || ""].join("\n").trim();
  if (output) {
    console.log(output);
  }

  return result.status === 0;
}

async function isHealthy(url) {
  const base = String(url || "").trim();
  if (!base) return false;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);

  try {
    const response = await fetch(`${base}/api/health`, {
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

async function ensureHealthyUrl() {
  while (true) {
    const ok = runNodeScript(path.join("scripts", "ensure-public-url-healthy.mjs"));
    const url = readPublicUrl();

    if (ok && url) {
      const healthy = await isHealthy(url);
      if (healthy) {
        return url;
      }
    }

    log("URL ainda nao ficou saudavel. Tentando novamente...");
    await wait(retryDelayMs);
  }
}

async function syncGithub(url) {
  const base = String(url || "").trim();
  if (!base) return false;
  return runNodeScript(path.join("scripts", "sync-github-pages-url.mjs"), [base]);
}

log("Iniciando monitor local para GitHub Pages (PC ligado).");

let currentUrl = "";
let consecutiveFails = 0;

while (true) {
  if (!currentUrl) {
    const healthyUrl = await ensureHealthyUrl();
    currentUrl = healthyUrl;
    consecutiveFails = 0;

    const synced = await syncGithub(currentUrl);
    if (synced) {
      log(`GitHub Pages sincronizado com ${currentUrl}`);
      log("Link publico: https://netomeker.github.io/IA-Auto/");
    } else {
      log("Falha ao sincronizar no GitHub. Vou tentar novamente no proximo ciclo.");
    }
  }

  const ok = await isHealthy(currentUrl);
  if (ok) {
    consecutiveFails = 0;
    log(`OK ${currentUrl}`);
    await wait(checkIntervalMs);
    continue;
  }

  consecutiveFails += 1;
  log(`Falha de health ${consecutiveFails}/${failThreshold} em ${currentUrl}`);

  if (consecutiveFails >= failThreshold) {
    log("Trocando URL publica e resincronizando no GitHub...");
    currentUrl = "";
    consecutiveFails = 0;
  }

  await wait(retryDelayMs);
}
