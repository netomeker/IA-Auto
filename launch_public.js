const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const ROOT = process.cwd();
const HEALTH_URL = "http://127.0.0.1:3000/api/health";
const URL_FILE = path.join(ROOT, "public_url.txt");
const PID_FILE = path.join(ROOT, "public_tunnel.pid");
const FAIL_FILE = path.join(ROOT, "public_tunnel_fail_count.txt");
const MAX_UNHEALTHY_BEFORE_RESTART = 3;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function checkJson(url, timeoutMs = 8000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) return null;
    const json = await response.json();
    return json;
  } catch (_error) {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function spawnDetachedNode(args, outLog, errLog) {
  const outFd = fs.openSync(path.join(ROOT, outLog), "a");
  const errFd = fs.openSync(path.join(ROOT, errLog), "a");
  const child = spawn(process.execPath, args, {
    cwd: ROOT,
    detached: true,
    stdio: ["ignore", outFd, errFd]
  });
  child.unref();
  return child.pid;
}

async function ensureServer() {
  const healthy = await checkJson(HEALTH_URL, 3000);
  if (healthy?.ok) {
    return;
  }

  spawnDetachedNode(["server.js"], "server.public.out.log", "server.public.err.log");

  for (let i = 0; i < 25; i += 1) {
    await delay(1000);
    const status = await checkJson(HEALTH_URL, 3000);
    if (status?.ok) {
      return;
    }
  }

  throw new Error("Backend nao iniciou na porta 3000.");
}

function pidIsRunning(pidRaw) {
  const pid = Number(pidRaw);
  if (!pid || Number.isNaN(pid)) {
    return false;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch (_error) {
    return false;
  }
}

function stopPid(pidRaw) {
  const pid = Number(pidRaw);
  if (!pid || Number.isNaN(pid)) {
    return false;
  }

  try {
    process.kill(pid, "SIGTERM");
    return true;
  } catch (_error) {
    return false;
  }
}

function readFailCount() {
  try {
    if (!fs.existsSync(FAIL_FILE)) return 0;
    const raw = Number(String(fs.readFileSync(FAIL_FILE, "utf-8")).trim());
    return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 0;
  } catch (_error) {
    return 0;
  }
}

function writeFailCount(value) {
  try {
    const safe = Math.max(0, Math.floor(Number(value) || 0));
    fs.writeFileSync(FAIL_FILE, String(safe), "utf-8");
  } catch (_error) {
    // Ignore write failures.
  }
}

function resetFailCount() {
  writeFailCount(0);
}

async function getPublicUrlState() {
  const raw = fs.existsSync(URL_FILE) ? String(fs.readFileSync(URL_FILE, "utf-8")).trim() : "";
  if (!raw.startsWith("http")) {
    return { url: "", healthy: false };
  }

  const check = await checkJson(`${raw}/api/health`, 12000);
  return { url: raw, healthy: Boolean(check?.ok) };
}

async function ensureTunnel() {
  const existingPid = fs.existsSync(PID_FILE) ? String(fs.readFileSync(PID_FILE, "utf-8")).trim() : "";
  const existingState = await getPublicUrlState();
  const tunnelRunning = Boolean(existingPid && pidIsRunning(existingPid));

  if (tunnelRunning && existingState.healthy) {
    resetFailCount();
    return existingState.url;
  }

  if (tunnelRunning && existingState.url && !existingState.healthy) {
    const failCount = readFailCount() + 1;
    writeFailCount(failCount);

    if (failCount < MAX_UNHEALTHY_BEFORE_RESTART) {
      return existingState.url;
    }

    stopPid(existingPid);
    await delay(700);
  }

  spawnDetachedNode(["tunnel_runner.js"], "tunnel_runner.out.log", "tunnel_runner.err.log");

  for (let i = 0; i < 40; i += 1) {
    await delay(1000);
    const nextState = await getPublicUrlState();
    if (nextState.healthy) {
      resetFailCount();
      return nextState.url;
    }
  }

  throw new Error("Tunnel publico nao iniciou.");
}

async function main() {
  await ensureServer();
  const publicUrl = await ensureTunnel();
  console.log(`PUBLIC_URL=${publicUrl}`);
}

main().catch((error) => {
  console.error(`ERRO=${error.message || error}`);
  process.exit(1);
});
