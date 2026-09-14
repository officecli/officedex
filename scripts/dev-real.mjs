#!/usr/bin/env node

// Starts the renderer against a *real* officedex bridge, in a browser.
//
// `npm run dev:browser` serves the renderer with a stub bridge whose
// readArtifactFile throws, so Writer, the presentation embed and the sheet SDK
// never get any bytes and no document can be opened -- only the home screen and
// the shell render. `wails dev` is fully real but is a native window, so there
// is no DOM, no computed styles and no console to inspect.
//
// This is the middle: the same Go bridge host the real-e2e Playwright suite
// uses (real officecli, real word2mow, real preview tokens) with Vite in front,
// so the app runs in an ordinary browser tab with HMR still live.
//
//   node scripts/dev-real.mjs [document…] [--port 3210] [--keep]
//
// Each document is copied into the app workspace (preview tokens are refused
// outside it), registered, and printed as a ready-to-open URL.

import { spawn } from "node:child_process";
import { copyFile, mkdir, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import net from "node:net";
import path from "node:path";

const ROOT = process.cwd();
// Walked rather than filtered: `--port 3210` would otherwise leave the value
// behind to be mistaken for a document path.
const VALUE_FLAGS = new Set(["port"]);
const documents = [];
const options = new Map();
for (let index = 0, args = process.argv.slice(2); index < args.length; index += 1) {
  const arg = args[index];
  if (!arg.startsWith("--")) {
    documents.push(arg);
    continue;
  }
  const name = arg.slice(2);
  if (VALUE_FLAGS.has(name)) options.set(name, args[++index]);
  else options.set(name, true);
}
const PORT = Number(options.get("port") ?? process.env.OFFICEDEX_DEV_REAL_PORT ?? 3210);
const KEEP = options.get("keep") === true;

const RUN_DIR = path.join(ROOT, "build", "dev-real");
const WORKSPACE = path.join(RUN_DIR, "artifacts", "_app", "workspace", "dev");
const OFFICECLI = process.env.OFFICECLI_DESKTOP_BINARY
  || path.join(ROOT, "build", "officecli", process.platform === "win32" ? "officecli.exe" : "officecli");

const children = [];
let closing = false;

function shutdown(code = 0) {
  if (closing) return;
  closing = true;
  for (const child of children) {
    try {
      child.kill("SIGTERM");
    } catch {
      // already gone
    }
  }
  setTimeout(() => process.exit(code), 300);
}
process.on("SIGINT", () => shutdown(130));
process.on("SIGTERM", () => shutdown(143));

function run(command, commandArgs, options = {}) {
  const child = spawn(command, commandArgs, { cwd: ROOT, ...options });
  children.push(child);
  const prefix = options.prefix ?? command;
  const relay = (stream, sink) => {
    stream?.setEncoding("utf8");
    stream?.on("data", (chunk) => {
      for (const line of chunk.split("\n")) {
        if (line.trim()) sink(`[${prefix}] ${line}`);
      }
    });
  };
  relay(child.stdout, (line) => console.log(line));
  relay(child.stderr, (line) => console.error(line));
  return child;
}

/** Resolves once the bridge announces the endpoint it bound to. */
function waitForEndpoint(child, timeoutMs = 180_000) {
  return new Promise((resolve, reject) => {
    let buffer = "";
    const timer = setTimeout(() => reject(new Error("bridge did not report an endpoint")), timeoutMs);
    const onData = (chunk) => {
      buffer += chunk;
      const match = buffer.match(/OFFICEDEX_REAL_E2E_ENDPOINT=(\S+)/);
      if (!match) return;
      clearTimeout(timer);
      child.stdout.off("data", onData);
      resolve(match[1]);
    };
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", onData);
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`bridge exited with ${code} before reporting an endpoint`));
    });
  });
}

async function waitForHTTP(url, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      await fetch(url, { method: "GET" });
      return;
    } catch {
      if (Date.now() > deadline) throw new Error(`${url} never came up`);
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
  }
}

async function freePort(preferred) {
  const taken = await new Promise((resolve) => {
    const probe = net.createServer();
    probe.once("error", () => resolve(true));
    probe.once("listening", () => probe.close(() => resolve(false)));
    probe.listen(preferred, "127.0.0.1");
  });
  if (!taken) return preferred;
  throw new Error(`port ${preferred} is busy — pass --port <other>`);
}

async function rpc(endpoint, method, input) {
  const response = await fetch(`${endpoint}/rpc/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input ?? null),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || body?.ok === false) {
    throw new Error(`${method}: ${body?.error ?? response.status}`);
  }
  return body?.result;
}

/**
 * Preview tokens are only minted for artifacts the app has registered, and only
 * for files under a trusted root, so the document is copied into the workspace
 * first and registered through PreviewArtifact.
 */
async function openable(endpoint, viteURL, source) {
  const fileName = path.basename(source);
  const documentType = path.extname(fileName).slice(1).toLowerCase();
  const filePath = path.join(WORKSPACE, fileName);
  await copyFile(source, filePath);
  const artifact = { taskId: "dev-real", filePath, fileName, documentType };
  await rpc(endpoint, "PreviewArtifact", artifact);
  const grant = await rpc(endpoint, "IssuePreviewToken", artifact);
  const query = new URLSearchParams({
    offlinePreview: "1",
    previewToken: grant.token,
    fileName: grant.fileName,
    documentType: grant.documentType,
  });
  return { fileName, url: `${viteURL}/?${query}` };
}

async function main() {
  if (!existsSync(OFFICECLI)) {
    console.error(`[dev-real] officecli not staged at ${OFFICECLI}`);
    console.error("[dev-real] run: npm run prefetch:officecli");
    process.exit(1);
  }
  for (const document of documents) {
    if (!existsSync(document)) {
      console.error(`[dev-real] no such document: ${document}`);
      process.exit(1);
    }
  }

  if (!KEEP) await rm(RUN_DIR, { recursive: true, force: true });
  const port = await freePort(PORT);

  const bridgeEnv = {
    ...process.env,
    OFFICEDEX_E2E_REAL: "1",
    OFFICEDEX_E2E_HOST: "1",
    OFFICECLI_DESKTOP_BINARY: OFFICECLI,
    OFFICEDEX_E2E_OUTPUT_DIR: path.join(RUN_DIR, "artifacts"),
    OFFICEDEX_E2E_RUN_DIR: RUN_DIR,
  };
  if (bridgeEnv.GOROOT && !existsSync(bridgeEnv.GOROOT)) delete bridgeEnv.GOROOT;

  console.log("[dev-real] starting the bridge (real officecli)…");
  const bridge = run("go", [
    "test", "-tags", "real_e2e", ".",
    "-run", "TestRealOfficeDexClientBridgeHost",
    "-count=1", "-timeout", "0", "-v",
  ], { env: bridgeEnv, prefix: "bridge", stdio: ["ignore", "pipe", "pipe"] });
  const endpoint = await waitForEndpoint(bridge);
  console.log(`[dev-real] bridge: ${endpoint}`);

  const viteURL = `http://127.0.0.1:${port}`;
  run("npx", ["vite", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
    env: { ...process.env, VITE_OFFICEDEX_REAL_E2E_ENDPOINT: endpoint },
    prefix: "vite",
    stdio: ["ignore", "pipe", "pipe"],
  });
  await waitForHTTP(viteURL);

  // Only now: the bridge clears its output dir as it boots, taking any
  // workspace directory made before it with it.
  await mkdir(WORKSPACE, { recursive: true });
  const opened = [];
  for (const document of documents) {
    try {
      opened.push(await openable(endpoint, viteURL, path.resolve(document)));
    } catch (error) {
      console.error(`[dev-real] could not open ${document}: ${error.message}`);
    }
  }

  console.log("");
  console.log("┌─ dev-real ready ─────────────────────────────────────────");
  console.log(`│ app     ${viteURL}`);
  console.log(`│ bridge  ${endpoint}`);
  for (const { fileName, url } of opened) console.log(`│ ${fileName}\n│   ${url}`);
  console.log("└──────────────────────────────────────────────────────────");
  console.log("[dev-real] HMR is live — edit the renderer and it hot-updates. Ctrl+C to stop.");
}

main().catch((error) => {
  console.error(`[dev-real] ${error.message}`);
  shutdown(1);
});
