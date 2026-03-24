import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const trackedFile = path.join(root, "public_backend_url.txt");
const runtimeFile = path.join(root, "public_url.txt");

function normalizeBase(raw) {
  const value = String(raw || "").trim();
  if (!value) return "";
  try {
    const parsed = new URL(value.startsWith("http") ? value : `https://${value}`);
    parsed.search = "";
    parsed.hash = "";
    parsed.pathname = parsed.pathname.replace(/\/+$/, "");
    return parsed.toString().replace(/\/+$/, "");
  } catch {
    return "";
  }
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    const text = String(result.stderr || result.stdout || "").trim();
    throw new Error(text || `${command} ${args.join(" ")} failed`);
  }
  return String(result.stdout || "").trim();
}

function readText(filePath) {
  try {
    if (!fs.existsSync(filePath)) return "";
    return String(fs.readFileSync(filePath, "utf8") || "").trim();
  } catch {
    return "";
  }
}

function writeTrackedUrl(url) {
  fs.writeFileSync(trackedFile, `${url}\n`, "utf8");
}

function hasTrackedChange() {
  const result = spawnSync("git", ["status", "--porcelain", "--", "public_backend_url.txt"], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
  if (result.error) throw result.error;
  return String(result.stdout || "").trim().length > 0;
}

function currentBranch() {
  return run("git", ["branch", "--show-current"]) || "main";
}

function githubPagesUrlFromOrigin() {
  const origin = run("git", ["remote", "get-url", "origin"]);
  const match = origin.match(/github\.com[:/]+([^/]+)\/(.+?)(?:\.git)?$/i);
  if (!match) return "";
  const owner = match[1];
  const repo = match[2];
  if (!owner || !repo) return "";
  if (repo.toLowerCase() === `${owner.toLowerCase()}.github.io`) {
    return `https://${owner}.github.io/`;
  }
  return `https://${owner}.github.io/${repo}/`;
}

function main() {
  const fromArg = process.argv[2] || "";
  const fromRuntimeFile = readText(runtimeFile);
  const backendUrl = normalizeBase(fromArg || fromRuntimeFile);

  if (!backendUrl) {
    throw new Error("Nao foi possivel determinar URL publica do backend.");
  }

  run("git", ["rev-parse", "--is-inside-work-tree"]);
  writeTrackedUrl(backendUrl);
  run("git", ["add", "public_backend_url.txt"]);

  if (!hasTrackedChange()) {
    console.log(`[sync-backend] URL ja estava atualizada: ${backendUrl}`);
    const pages = githubPagesUrlFromOrigin();
    if (pages) console.log(`[sync-backend] GitHub Pages: ${pages}`);
    return;
  }

  run("git", ["commit", "-m", `Atualiza backend publico atual: ${backendUrl}`, "--", "public_backend_url.txt"]);
  run("git", ["push", "origin", currentBranch()]);

  console.log(`[sync-backend] URL publicada: ${backendUrl}`);
  const pages = githubPagesUrlFromOrigin();
  if (pages) console.log(`[sync-backend] GitHub Pages: ${pages}`);
}

try {
  main();
} catch (error) {
  console.error(`[sync-backend] ERRO: ${String(error?.message || error)}`);
  process.exit(1);
}
