import fs from "node:fs";
import path from "node:path";
import { execSync, spawnSync } from "node:child_process";

const ROOT = process.cwd();
const REPO = "netomeker/IA-Auto";
const MODEL = "deepseek-ai/deepseek-v3.2";
const LOOP_MS = Number(process.env.AUTO_SYNC_INTERVAL_MS || 120000);
const PID_FILE = path.join(ROOT, "auto_sync.pid");
const LOG_FILE = path.join(ROOT, "auto_sync.log");

function nowIso() {
  return new Date().toISOString();
}

function log(message) {
  const line = `[${nowIso()}] ${message}`;
  console.log(line);
  try {
    fs.appendFileSync(LOG_FILE, `${line}\n`);
  } catch {
    // Ignore logging errors.
  }
}

function runCommand(command, options = {}) {
  try {
    const output = execSync(command, {
      cwd: ROOT,
      encoding: "utf8",
      stdio: "pipe",
      ...options
    });
    return String(output || "").trim();
  } catch (error) {
    const stderr = String(error?.stderr || "").trim();
    const stdout = String(error?.stdout || "").trim();
    const details = stderr || stdout || String(error?.message || error);
    throw new Error(`${command} -> ${details}`);
  }
}

function runNodeScript(relativePath) {
  const result = spawnSync(process.execPath, [relativePath], {
    cwd: ROOT,
    encoding: "utf8",
    stdio: "pipe"
  });

  if (result.status !== 0) {
    throw new Error(`node ${relativePath} -> ${String(result.stderr || result.stdout || "").trim()}`);
  }

  const text = String(result.stdout || "").trim();
  if (text) {
    log(text);
  }
}

function readTextSafe(filePath) {
  try {
    if (!fs.existsSync(filePath)) return "";
    return String(fs.readFileSync(filePath, "utf8") || "").trim();
  } catch {
    return "";
  }
}

function parseGitCredential() {
  const raw = runCommand("git credential fill", {
    input: "protocol=https\nhost=github.com\n\n"
  });

  const data = {};
  raw.split(/\r?\n/).forEach((line) => {
    const idx = line.indexOf("=");
    if (idx > 0) {
      data[line.slice(0, idx)] = line.slice(idx + 1);
    }
  });

  if (!data.username || !data.password) {
    throw new Error("Credencial GitHub nao encontrada no Git Credential Manager.");
  }

  return data;
}

async function ghRequest(routePath, method = "GET", body = undefined) {
  const { username, password } = parseGitCredential();
  const headers = {
    Accept: "application/vnd.github+json",
    Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`,
    "X-GitHub-Api-Version": "2022-11-28"
  };

  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  const response = await fetch(`https://api.github.com${routePath}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });

  const raw = await response.text();
  let payload = null;

  try {
    payload = JSON.parse(raw);
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const message = payload?.message || raw || `HTTP ${response.status}`;
    const error = new Error(`GitHub API ${method} ${routePath} -> ${response.status} ${message}`);
    error.status = response.status;
    throw error;
  }

  return payload;
}

async function upsertRepoVariable(name, value) {
  try {
    await ghRequest(`/repos/${REPO}/actions/variables/${name}`, "PATCH", { name, value });
    return "updated";
  } catch (error) {
    if (Number(error?.status) === 404) {
      await ghRequest(`/repos/${REPO}/actions/variables`, "POST", { name, value });
      return "created";
    }
    throw error;
  }
}

async function triggerPagesWorkflow() {
  await ghRequest(`/repos/${REPO}/actions/workflows/deploy-pages.yml/dispatches`, "POST", {
    ref: "main"
  });
}

async function checkHealth(urlBase) {
  if (!urlBase) return false;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const response = await fetch(`${urlBase}/api/health`, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: controller.signal
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

function configFilesChanged() {
  const out = runCommand("git status --porcelain -- config.js public/config.js");
  return Boolean(out.trim());
}

function sanitizeCommitMessage(text) {
  return String(text || "")
    .replace(/[^a-zA-Z0-9:/._-]+/g, "-")
    .slice(0, 100);
}

function commitAndPushIfNeeded(url) {
  if (!configFilesChanged()) {
    return false;
  }

  runCommand("git add config.js public/config.js");
  runCommand(`git commit -m "Auto sync endpoint ${sanitizeCommitMessage(url)}"`);
  runCommand("git push origin main");
  return true;
}

async function synchronize() {
  runNodeScript("launch_public.js");

  const url = readTextSafe(path.join(ROOT, "public_url.txt"));
  if (!url.startsWith("http")) {
    throw new Error("public_url.txt sem URL valida.");
  }

  const healthy = await checkHealth(url);
  if (!healthy) {
    throw new Error(`Tunnel sem saude: ${url}`);
  }

  runNodeScript(path.join("scripts", "build-public-config.mjs"));
  const pushed = commitAndPushIfNeeded(url);

  const v1 = await upsertRepoVariable("PUBLIC_API_BASE_URL", url);
  const v2 = await upsertRepoVariable("PUBLIC_MODEL", MODEL);
  await triggerPagesWorkflow();

  log(`Sincronizado: ${url} | commitPush=${pushed} | varBase=${v1} | varModel=${v2}`);
}

async function loopForever() {
  fs.writeFileSync(PID_FILE, String(process.pid));
  log(`Auto-sync iniciado. Intervalo ${LOOP_MS}ms.`);

  while (true) {
    try {
      await synchronize();
    } catch (error) {
      log(`Falha na sincronizacao: ${String(error?.message || error)}`);
    }

    await new Promise((resolve) => setTimeout(resolve, LOOP_MS));
  }
}

process.on("SIGINT", () => {
  try {
    if (fs.existsSync(PID_FILE)) fs.unlinkSync(PID_FILE);
  } catch {
    // Ignore cleanup errors.
  }
  process.exit(0);
});

process.on("SIGTERM", () => {
  try {
    if (fs.existsSync(PID_FILE)) fs.unlinkSync(PID_FILE);
  } catch {
    // Ignore cleanup errors.
  }
  process.exit(0);
});

loopForever().catch((error) => {
  log(`Erro fatal: ${String(error?.message || error)}`);
  process.exit(1);
});
