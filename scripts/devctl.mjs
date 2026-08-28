#!/usr/bin/env node

import { connect } from "node:net";
import { closeSync, openSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { DAEMON_VERSION, acquireMkdirLock, ensureStateDirs, paths, processIdentity, readJSON } from "./devlib.mjs";

const args = process.argv.slice(2);
const json = takeFlag("--json");
const top = args.shift() || "help";

try {
  if (top === "help" || top === "--help" || top === "-h") {
    printHelp();
  } else if (top === "daemon") {
    await daemonCommand(args.shift() || "status");
  } else if (top === "infra") {
    await ensureDaemon();
    print(await request("infra", { action: args.shift() || "status" }));
  } else if (top === "ensure") {
    await ensureDaemon();
    const scope = option("--scope", "worktree");
    if (!['shared', 'worktree'].includes(scope)) throw new Error("--scope must be shared or worktree");
    const browserMode = takeFlag("--browser");
    const noOpen = takeFlag("--no-open");
    const demoMode = browserMode && process.env.OFFICEDEX_DEVCTL_BROWSER_DEMO === "1";
    const demoAuth = demoMode ? demoAuthOption(process.env.OFFICEDEX_DEVCTL_BROWSER_DEMO_AUTH) : "";
    const demoCredits = demoMode ? demoCreditsOption(process.env.OFFICEDEX_DEVCTL_BROWSER_DEMO_CREDITS) : null;
    if (demoAuth === "anonymous" && demoCredits < 0) {
      throw new Error("anonymous OFFICEDEX_DEVCTL_BROWSER_DEMO_CREDITS cannot be negative");
    }
    const result = await request("ensure", {
      scope,
      cwd: process.cwd(),
      mode: browserMode ? "browser" : "desktop",
      demo_mode: demoMode,
      demo_auth: demoAuth,
      demo_credits: demoCredits,
      dev_officecli_binary: browserMode ? (process.env.OFFICEDEX_DEVCTL_OFFICECLI_BINARY || "") : "",
      lease_ttl_ms: numberOption("--lease-ttl-ms"),
    });
    print(result);
    if (browserMode && !noOpen) openBrowser(result.web_url);
  } else if (top === "status") {
    await ensureDaemon();
    print(await request("status", { instance: option("--instance", null) }));
  } else if (top === "logs") {
    await ensureDaemon();
    const result = await request("logs", { instance: requiredOption("--instance"), service: requiredOption("--service") });
    if (json) print(result);
    else {
      console.log(`[devctl] ${result.service} log: ${result.log_path}`);
      await printTail(result.log_path, Number(option("--lines", "200")));
    }
  } else if (top === "restart") {
    await ensureDaemon();
    print(await request("restart", { instance: requiredOption("--instance"), service: requiredOption("--service") }));
  } else if (top === "reallocate-ports") {
    await ensureDaemon();
    print(await request("reallocate-ports", { instance: requiredOption("--instance") }));
  } else if (top === "release") {
    await ensureDaemon();
    print(await request("release", { lease: requiredOption("--lease") }));
  } else if (top === "stop") {
    await ensureDaemon();
    print(await request("stop", { instance: requiredOption("--instance"), force_shared: takeFlag("--force-shared") }));
  } else if (top === "gc") {
    await ensureDaemon();
    print(await request("gc", { force: takeFlag("--force") }));
  } else if (top === "reset") {
    await ensureDaemon();
    const instance = requiredOption("--instance");
    print(await request("reset", { instance, confirm: requiredOption("--confirm") }));
  } else if (top === "doctor") {
    await ensureDaemon();
    const result = await request("doctor", { cwd: process.cwd() });
    print(result);
    if (!result.healthy) process.exitCode = 1;
  } else {
    throw new Error(`unknown command: ${top}`);
  }
} catch (error) {
  if (json) console.error(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
  else console.error(`[devctl] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}

async function daemonCommand(action) {
  if (action === "ensure") {
    const info = await ensureDaemon();
    print(info);
    return;
  }
  if (action === "status") {
    const info = await daemonStatus();
    print(info || { status: "stopped" });
    if (!info) process.exitCode = 1;
    return;
  }
  throw new Error("daemon action must be ensure or status");
}

async function ensureDaemon() {
  const current = await daemonStatus();
  if (current?.version === DAEMON_VERSION) return current;
  if (current) {
    try { process.kill(current.pid, "SIGTERM"); } catch (error) { if (error?.code !== "ESRCH") throw error; }
    const started = Date.now();
    while (Date.now() - started < 5_000 && await processIdentity(current.pid)) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    if (await processIdentity(current.pid)) throw new Error(`verified old devd ${current.pid} did not stop for version upgrade`);
  }
  const p = await ensureStateDirs();
  const lockDir = path.join(p.locks, "daemon-start.lock");
  const self = await processIdentity(process.pid);
  const release = await acquireMkdirLock(lockDir, { pid: process.pid, started_at_os: self?.started_at_os, created_at: new Date().toISOString() }, 30_000);
  try {
    const afterLock = await daemonStatus();
    if (afterLock?.version === DAEMON_VERSION) return afterLock;
    await rm(p.socket, { force: true });
    const scriptDir = path.dirname(fileURLToPath(import.meta.url));
    const logFD = openSync(p.log, "a", 0o600);
    const child = spawn(process.execPath, [path.join(scriptDir, "devd.mjs"), "serve"], {
      cwd: process.cwd(), env: process.env, detached: true, stdio: ["ignore", logFD, logFD],
    });
    closeSync(logFD);
    child.unref();
    const started = Date.now();
    let lastError = "";
    while (Date.now() - started < 30_000) {
      try {
        const info = await request("ping", {}, { ensure: false });
        return { status: "running", ...info, socket: p.socket };
      } catch (error) {
        lastError = error.message;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
    throw new Error(`daemon did not become ready: ${lastError}; see ${p.log}`);
  } finally {
    await release();
  }
}

async function daemonStatus() {
  const p = paths();
  const record = await readJSON(p.pid, null).catch(() => null);
  if (!record?.pid) return null;
  const identity = await processIdentity(record.pid);
  if (!identity || (record.started_at_os && identity.started_at_os !== record.started_at_os) || !identity.command.includes("devd.mjs")) return null;
  try {
    const ping = await request("ping", {}, { ensure: false, timeoutMs: 1_000 });
    return { status: "running", ...ping, socket: p.socket };
  } catch {
    return null;
  }
}

async function request(command, requestArgs, { timeoutMs = 180_000 } = {}) {
  const p = paths();
  return new Promise((resolve, reject) => {
    const socket = connect(p.socket);
    let buffer = "";
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error(`timed out waiting for devd command ${command}`));
    }, timeoutMs);
    socket.setEncoding("utf8");
    socket.on("connect", () => socket.write(`${JSON.stringify({ command, args: requestArgs })}\n`));
    socket.on("data", (chunk) => { buffer += chunk; });
    socket.on("end", () => {
      clearTimeout(timer);
      try {
        const response = JSON.parse(buffer.trim());
        if (!response.ok) reject(new Error(response.error || "devd request failed"));
        else resolve(response.result);
      } catch (error) { reject(error); }
    });
    socket.on("error", (error) => { clearTimeout(timer); reject(error); });
  });
}

function print(value) {
  if (json) {
    console.log(JSON.stringify(value));
    return;
  }
  if (value?.instance_id) {
    console.log(`instance: ${value.instance_id} (${value.scope || ""}${value.mode ? `, ${value.mode}` : ""})`);
    if (value.status) console.log(`status: ${value.status}${statusDetail(value)}`);
    if (value.reclaim_at) console.log(`reclaim: ${relativeTime(value.reclaim_at)} (${value.reclaim_at})`);
    if (typeof value.live_clients === "number") console.log(`clients: ${value.live_clients}${value.live_clients ? " (connected clients defer idle GC)" : ""}`);
    if (value.restart_count) console.log(`restarts: ${value.restart_count}${value.last_restart_at ? ` (last ${relativeTime(value.last_restart_at)})` : ""}`);
    if (typeof value.reused === "boolean") console.log(`reused: ${value.reused}`);
    if (value.lease_id) console.log(`lease: ${value.lease_id}`);
    if (value.web_url) console.log(`web: ${value.web_url}`);
    if (value.learnof_url) console.log(`learnof: ${value.learnof_url}`);
    if (value.bridge_url) console.log(`bridge: ${value.bridge_url}`);
    if (value.runtime_url) console.log(`runtime: ${value.runtime_url}`);
    if (value.worktree) console.log(`worktree: ${value.worktree}`);
    if (value.git_revision) console.log(`revision: ${value.git_revision}`);
    return;
  }
  if (value?.instances) {
    console.log(`daemon: ${value.daemon?.pid || "?"} ${value.daemon?.socket || ""}`);
    if (!value.instances.length) console.log("instances: none");
    for (const item of value.instances) {
      const reclaim = item.reclaim_at ? `reclaim=${relativeTime(item.reclaim_at)}` : "reclaim=-";
      console.log(`${item.instance_id}\t${item.status}${statusDetail(item)}\thealthy=${item.healthy}\tleases=${item.leases.length}\tclients=${item.live_clients ?? "-"}\t${reclaim}\t${item.worktree}`);
    }
    return;
  }
  if (value?.checks) {
    for (const check of value.checks) console.log(`${check.status.toUpperCase()}\t${check.name}\t${typeof check.detail === "string" ? check.detail : JSON.stringify(check.detail)}`);
    return;
  }
  console.log(JSON.stringify(value, null, 2));
}

function statusDetail(instance) {
  if (instance.status === "stopped" && instance.stop_reason) {
    return ` (${instance.stop_reason}${instance.stopped_at ? `, ${relativeTime(instance.stopped_at)}` : ""})`;
  }
  if (["failed", "restarting"].includes(instance.status) && instance.failure) return ` (${instance.failure})`;
  return "";
}

function relativeTime(iso) {
  const target = Date.parse(iso);
  if (!Number.isFinite(target)) return iso;
  const deltaMs = target - Date.now();
  const minutes = Math.round(Math.abs(deltaMs) / 60_000);
  const label = minutes >= 60 ? `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, "0")}m` : `${minutes}m`;
  return deltaMs >= 0 ? `in ${label}` : `${label} ago`;
}

async function printTail(file, lines) {
  const content = await readFile(file, "utf8").catch((error) => error?.code === "ENOENT" ? "" : Promise.reject(error));
  const selected = content.split(/\r?\n/).slice(-Math.max(1, lines)).join("\n");
  if (selected) console.log(selected);
}

function option(name, fallback) {
  const index = args.indexOf(name);
  if (index === -1) return fallback;
  const value = args[index + 1];
  if (value == null || value.startsWith("--")) throw new Error(`${name} requires a value`);
  args.splice(index, 2);
  return value;
}

function numberOption(name) {
  const value = option(name, null);
  return value == null ? null : Number(value);
}

function demoAuthOption(value) {
  const auth = String(value || "anonymous").trim().toLowerCase().replaceAll("-", "_");
  if (!['anonymous', 'logged_in'].includes(auth)) {
    throw new Error("OFFICEDEX_DEVCTL_BROWSER_DEMO_AUTH must be anonymous or logged_in");
  }
  return auth;
}

function demoCreditsOption(value) {
  const raw = String(value ?? "0").trim();
  if (!/^-?\d+$/.test(raw)) {
    throw new Error("OFFICEDEX_DEVCTL_BROWSER_DEMO_CREDITS must be an integer");
  }
  const credits = Number(raw);
  if (!Number.isSafeInteger(credits) || credits < -1_000_000_000 || credits > 1_000_000_000) {
    throw new Error("OFFICEDEX_DEVCTL_BROWSER_DEMO_CREDITS must be between -1000000000 and 1000000000");
  }
  return credits;
}

function requiredOption(name) {
  const value = option(name, null);
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function takeFlag(name) {
  const index = args.indexOf(name);
  if (index === -1) return false;
  args.splice(index, 1);
  return true;
}

function openBrowser(url) {
  if (!url) return;
  let command = "xdg-open";
  let commandArgs = [url];
  if (process.platform === "darwin") command = "open";
  if (process.platform === "win32") {
    command = "cmd";
    commandArgs = ["/c", "start", "", url];
  }
  const child = spawn(command, commandArgs, { detached: true, stdio: "ignore" });
  child.unref();
}

function printHelp() {
  console.log(`OfficeDex local development coordinator

Usage:
  ./scripts/devctl daemon ensure|status [--json]
  ./scripts/devctl infra ensure|status|logs [--json]
  ./scripts/devctl ensure --scope shared|worktree [--browser] [--no-open] [--json]
  ./scripts/devctl status [--instance ID] [--json]
  ./scripts/devctl logs --instance ID --service api|web|learnof [--lines N]
  ./scripts/devctl restart --instance ID --service api|web|learnof [--json]
  ./scripts/devctl reallocate-ports --instance ID [--json]
  ./scripts/devctl release --lease ID [--json]
  ./scripts/devctl stop --instance ID [--force-shared] [--json]
  ./scripts/devctl gc [--force] [--json]
  ./scripts/devctl reset --instance ID --confirm ID [--json]
  ./scripts/devctl doctor [--json]

Desktop mode uses the Wails/Go process. Browser mode starts the local HTTP/SSE
bridge plus Vite and opens the page by default. api_url is a loopback-only
development runtime identity endpoint, not a production business API.

Demo browser mode reads OFFICEDEX_DEVCTL_BROWSER_DEMO_AUTH=anonymous|logged_in
and OFFICEDEX_DEVCTL_BROWSER_DEMO_CREDITS=<integer>. It never uses real account
credentials or hosted credits.`);
}
