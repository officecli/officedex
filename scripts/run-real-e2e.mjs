#!/usr/bin/env node

import { createWriteStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";

const repoRoot = process.cwd();
const rawArgs = process.argv.slice(2).filter((arg) => arg !== "--");
const wantsList = rawArgs.includes("--list") || rawArgs.includes("-list");
const playwrightArgs = rawArgs.filter((arg) => arg !== "--list" && arg !== "-list");

if (wantsList) {
  const status = run("npx", ["playwright", "test", "--list", ...playwrightArgs]);
  process.exit(status);
}

const runId = process.env.OFFICEDEX_E2E_RUN_ID || timestamp();
const runDir = path.join(repoRoot, "test-results", `real-e2e-${runId}`);
const artifactDir = path.join(runDir, "artifacts");
const logDir = path.join(runDir, "logs");
const playwrightOutputDir = path.join(runDir, "playwright-output");
const playwrightJsonPath = path.join(runDir, "playwright-report.json");
const finalReportPath = path.join(runDir, "report.json");
const markdownReportPath = path.join(runDir, "report.md");
const officecliBinary = process.env.OFFICECLI_DESKTOP_BINARY || path.join(repoRoot, "build", "officecli", process.platform === "win32" ? "officecli.exe" : "officecli");

class ExitError extends Error {
  constructor(status) {
    super(`command exited with ${status}`);
    this.status = status;
  }
}

mkdirSync(artifactDir, { recursive: true });
mkdirSync(logDir, { recursive: true });
mkdirSync(playwrightOutputDir, { recursive: true });

const children = [];
let bridgeEndpoint = "";
let viteURL = "";
let bridgeReport = null;
let playwrightExitCode = null;
let failure = "";

process.on("SIGINT", () => {
  cleanup();
  process.exit(130);
});
process.on("SIGTERM", () => {
  cleanup();
  process.exit(143);
});

try {
  const prefetchStatus = run("npm", ["run", "prefetch:officecli"]);
  if (prefetchStatus !== 0) {
    failure = "prefetch:officecli failed";
    throw new ExitError(prefetchStatus);
  }

  const baseEnv = {
    ...process.env,
    OFFICEDEX_E2E_REAL: "1",
    OFFICEDEX_E2E_REAL_GENERATE: "1",
    OFFICECLI_DESKTOP_BINARY: officecliBinary,
    OFFICEDEX_E2E_OUTPUT_DIR: artifactDir,
    OFFICEDEX_E2E_RUN_DIR: runDir,
  };
  const bridgeEnv = {
    ...baseEnv,
    OFFICEDEX_E2E_HOST: "1",
  };
  if (bridgeEnv.GOROOT && !existsSync(bridgeEnv.GOROOT)) {
    delete bridgeEnv.GOROOT;
  }

  const bridge = spawnLogged("go", [
    "test",
    "-tags",
    "real_e2e",
    ".",
    "-run",
    "TestRealOfficeDexClientBridgeHost",
    "-count=1",
    "-timeout",
    "0",
    "-v",
  ], {
    env: bridgeEnv,
    logFile: path.join(logDir, "bridge-host.log"),
    prefix: "[real-e2e:bridge]",
  });
  children.push(bridge);

  bridgeEndpoint = await waitForBridgeEndpoint(bridge, 120_000);
  console.log(`[real-e2e] bridge endpoint: ${bridgeEndpoint}`);

  const vitePort = Number(process.env.OFFICEDEX_E2E_VITE_PORT || 0) || await getFreePort();
  viteURL = `http://127.0.0.1:${vitePort}`;
  const vite = spawnLogged("npx", ["vite", "--host", "127.0.0.1", "--port", String(vitePort), "--strictPort"], {
    env: {
      ...process.env,
      VITE_OFFICEDEX_REAL_E2E_ENDPOINT: bridgeEndpoint,
    },
    logFile: path.join(logDir, "vite.log"),
    prefix: "[real-e2e:vite]",
  });
  children.push(vite);
  await waitForHTTP(viteURL, 120_000);
  console.log(`[real-e2e] vite: ${viteURL}`);

  playwrightExitCode = run("npx", ["playwright", "test", ...playwrightArgs], {
    env: {
      ...baseEnv,
      OFFICEDEX_REAL_E2E_ENDPOINT: bridgeEndpoint,
      PLAYWRIGHT_BASE_URL: viteURL,
      OFFICEDEX_E2E_JSON_REPORT: playwrightJsonPath,
      OFFICEDEX_E2E_PLAYWRIGHT_OUTPUT: playwrightOutputDir,
    },
  });

  bridgeReport = await fetchJSON(`${bridgeEndpoint}/control/report`).catch((error) => ({
    status: "unavailable",
    error: error instanceof Error ? error.message : String(error),
  }));
  if (playwrightExitCode !== 0) {
    failure = `Playwright exited with ${playwrightExitCode}`;
  }
} catch (error) {
  if (!failure) {
    failure = error instanceof Error ? error.message : String(error);
  }
  if (bridgeEndpoint) {
    bridgeReport = await fetchJSON(`${bridgeEndpoint}/control/report`).catch(() => null);
  }
  if (error instanceof ExitError) {
    playwrightExitCode = playwrightExitCode ?? error.status;
  } else {
    playwrightExitCode = playwrightExitCode ?? 1;
  }
} finally {
  cleanup();
}

const records = recordsFromBridgeReport(bridgeReport);
const status = playwrightExitCode === 0 ? "passed" : "failed";
writeFinalReport({
  status,
  runId,
  runDir,
  artifactDir,
  logDir,
  playwrightOutputDir,
  playwrightJsonPath,
  officecliBinary,
  bridgeEndpoint,
  viteURL,
  playwrightExitCode,
  bridgeReport,
  records,
  failure,
});

console.log(`[real-e2e] report: ${finalReportPath}`);
console.log(`[real-e2e] markdown: ${markdownReportPath}`);
console.log(`[real-e2e] logs: ${logDir}`);
console.log(`[real-e2e] artifacts: ${artifactDir}`);

process.exit(status === "passed" ? 0 : 1);

function run(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, {
    cwd: repoRoot,
    stdio: "inherit",
    env: options.env ?? process.env,
  });
  return result.status ?? 1;
}

function spawnLogged(command, commandArgs, options) {
  const log = createWriteStream(options.logFile, { flags: "a" });
  const child = spawn(command, commandArgs, {
    cwd: repoRoot,
    env: options.env ?? process.env,
    stdio: ["ignore", "pipe", "pipe"],
    detached: process.platform !== "win32",
  });
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdoutBuffer = "";
  const write = (stream, chunk) => {
    log.write(chunk);
    for (const line of String(chunk).split(/\r?\n/)) {
      if (line.trim()) stream.write(`${options.prefix} ${line}\n`);
    }
  };
  child.stdout.on("data", (chunk) => {
    child.stdoutBuffer += String(chunk);
    write(process.stdout, chunk);
  });
  child.stderr.on("data", (chunk) => write(process.stderr, chunk));
  child.on("exit", (code, signal) => {
    log.write(`${options.prefix} exited code=${code ?? ""} signal=${signal ?? ""}\n`);
    log.end();
  });
  return child;
}

function waitForBridgeEndpoint(child, timeoutMs) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    let buffer = child.stdoutBuffer || "";
    const initialMatch = buffer.match(/OFFICEDEX_REAL_E2E_ENDPOINT=(http:\/\/[^\s]+)/);
    if (initialMatch) {
      resolve(initialMatch[1]);
      return;
    }
    const onData = (chunk) => {
      buffer += String(chunk);
      const match = buffer.match(/OFFICEDEX_REAL_E2E_ENDPOINT=(http:\/\/[^\s]+)/);
      if (match) {
        cleanupListeners();
        resolve(match[1]);
      }
    };
    const onExit = (code, signal) => {
      cleanupListeners();
      reject(new Error(`real E2E bridge host exited before endpoint was ready (code=${code ?? ""}, signal=${signal ?? ""})`));
    };
    const timer = setInterval(() => {
      if (Date.now() - started > timeoutMs) {
        cleanupListeners();
        reject(new Error("timed out waiting for real E2E bridge endpoint"));
      }
    }, 250);
    const cleanupListeners = () => {
      clearInterval(timer);
      child.stdout.off("data", onData);
      child.off("exit", onExit);
    };
    child.stdout.on("data", onData);
    child.on("exit", onExit);
  });
}

async function waitForHTTP(url, timeoutMs) {
  const started = Date.now();
  let lastError = "";
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url, { method: "GET" });
      if (response.status < 500) return;
      lastError = `${response.status} ${response.statusText}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await sleep(250);
  }
  throw new Error(`timed out waiting for ${url}: ${lastError}`);
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

async function fetchJSON(url) {
  const response = await fetch(url);
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(body?.error || `${url} failed with ${response.status}`);
  }
  return body;
}

function cleanup() {
  for (const child of children.reverse()) {
    if (!child || child.killed || child.exitCode !== null) continue;
    try {
      if (process.platform !== "win32") {
        process.kill(-child.pid, "SIGTERM");
      } else {
        child.kill("SIGTERM");
      }
    } catch {
      try {
        child.kill("SIGTERM");
      } catch {
        // Process already exited.
      }
    }
  }
}

function writeFinalReport(input) {
  const officecliVersion = officecliVersionString(input.officecliBinary);
  const finalReport = {
    status: input.status,
    runId: input.runId,
    generatedAt: new Date().toISOString(),
    officecliBinary: input.officecliBinary,
    officecliVersion,
    runDir: input.runDir,
    artifactDir: input.artifactDir,
    logDir: input.logDir,
    playwrightOutputDir: input.playwrightOutputDir,
    playwrightJsonPath: input.playwrightJsonPath,
    bridgeEndpoint: input.bridgeEndpoint,
    viteURL: input.viteURL,
    playwrightExitCode: input.playwrightExitCode,
    failure: input.failure || undefined,
    summary: summarize(input.records),
    records: input.records,
    sourceReports: {
      bridge: input.bridgeReport,
      playwrightJson: readJSON(input.playwrightJsonPath),
    },
  };
  mkdirSync(input.runDir, { recursive: true });
  writeFileSync(finalReportPath, `${JSON.stringify(finalReport, null, 2)}\n`);
  writeFileSync(markdownReportPath, markdownReport(finalReport));
}

function recordsFromBridgeReport(report) {
  if (!report || !Array.isArray(report.records)) return [];
  return report.records.map((record) => ({
    source: record.source || "playwright",
    operation: "ui-scenario",
    name: record.uiScenario || record.name || "",
    documentType: record.documentType,
    mode: record.mode,
    taskId: record.taskId,
    filePath: record.artifactPath,
    fileSize: record.fileSize,
    durationMs: record.durationMs,
    credits: record.credits,
    runtime: record.runtime,
    error: record.error,
    recordedAt: record.recordedAt,
  }));
}

function summarize(records) {
  const byDocumentType = {};
  const byMode = {};
  const artifacts = [];
  for (const record of records ?? []) {
    if (record.documentType) byDocumentType[record.documentType] = (byDocumentType[record.documentType] || 0) + 1;
    if (record.mode) byMode[record.mode] = (byMode[record.mode] || 0) + 1;
    if (record.filePath && existsSync(record.filePath)) {
      let size = record.fileSize;
      if (!Number.isFinite(size)) {
        try {
          size = statSync(record.filePath).size;
        } catch {
          size = null;
        }
      }
      artifacts.push({ path: record.filePath, size });
    }
  }
  return {
    recordCount: records?.length ?? 0,
    byDocumentType,
    byMode,
    artifactCount: artifacts.length,
    artifacts,
  };
}

function markdownReport(report) {
  const lines = [];
  lines.push("# OfficeDex Real Client E2E Report");
  lines.push("");
  lines.push(`- Status: ${report.status}`);
  lines.push(`- Run ID: ${report.runId}`);
  lines.push(`- Generated at: ${report.generatedAt}`);
  lines.push(`- OfficeCLI: ${report.officecliVersion || report.officecliBinary}`);
  lines.push(`- Browser URL: ${report.viteURL || "not started"}`);
  lines.push(`- Bridge endpoint: ${report.bridgeEndpoint || "not started"}`);
  lines.push(`- Artifacts: ${report.artifactDir}`);
  lines.push(`- Logs: ${report.logDir}`);
  lines.push(`- Playwright output: ${report.playwrightOutputDir}`);
  if (report.failure) lines.push(`- Failure: ${report.failure}`);
  lines.push("");
  lines.push("## UI Scenario Records");
  lines.push("");
  lines.push("| Scenario | Document | Mode | Task | Duration | Size | Artifact |");
  lines.push("| --- | --- | --- | --- | ---: | ---: | --- |");
  for (const record of report.records ?? []) {
    lines.push([
      record.name || "",
      record.documentType || "",
      record.mode || "",
      record.taskId || "",
      record.durationMs != null ? `${record.durationMs} ms` : "",
      record.fileSize ?? "",
      record.filePath || record.error || "",
    ].map(markdownCell).join(" | ").replace(/^/, "| ").replace(/$/, " |"));
  }
  lines.push("");
  lines.push("## Notes");
  lines.push("");
  lines.push("- This run drives the dev renderer in Chromium through Playwright.");
  lines.push("- Renderer calls go through the real local E2E bridge host, real OfficeDex App methods, and the real bundled OfficeCLI binary.");
  lines.push("- Local HTTP control endpoints are used only for external-system stand-ins, OS-action recording, fixtures, and final report collection.");
  return `${lines.join("\n")}\n`;
}

function readJSON(filePath) {
  if (!filePath || !existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function officecliVersionString(binary) {
  if (!binary || !existsSync(binary)) return "";
  const result = spawnSync(binary, ["--version"], { cwd: repoRoot, encoding: "utf8" });
  if (result.status !== 0) return "";
  return (result.stdout || result.stderr || "").trim();
}

function markdownCell(value) {
  return String(value ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function timestamp() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const millis = String(now.getMilliseconds()).padStart(3, "0");
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}-${millis}-${process.pid}`;
}
