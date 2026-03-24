import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

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

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    const message = String(result.stderr || result.stdout || "").trim();
    throw new Error(message || `${command} ${args.join(" ")} failed`);
  }

  return String(result.stdout || "").trim();
}

function readTextFileSafe(filePath) {
  try {
    if (!fs.existsSync(filePath)) return "";
    return String(fs.readFileSync(filePath, "utf8") || "").trim();
  } catch {
    return "";
  }
}

function readConfigModel() {
  const candidates = [
    path.join(root, "config.js"),
    path.join(root, "public", "config.js")
  ];

  for (const filePath of candidates) {
    const raw = readTextFileSafe(filePath);
    if (!raw) continue;

    const match = raw.match(/window\.CENTRAL_IA_CONFIG\s*=\s*(\{[\s\S]*\})\s*;?\s*$/);
    if (!match?.[1]) continue;

    try {
      const parsed = JSON.parse(match[1]);
      const model = String(parsed.defaultModel || "").trim();
      if (model) return model;
    } catch {
      // Keep searching.
    }
  }

  return defaultModel;
}

function writeConfig(apiBaseUrl) {
  const model = readConfigModel();
  const config = {
    apiBaseUrl,
    apiEndpoint: apiBaseUrl,
    backendUrl: "",
    defaultModel: model || defaultModel
  };

  const content = `window.CENTRAL_IA_CONFIG = ${JSON.stringify(config, null, 2)};\n`;
  fs.writeFileSync(path.join(root, "config.js"), content, "utf8");
  fs.mkdirSync(path.join(root, "public"), { recursive: true });
  fs.writeFileSync(path.join(root, "public", "config.js"), content, "utf8");
}

function hasChangesForConfig() {
  const result = spawnSync("git", ["status", "--porcelain", "--", "config.js", "public/config.js"], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
  if (result.error) {
    throw result.error;
  }
  return String(result.stdout || "").trim().length > 0;
}

function currentBranch() {
  return run("git", ["branch", "--show-current"]) || "main";
}

function githubPagesUrlFromOrigin() {
  const origin = run("git", ["remote", "get-url", "origin"]);
  const httpsMatch = origin.match(/github\.com[:/]+([^/]+)\/(.+?)(?:\.git)?$/i);
  if (!httpsMatch) return "";

  const owner = httpsMatch[1];
  const repo = httpsMatch[2];
  if (!owner || !repo) return "";

  if (repo.toLowerCase() === `${owner.toLowerCase()}.github.io`) {
    return `https://${owner}.github.io/`;
  }

  return `https://${owner}.github.io/${repo}/`;
}

function main() {
  const argUrl = process.argv[2] || "";
  const fromFile = readTextFileSafe(path.join(root, "public_url.txt"));
  const apiBaseUrl = normalizeBase(argUrl || fromFile);

  if (!apiBaseUrl) {
    throw new Error("Nao foi possivel detectar URL publica. Rode launch_public.js primeiro.");
  }

  run("git", ["rev-parse", "--is-inside-work-tree"]);

  writeConfig(apiBaseUrl);
  run("git", ["add", "config.js", "public/config.js"]);

  if (!hasChangesForConfig()) {
    console.log(`[sync] Config ja estava em ${apiBaseUrl}`);
    const pages = githubPagesUrlFromOrigin();
    if (pages) {
      console.log(`[sync] GitHub Pages: ${pages}`);
    }
    return;
  }

  const commitMessage = `Atualiza API publica para PC ligado: ${apiBaseUrl}`;
  run("git", ["commit", "-m", commitMessage, "--", "config.js", "public/config.js"]);
  run("git", ["push", "origin", currentBranch()]);

  console.log(`[sync] Config publicada: ${apiBaseUrl}`);
  const pages = githubPagesUrlFromOrigin();
  if (pages) {
    console.log(`[sync] GitHub Pages: ${pages}`);
  }
}

try {
  main();
} catch (error) {
  console.error(`[sync] ERRO: ${String(error?.message || error)}`);
  process.exit(1);
}
