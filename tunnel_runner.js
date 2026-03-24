const fs = require("fs");
const path = require("path");
const { spawn, spawnSync } = require("child_process");
const localtunnel = require("localtunnel");

const ROOT = process.cwd();
const URL_FILE = path.join(ROOT, "public_url.txt");
const LOG_FILE = path.join(ROOT, "public_tunnel.log");
const PID_FILE = path.join(ROOT, "public_tunnel.pid");
const CLOUD_FLARED_LOCAL_PATH = path.join(ROOT, "tools", "cloudflared.exe");
const URL_REGEX = /(https:\/\/[a-z0-9-]+\.trycloudflare\.com)/i;

function log(message) {
  const line = `[${new Date().toISOString()}] ${message}\n`;
  fs.appendFileSync(LOG_FILE, line);
}

function cleanupPid() {
  try {
    if (fs.existsSync(PID_FILE)) {
      fs.unlinkSync(PID_FILE);
    }
  } catch (_error) {
    // Ignore cleanup errors.
  }
}

function writeUrl(url) {
  const value = String(url || "").trim();
  fs.writeFileSync(URL_FILE, value, "utf8");
  log(`Tunnel URL: ${value}`);
}

function splitLines(chunk) {
  return String(chunk || "")
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function detectCloudflaredPath() {
  const fromEnv = String(process.env.CLOUDFLARED_BIN || "").trim();
  if (fromEnv && fs.existsSync(fromEnv)) {
    return fromEnv;
  }

  if (fs.existsSync(CLOUD_FLARED_LOCAL_PATH)) {
    return CLOUD_FLARED_LOCAL_PATH;
  }

  try {
    const where = spawnSync("where", ["cloudflared"], {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    });
    if (where.status === 0) {
      const first = String(where.stdout || "")
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find(Boolean);
      if (first) return first;
    }
  } catch (_error) {
    // Ignore.
  }

  return "";
}

async function startLocaltunnel() {
  const tunnelHost = String(process.env.LT_HOST || "https://loca.lt").trim();
  log(`Starting localtunnel on port 3000 via host ${tunnelHost}`);

  const requestedSubdomain = String(process.env.LT_SUBDOMAIN || "").trim();
  const tunnelOptions = { port: 3000, host: tunnelHost };

  if (requestedSubdomain) {
    tunnelOptions.subdomain = requestedSubdomain;
    log(`Requested subdomain: ${requestedSubdomain}`);
  }

  const tunnel = await localtunnel(tunnelOptions);
  writeUrl(String(tunnel.url || ""));

  tunnel.on("error", (error) => {
    log(`Localtunnel error: ${String(error?.message || error)}`);
    cleanupPid();
    process.exit(1);
  });

  tunnel.on("close", () => {
    log("Localtunnel closed");
    cleanupPid();
    process.exit(0);
  });

  process.on("SIGINT", () => {
    cleanupPid();
    tunnel.close();
  });
  process.on("SIGTERM", () => {
    cleanupPid();
    tunnel.close();
  });
}

async function startCloudflared(command) {
  log(`Starting cloudflared with binary: ${command}`);

  const args = ["tunnel", "--url", "http://127.0.0.1:3000", "--edge-ip-version", "4", "--no-autoupdate"];
  const child = spawn(command, args, {
    cwd: ROOT,
    stdio: ["ignore", "pipe", "pipe"]
  });

  let ready = false;
  let timeout = null;

  const closeWithSignal = () => {
    if (!child.killed) {
      child.kill("SIGTERM");
    }
  };

  process.on("SIGINT", () => {
    cleanupPid();
    closeWithSignal();
  });
  process.on("SIGTERM", () => {
    cleanupPid();
    closeWithSignal();
  });

  function onLine(line, source) {
    log(`[cloudflared:${source}] ${line}`);
    const match = line.match(URL_REGEX);
    if (match?.[1] && !ready) {
      ready = true;
      clearTimeout(timeout);
      writeUrl(match[1]);
    }
  }

  child.stdout.on("data", (chunk) => {
    for (const line of splitLines(chunk)) {
      onLine(line, "out");
    }
  });

  child.stderr.on("data", (chunk) => {
    for (const line of splitLines(chunk)) {
      onLine(line, "err");
    }
  });

  child.on("error", (error) => {
    log(`cloudflared process error: ${String(error?.message || error)}`);
    if (!ready) {
      cleanupPid();
      process.exit(1);
    }
  });

  child.on("exit", (code, signal) => {
    clearTimeout(timeout);
    log(`cloudflared exited (code=${code}, signal=${signal || "none"})`);
    cleanupPid();
    process.exit(code === 0 ? 0 : 1);
  });

  timeout = setTimeout(() => {
    if (!ready) {
      log("cloudflared timeout waiting for URL");
      closeWithSignal();
    }
  }, 45000);
}

function resolveProvider() {
  const requested = String(process.env.TUNNEL_PROVIDER || "").trim().toLowerCase();
  const cloudflaredPath = detectCloudflaredPath();

  if (requested === "cloudflared") {
    return cloudflaredPath
      ? { provider: "cloudflared", command: cloudflaredPath }
      : { provider: "localtunnel", command: "" };
  }

  if (requested === "localtunnel") {
    return { provider: "localtunnel", command: "" };
  }

  // Default to localtunnel for wider IPv4 compatibility.
  // Use TUNNEL_PROVIDER=cloudflared when explicitly desired.
  return { provider: "localtunnel", command: "" };
}

async function start() {
  try {
    fs.writeFileSync(URL_FILE, "", "utf8");
    fs.writeFileSync(PID_FILE, String(process.pid), "utf8");

    const selected = resolveProvider();
    log(`Tunnel provider selected: ${selected.provider}`);

    if (selected.provider === "cloudflared") {
      await startCloudflared(selected.command);
      return;
    }

    await startLocaltunnel();
  } catch (error) {
    cleanupPid();
    log(`Tunnel error: ${String(error?.message || error)}`);
    process.exit(1);
  }
}

start();
