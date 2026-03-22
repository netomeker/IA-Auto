const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = process.cwd();
const HEALTH_URL = 'http://127.0.0.1:3000/api/health';
const URL_FILE = path.join(ROOT, 'public_url.txt');
const PID_FILE = path.join(ROOT, 'public_tunnel.pid');

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
  const outFd = fs.openSync(path.join(ROOT, outLog), 'a');
  const errFd = fs.openSync(path.join(ROOT, errLog), 'a');
  const child = spawn(process.execPath, args, {
    cwd: ROOT,
    detached: true,
    stdio: ['ignore', outFd, errFd]
  });
  child.unref();
  return child.pid;
}

async function ensureServer() {
  const healthy = await checkJson(HEALTH_URL, 3000);
  if (healthy?.ok) {
    return;
  }

  spawnDetachedNode(['server.js'], 'server.public.out.log', 'server.public.err.log');

  for (let i = 0; i < 25; i += 1) {
    await delay(1000);
    const status = await checkJson(HEALTH_URL, 3000);
    if (status?.ok) {
      return;
    }
  }

  throw new Error('Backend não iniciou na porta 3000.');
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

async function getPublicUrl() {
  const raw = fs.existsSync(URL_FILE) ? String(fs.readFileSync(URL_FILE, 'utf-8')).trim() : '';
  if (!raw.startsWith('http')) {
    return '';
  }

  const check = await checkJson(`${raw}/api/health`, 12000);
  return check?.ok ? raw : '';
}

async function ensureTunnel() {
  const existingPid = fs.existsSync(PID_FILE) ? fs.readFileSync(PID_FILE, 'utf-8').trim() : '';
  const existingUrl = await getPublicUrl();

  if (existingPid && pidIsRunning(existingPid) && existingUrl) {
    return existingUrl;
  }

  spawnDetachedNode(['tunnel_runner.js'], 'tunnel_runner.out.log', 'tunnel_runner.err.log');

  for (let i = 0; i < 40; i += 1) {
    await delay(1000);
    const nextUrl = await getPublicUrl();
    if (nextUrl) {
      return nextUrl;
    }
  }

  throw new Error('Tunnel público não iniciou.');
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
