#!/usr/bin/env node

import { createServer as createHTTPServer } from "node:http";
import { createServer as createSocketServer } from "node:net";
import { createWriteStream, existsSync } from "node:fs";
import { mkdir, readdir, rm, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import {
  DAEMON_VERSION, acquireMkdirLock, appendLog, atomicWriteJSON, browserBridgeBuildTags, ensureStateDirs,
  gitIdentity, instanceID, instanceResources, portIsFree,
  processIdentity, readJSON, sharedWorktree, stablePortOffset, verifyOwnedProcess, worktreeRoot,
} from "./devlib.mjs";

const command = process.argv[2] || "serve";
if (command !== "serve") {
  console.error("usage: scripts/devd serve");
  process.exit(2);
}

const p = await ensureStateDirs();
const daemonStartedAt = new Date().toISOString();
const selfIdentity = await processIdentity(process.pid);
const daemonLockID = randomUUID();
const daemonRuntimeLock = path.join(p.locks, "daemon-runtime.lock");
await claimDaemonRuntimeLock();
const instances = new Map();
const runtimeServers = new Map();
let shuttingDown = false;
const liveClientProbe = { at: 0, ports: new Map(), unsupported: false };

// Only the web service is supervised: devd spawns it directly in browser/fixture mode, and a
// dead Vite is safe to replace. The browser-mode api process is the `go test` bridge host that
// owns editor/session state, so a silent restart would wipe what the developer is testing.
const webRestartPolicy = { windowMs: 60_000, maxRestarts: 5, delays: [1_000, 2_000, 4_000, 8_000, 8_000] };

await rm(p.socket, { force: true });
await atomicWriteJSON(p.pid, { pid: process.pid, started_at: daemonStartedAt, started_at_os: selfIdentity?.started_at_os, command: process.argv.join(" "), cwd: process.cwd() });
await writeFile(p.version, `${DAEMON_VERSION}\n`, { mode: 0o600 });
await recoverRegistry();

const socketServer = createSocketServer((socket) => {
  socket.setEncoding("utf8");
  let buffer = "";
  socket.on("data", (chunk) => {
    buffer += chunk;
    const newline = buffer.indexOf("\n");
    if (newline === -1) return;
    const raw = buffer.slice(0, newline);
    buffer = buffer.slice(newline + 1);
    void handleRawRequest(raw).then((result) => socket.end(`${JSON.stringify({ ok: true, result })}\n`)).catch((error) => {
      socket.end(`${JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) })}\n`);
    });
  });
});

socketServer.on("error", async (error) => {
  await appendLog(p.log, `socket error: ${error.message}`);
  if (!shuttingDown) process.exitCode = 1;
});

socketServer.listen(p.socket, async () => {
  await appendLog(p.log, `devd ${DAEMON_VERSION} listening pid=${process.pid} socket=${p.socket}`);
});

setInterval(() => void expireLeasesAndGC(), 30_000).unref();
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => void shutdown(signal));

async function handleRawRequest(raw) {
  let request;
  try { request = JSON.parse(raw); } catch { throw new Error("request is not valid JSON"); }
  const args = request.args || {};
  switch (request.command) {
    case "ping": return { version: DAEMON_VERSION, pid: process.pid, started_at: daemonStartedAt };
    case "ensure": return ensureInstance(args);
    case "status": return status(args);
    case "release": return releaseLease(args.lease);
    case "stop": return stopInstance(args.instance, { forceShared: Boolean(args.force_shared), reason: "explicit stop" });
    case "restart": return restartService(args.instance, args.service);
    case "reallocate-ports": return reallocatePorts(args.instance);
    case "logs": return logsResult(args.instance, args.service);
    case "gc": return gcInstances(Boolean(args.force));
    case "reset": return resetInstance(args.instance, args.confirm);
    case "doctor": return doctor(args.cwd || process.cwd());
    case "infra": return infra(args.action);
    default: throw new Error(`unknown devd command: ${request.command}`);
  }
}

async function ensureInstance(args) {
  const scope = args.scope === "shared" ? "shared" : "worktree";
  const mode = args.mode === "browser" ? "browser" : "desktop";
  const callerRoot = worktreeRoot(args.cwd || process.cwd());
  const worktree = scope === "shared" ? sharedWorktree(callerRoot) : callerRoot;
  const demoMode = mode === "browser" && args.demo_mode === true;
  const demoSession = {
    auth: demoMode && args.demo_auth === "logged_in" ? "logged_in" : "anonymous",
    credits: demoMode && Number.isSafeInteger(args.demo_credits) ? args.demo_credits : 0,
  };
  const learnofEnabled = mode === "browser" || args.learnof === true;
  const devOfficeCLIBinary = mode === "browser" ? resolveDevOfficeCLIBinary(args.dev_officecli_binary) : "";
  const id = instanceID(scope, worktree, mode);
  const dir = path.join(p.instances, id);
  await mkdir(dir, { recursive: true });
  const releaseLock = await acquireMkdirLock(path.join(p.locks, `instance-${id}.lock`), {
    pid: process.pid, started_at_os: selfIdentity?.started_at_os, instance_id: id, worktree, created_at: new Date().toISOString(),
  });
  try {
    let instance = instances.get(id) || await readJSON(path.join(dir, "state.json"), null);
    if (instance) migrateInstanceState(instance);
    let reused = false;
    if (instance && instance.mode === mode && instance.learnof_enabled === learnofEnabled && instance.dev_officecli_binary === devOfficeCLIBinary && await instanceHealthy(instance, { fingerprint: true, demoMode, demoSession, learnofEnabled })) {
      reused = true;
    } else {
      const preferredPorts = instance ? persistentPorts(instance) : null;
      if (instance) await stopInstanceRecord(instance, "replace unhealthy instance", { tolerateMismatch: true });
      instance = await startInstance({ id, scope, mode, learnofEnabled, demoMode, demoSession, devOfficeCLIBinary, worktree, dir, preferredPorts });
      instances.set(id, instance);
    }
    const lease = await createLease(instance, args.lease_ttl_ms);
    instance.leases = await activeLeases(instance);
    await saveInstance(instance);
    return publicInstance(instance, { reused, lease_id: lease.id });
  } finally {
    await releaseLock();
  }
}

async function startInstance({ id, scope, mode, learnofEnabled = mode === "browser", demoMode = false, demoSession = { auth: "anonymous", credits: 0 }, devOfficeCLIBinary = "", worktree, dir, preferredPorts = null, avoidPorts = new Set() }) {
  const ports = allocateInstancePorts(id, { preferredPorts, avoidPorts, mode, learnofEnabled });
  const resources = instanceResources(id, dir);
  await Promise.all([
    mkdir(resources.user_data_dir, { recursive: true }), mkdir(resources.workspace, { recursive: true }),
    mkdir(resources.runtime, { recursive: true }), mkdir(path.dirname(resources.officecli_config), { recursive: true }),
    mkdir(resources.officecli_home, { recursive: true }),
    mkdir(resources.temp_dir, { recursive: true }), mkdir(path.join(dir, "leases"), { recursive: true }),
  ]);
  const git = gitIdentity(worktree);
  const now = new Date().toISOString();
  const instance = {
    schema_version: 1, daemon_version: DAEMON_VERSION, instance_id: id, scope, mode, demo_mode: Boolean(demoMode), demo_auth: demoSession.auth, demo_credits: demoSession.credits, dev_officecli_binary: devOfficeCLIBinary, status: "starting", worktree,
    git_revision: git.revision, dirty_fingerprint: git.dirty_fingerprint, dirty: git.dirty,
    started_at: now, updated_at: now, idle_since: null, ports, resources, learnof_enabled: learnofEnabled,
    web_url: `http://127.0.0.1:${ports.web}`,
    api_url: `http://127.0.0.1:${ports.api}`,
    runtime_url: `http://127.0.0.1:${ports.api}/api/dev/runtime`,
    learnof_url: learnofEnabled && Number.isInteger(ports.learnof) ? `http://127.0.0.1:${ports.learnof}` : null,
    logs: {
      web: path.join(dir, "web.log"),
      api: path.join(dir, "api.log"),
      ...(Number.isInteger(ports.learnof) ? { learnof: path.join(dir, "learnof.log") } : {}),
    },
    bridge_url: null, processes: {}, leases: [], failure: null,
  };
  await saveInstance(instance);
  try {
    await startRuntimeServer(instance);
    const fixtureMode = Boolean(process.env.OFFICEDEX_DEVCTL_WEB_COMMAND || process.env.OFFICEDEX_DEVCTL_API_COMMAND);
    if (learnofEnabled) {
      instance.processes.learnof = await spawnService(instance, "learnof");
      await waitFor(async () => fetch(instance.learnof_url).then((response) => response.ok).catch(() => false), 120_000, "learnof/pptx editor");
    }
    if (mode === "browser") {
      const bridge = await spawnBrowserBridge(instance);
      instance.processes.api = bridge.process;
      instance.bridge_url = bridge.endpoint;
      instance.processes.web = await spawnService(instance, "web");
      await waitFor(async () => fetch(instance.web_url).then((response) => response.ok).catch(() => false), 120_000, "browser-mode Vite web server");
    } else if (fixtureMode) {
      instance.processes.web = await spawnService(instance, "web");
      await waitFor(async () => fetch(instance.web_url).then((response) => response.ok).catch(() => false), 120_000, "Vite web server");
      instance.processes.api = await spawnService(instance, "api");
    } else {
      instance.processes.api = await spawnService(instance, "api");
      await waitFor(async () => fetch(instance.web_url).then((response) => response.ok).catch(() => false), 120_000, "Wails-managed Vite web server");
      instance.processes.web = await discoverWebProcess(instance);
    }
    await waitForOwnedReady(instance.processes.api, 120_000, "Wails application process and dev server");
    await new Promise((resolve) => setTimeout(resolve, 300));
    const stableAPI = await verifyOwnedProcess(instance.processes.api, { requirePort: Boolean(instance.processes.api.port) });
    if (!stableAPI.ok) throw new Error(`Wails application did not remain healthy: ${stableAPI.reason}`);
    instance.status = "ready";
    instance.updated_at = new Date().toISOString();
    await saveInstance(instance);
    return instance;
  } catch (error) {
    instance.status = "failed";
    instance.failure = error instanceof Error ? error.message : String(error);
    await saveInstance(instance);
    await stopInstanceRecord(instance, "startup failed", { tolerateMismatch: true });
    throw error;
  }
}

async function spawnService(instance, service) {
  const logPath = instance.logs[service];
  const log = createWriteStream(logPath, { flags: "a", mode: 0o600 });
  const fixtureCommand = service === "web" ? process.env.OFFICEDEX_DEVCTL_WEB_COMMAND : process.env.OFFICEDEX_DEVCTL_API_COMMAND;
  let executable;
  let args;
  let token;
  let cwd = instance.worktree;
  if (service === "learnof") {
    const learnofCommand = process.env.OFFICEDEX_DEVCTL_LEARNOF_COMMAND || process.env.OFFICEDEX_DEVCTL_WEB_COMMAND || null;
    if (learnofCommand) {
      executable = process.execPath;
      args = [learnofCommand, String(instance.ports.learnof)];
      token = path.basename(learnofCommand);
    } else {
      cwd = learnofWorktree(instance.worktree);
      executable = process.env.NPM_COMMAND || "npm";
      args = ["run", "dev:local", "--", "--host", "127.0.0.1", "--port", String(instance.ports.learnof), "--strictPort"];
      token = "dev:local";
    }
  } else if (fixtureCommand) {
    executable = process.execPath;
    args = [fixtureCommand, service === "web" ? String(instance.ports.web) : "0"];
    token = path.basename(fixtureCommand);
  } else if (service === "web") {
    executable = path.join(instance.worktree, "node_modules", ".bin", "vite");
    args = ["--host", "127.0.0.1", "--port", String(instance.ports.web), "--strictPort"];
    token = "vite";
  } else {
    executable = spawnSync("which", ["wails"], { encoding: "utf8" }).stdout.trim() || "wails";
    args = ["dev", "-s", "-frontenddevserverurl", instance.web_url, "-devserver", `127.0.0.1:${instance.ports.wails}`, "-noreload", "-skipbindings"];
    token = "wails";
  }
  const env = {
    ...process.env,
    OFFICEDEX_DEV_INSTANCE_ID: instance.instance_id,
    OFFICEDEX_DEV_WORKTREE: instance.worktree,
    OFFICEDEX_DEV_GIT_REVISION: instance.git_revision,
    OFFICEDEX_DEV_DIRTY_FINGERPRINT: instance.dirty_fingerprint,
    OFFICEDEX_DEV_USER_DATA_DIR: instance.resources.user_data_dir,
    OFFICEDEX_DEV_OFFICECLI_HOME: instance.resources.officecli_home,
    OFFICE_CLI_CONFIG: instance.resources.officecli_config,
    OFFICEDEX_DEV_WEB_HOST: "127.0.0.1",
    OFFICEDEX_DEV_WEB_PORT: String(instance.ports.web),
    OFFICEDEX_DEV_WEB_LOG: instance.logs.web,
    TMPDIR: instance.resources.temp_dir,
  };
  if (instance.mode === "browser" && instance.bridge_url) {
    env.VITE_OFFICEDEX_REAL_E2E_ENDPOINT = instance.bridge_url;
    env.VITE_OFFICEDEX_REAL_E2E_HMR = "1";
  }
  if (env.GOROOT && !existsSync(env.GOROOT)) delete env.GOROOT;
  if (service === "learnof") {
    env.VITE_PRESENTATION_SESSION_MODE = "browser-local";
    env.OFFICEDEX_DEV_LEARNOF_PORT = String(instance.ports.learnof);
  }
  if (service === "web" && instance.learnof_url) env.VITE_LEARNOF_PPTX_URL = instance.learnof_url;
  const child = spawn(executable, args, { cwd, env, detached: true, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.pipe(log, { end: false });
  child.stderr.pipe(log, { end: false });
  child.on("exit", async (code, signal) => {
    log.write(`\n[devd] exited code=${code ?? ""} signal=${signal ?? ""}\n`);
    log.end();
    const current = instances.get(instance.instance_id);
    if (!current || ["stopping", "stopped", "restarting"].includes(current.status)) return;
    const reason = `${service} exited code=${code ?? ""} signal=${signal ?? ""}`;
    if (service === "web" && !shuttingDown && await webRestartAllowed(current)) {
      void superviseWebRestart(current, reason);
      return;
    }
    current.status = "failed";
    current.failure = reason;
    current.updated_at = new Date().toISOString();
    await saveInstance(current).catch(() => {});
  });
  const identity = await waitFor(async () => processIdentity(child.pid), 5_000, `${service} process identity`);
  return {
    ...identity, service, executable, args, command_token: token,
    port: service === "web" ? instance.ports.web : service === "learnof" ? instance.ports.learnof : (fixtureCommand ? 0 : instance.ports.wails),
    log: logPath, ...(service === "learnof" ? { cwd } : {}),
  };
}

function learnofWorktree(worktree) {
  const candidate = path.resolve(process.env.OFFICEDEX_DEVCTL_LEARNOF_WORKTREE || path.resolve(worktree, "..", "pptx"));
  if (!existsSync(path.join(candidate, "package.json"))) {
    throw new Error(`demo browser mode requires the sibling learnof/pptx repository: ${candidate}`);
  }
  return candidate;
}

// Restart only what the developer still has a claim on: an instance nobody holds a lease on and
// nobody is connected to is on its way to garbage collection anyway.
async function webRestartAllowed(instance) {
  if (instance.status !== "ready") return false;
  if (!instance.processes?.web) return false;
  const leases = (instance.leases || []).length;
  if (leases === 0 && (await liveClientCount(instance)) === 0) return false;
  const history = instance.web_restarts;
  if (!history) return true;
  if (Date.now() - Date.parse(history.window_started_at) > webRestartPolicy.windowMs) return true;
  return history.count < webRestartPolicy.maxRestarts;
}

async function superviseWebRestart(instance, reason) {
  const now = Date.now();
  const history = instance.web_restarts && now - Date.parse(instance.web_restarts.window_started_at) <= webRestartPolicy.windowMs
    ? instance.web_restarts
    : { window_started_at: new Date(now).toISOString(), count: 0, total: instance.web_restarts?.total || 0 };
  if (history.count >= webRestartPolicy.maxRestarts) {
    instance.status = "failed";
    instance.failure = `${reason}; web restart budget exhausted (${history.count} restarts within ${webRestartPolicy.windowMs / 1000}s)`;
    instance.web_restarts = history;
    await saveInstance(instance).catch(() => {});
    await appendLog(p.log, `instance ${instance.instance_id} web restart budget exhausted after ${reason}`);
    return;
  }
  const delay = webRestartPolicy.delays[Math.min(history.count, webRestartPolicy.delays.length - 1)];
  history.count += 1;
  history.total += 1;
  instance.web_restarts = history;
  instance.restart_count = history.total;
  instance.status = "restarting";
  instance.failure = reason;
  await saveInstance(instance).catch(() => {});
  await appendLog(p.log, `instance ${instance.instance_id} restarting web in ${delay}ms after ${reason} (attempt ${history.count}/${webRestartPolicy.maxRestarts})`);
  await new Promise((resolve) => setTimeout(resolve, delay));
  const current = instances.get(instance.instance_id);
  // A stop, a replacement, or another restart may have claimed the instance while we waited.
  if (shuttingDown || !current || current !== instance || current.status !== "restarting") return;
  try {
    current.processes.web = await spawnService(current, "web");
    await waitFor(async () => fetch(current.web_url).then((response) => response.ok).catch(() => false), 60_000, "restarted web server");
    current.status = "ready";
    current.failure = null;
    current.last_restart_at = new Date().toISOString();
    await saveInstance(current);
    await appendLog(p.log, `instance ${current.instance_id} web restarted on ${current.web_url} (attempt ${history.count})`);
  } catch (error) {
    current.status = "failed";
    current.failure = `web restart failed: ${error instanceof Error ? error.message : String(error)}`;
    await saveInstance(current).catch(() => {});
    await appendLog(p.log, `instance ${current.instance_id} web restart failed: ${current.failure}`);
  }
}

async function spawnBrowserBridge(instance) {
  const logPath = instance.logs.api;
  const log = createWriteStream(logPath, { flags: "a", mode: 0o600 });
  const fixtureCommand = process.env.OFFICEDEX_DEVCTL_BROWSER_BRIDGE_COMMAND;
  const officecli = instance.dev_officecli_binary || process.env.OFFICECLI_DESKTOP_BINARY || path.join(instance.worktree, "build", "officecli", process.platform === "win32" ? "officecli.exe" : "officecli");
  if (!fixtureCommand && !existsSync(officecli)) throw new Error(`browser mode requires OfficeCLI binary: ${officecli}; run npm run prefetch:officecli`);
  const executable = fixtureCommand ? process.execPath : "go";
  const args = fixtureCommand
    ? [fixtureCommand]
    : ["test", "-tags", browserBridgeBuildTags(instance.demo_mode), ".", "-run", "TestRealOfficeDexClientBridgeHost", "-count=1", "-timeout", "0", "-v"];
  const env = {
    ...process.env,
    OFFICEDEX_E2E_REAL: "1",
    OFFICEDEX_E2E_HOST: "1",
    OFFICEDEX_E2E_OUTPUT_DIR: path.join(instance.resources.user_data_dir, "browser-bridge"),
    OFFICECLI_DESKTOP_BINARY: officecli,
    OFFICEDEX_E2E_BRIDGE_ADDR: `127.0.0.1:${instance.ports.bridge}`,
    OFFICEDEX_DEV_INSTANCE_ID: instance.instance_id,
    OFFICEDEX_DEV_WORKTREE: instance.worktree,
    OFFICEDEX_DEV_USER_DATA_DIR: instance.resources.user_data_dir,
    OFFICEDEX_DEV_OFFICECLI_HOME: instance.resources.officecli_home,
    OFFICE_CLI_CONFIG: instance.resources.officecli_config,
    // Browser bridge runs from the OfficeDex checkout while the progressive
    // PPTX runtime lives in the sibling learnof/pptx checkout. Supplying the
    // source root here lets the converter and MOP worker resolve their assets
    // instead of silently falling back to the monolithic pipeline.
    PRESENTATION_SOURCE_DIR: learnofWorktree(instance.worktree),
    OFFICECLI_MOP_PRESENTATION_ROOT: learnofWorktree(instance.worktree),
    // devd is already running under the Node executable required by the MOP
    // authoring worker. Pass that exact executable through so browser E2E does
    // not depend on the shell PATH inherited by the Go bridge host.
    OFFICECLI_MOP_SKILL_NODE: process.execPath,
    TMPDIR: instance.resources.temp_dir,
  };
  if (instance.demo_mode) {
    env.OFFICEDEX_DEMO_ACCEPT_ANY_PROMPT = "1";
    env.OFFICEDEX_DEMO_AUTH = instance.demo_auth;
    env.OFFICEDEX_DEMO_CREDITS = String(instance.demo_credits);
  }
  if (!instance.demo_mode) env.OFFICEDEX_DEV_BROWSER_REAL_LOGIN = "1";
  if (env.GOROOT && !existsSync(env.GOROOT)) delete env.GOROOT;
  const child = spawn(executable, args, { cwd: instance.worktree, env, detached: true, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { stdout += chunk; log.write(chunk); });
  child.stderr.on("data", (chunk) => log.write(chunk));
  child.on("exit", async (code, signal) => {
    log.write(`\n[devd] browser bridge exited code=${code ?? ""} signal=${signal ?? ""}\n`);
    log.end();
    const current = instances.get(instance.instance_id);
    if (current && !["stopping", "stopped", "restarting"].includes(current.status)) {
      current.status = "failed";
      current.failure = `browser bridge exited code=${code ?? ""} signal=${signal ?? ""}`;
      await saveInstance(current).catch(() => {});
    }
  });
  const endpoint = await waitFor(() => {
    const match = stdout.match(/OFFICEDEX_REAL_E2E_ENDPOINT=(http:\/\/[^\s]+)/);
    return match?.[1] || false;
  }, 120_000, "OfficeDex browser bridge endpoint");
  const identity = await processIdentity(child.pid);
  if (!identity) throw new Error("browser bridge process exited before identity capture");
  const port = Number(new URL(endpoint).port);
  if (port !== instance.ports.bridge) {
    await appendLog(p.log, `instance ${instance.instance_id} bridge host ignored stable port ${instance.ports.bridge}; using compatibility port ${port}`);
    instance.ports.bridge = port;
  }
  return {
    endpoint,
    process: { ...identity, service: "api", executable, args, command_token: fixtureCommand ? path.basename(fixtureCommand) : "go", port, log: logPath, bridge: true },
  };
}

function resolveDevOfficeCLIBinary(raw) {
  const candidate = String(raw || "").trim();
  if (!candidate) return "";
  const absolute = path.resolve(candidate);
  if (!existsSync(absolute)) throw new Error(`OFFICEDEX_DEVCTL_OFFICECLI_BINARY does not exist: ${absolute}`);
  return absolute;
}

async function startRuntimeServer(instance) {
  const existing = runtimeServers.get(instance.instance_id);
  if (existing) return;
  const server = createHTTPServer((request, response) => {
    if (request.url !== "/api/dev/runtime" && request.url !== "/healthz") {
      response.writeHead(404, { "content-type": "application/json" });
      response.end('{"error":"not found"}\n');
      return;
    }
    const current = instances.get(instance.instance_id) || instance;
    const body = {
      status: current.status === "ready" ? "ready" : current.status,
      instance_id: current.instance_id,
      scope: current.scope,
      worktree: current.worktree,
      git_revision: current.git_revision,
      dirty_fingerprint: current.dirty_fingerprint,
      mode: current.mode,
      demo_mode: Boolean(current.demo_mode),
      demo_auth: current.demo_auth,
      demo_credits: current.demo_credits,
      bridge_url: current.bridge_url,
      learnof_url: current.learnof_url || null,
      learnof_process: current.processes?.learnof || null,
      started_at: current.started_at,
      sqlite: current.resources.sqlite,
      workspace: current.resources.workspace,
      runtime: current.resources.runtime,
      officecli_config: current.resources.officecli_config,
      database: null,
      object_bucket: null,
    };
    response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
    response.end(`${JSON.stringify(body)}\n`);
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(instance.ports.api, "127.0.0.1", resolve);
  });
  runtimeServers.set(instance.instance_id, server);
}

async function instanceHealthy(instance, { fingerprint = false, demoMode = undefined, demoSession = undefined, learnofEnabled = instance?.learnof_enabled ?? instance?.mode === "browser" } = {}) {
  if (!instance || instance.status !== "ready") return false;
  if (instance.daemon_version !== DAEMON_VERSION || !instance.resources?.officecli_home) return false;
  if (typeof demoMode === "boolean" && Boolean(instance.demo_mode) !== demoMode) return false;
  if (demoSession && (instance.demo_auth !== demoSession.auth || instance.demo_credits !== demoSession.credits)) return false;
  try {
    await startRuntimeServer(instance);
    const runtime = await fetch(instance.runtime_url).then((response) => response.ok ? response.json() : null);
    if (!runtime || runtime.instance_id !== instance.instance_id || path.resolve(runtime.worktree) !== path.resolve(instance.worktree)) return false;
    if (fingerprint) {
      const git = gitIdentity(instance.worktree);
      if (git.revision !== instance.git_revision || git.dirty_fingerprint !== instance.dirty_fingerprint) return false;
    }
    const web = await verifyOwnedProcess(instance.processes.web, { requirePort: true });
    const api = await verifyOwnedProcess(instance.processes.api, { requirePort: Boolean(instance.processes.api.port) });
    if (!web.ok || !api.ok) return false;
    const response = await fetch(instance.web_url).catch(() => null);
    if (!response?.ok) return false;
    if (instance.mode === "browser") {
      const bridge = await fetch(`${instance.bridge_url}/rpc/GetAppVersion`, { method: "POST", headers: { "content-type": "application/json" }, body: "null" }).catch(() => null);
      if (!bridge?.ok) return false;
      if (demoSession) {
        const liveDemo = await fetch(`${instance.bridge_url}/control/demo/session`).then((response) => response.ok ? response.json() : null).catch(() => null);
        if (!liveDemo || liveDemo.session?.auth !== demoSession.auth || liveDemo.session?.credits !== demoSession.credits) return false;
      }
    }
    if (learnofEnabled) {
      if (!instance.learnof_url || !instance.processes?.learnof) return false;
      const learnof = await verifyOwnedProcess(instance.processes.learnof, { requirePort: true });
      if (!learnof.ok) return false;
      const editor = await fetch(instance.learnof_url).catch(() => null);
      if (!editor?.ok) return false;
    }
    return true;
  } catch {
    return false;
  }
}

async function status(args) {
  const records = [];
  for (const instance of instances.values()) {
    instance.leases = await activeLeases(instance);
    records.push({
      ...publicInstance(instance),
      healthy: await instanceHealthy(instance),
      live_clients: await liveClientCount(instance),
    });
  }
  if (args.instance) return records.find((entry) => entry.instance_id === args.instance) || null;
  return { daemon: { version: DAEMON_VERSION, pid: process.pid, started_at: daemonStartedAt, socket: p.socket }, instances: records };
}

async function createLease(instance, ttlMs) {
  const id = randomUUID();
  const ttl = Math.max(10_000, Number(ttlMs || process.env.OFFICEDEX_DEVCTL_LEASE_TTL_MS || 28_800_000));
  const lease = { id, instance_id: instance.instance_id, created_at: new Date().toISOString(), expires_at: new Date(Date.now() + ttl).toISOString(), owner_pid: null, released_at: null };
  await atomicWriteJSON(path.join(p.instances, instance.instance_id, "leases", `${id}.json`), lease);
  return lease;
}

async function readLeases(instance) {
  const dir = path.join(p.instances, instance.instance_id, "leases");
  let names = [];
  try { names = await readdir(dir); } catch { return { all: [], active: [] }; }
  const all = [];
  const active = [];
  for (const name of names.filter((entry) => entry.endsWith(".json"))) {
    const file = path.join(dir, name);
    const lease = await readJSON(file, null);
    if (!lease) continue;
    all.push({ ...lease, file });
    if (lease.released_at || Date.parse(lease.expires_at) <= Date.now()) continue;
    active.push(lease);
  }
  return { all, active };
}

async function activeLeases(instance) {
  return (await readLeases(instance)).active;
}

// Leases accumulate one file per `ensure`; nothing used to remove them, so every sweep re-read
// months of dead files for every instance.
async function pruneLeases(leases) {
  const retentionMs = Number(process.env.OFFICEDEX_DEVCTL_LEASE_RETENTION_MS || 86_400_000);
  const now = Date.now();
  for (const lease of leases) {
    const done = lease.released_at ? Date.parse(lease.released_at) : Date.parse(lease.expires_at);
    if (!Number.isFinite(done) || now - done < retentionMs) continue;
    await unlink(lease.file).catch(() => {});
  }
}

function idleTTL() {
  return Number(process.env.OFFICEDEX_DEVCTL_IDLE_TTL_MS || 3_600_000);
}

// The moment the instance actually went idle is the last lease expiry, not the moment a sweep
// happened to notice it: a daemon that was busy (or a machine that slept) must not donate that
// gap to the developer or steal it from them.
function idleSinceFrom(leases) {
  let latest = 0;
  for (const lease of leases) {
    if (lease.released_at) latest = Math.max(latest, Date.parse(lease.released_at));
    else latest = Math.max(latest, Date.parse(lease.expires_at));
  }
  const now = Date.now();
  return new Date(latest > 0 && latest <= now ? latest : now).toISOString();
}

// An open browser tab holds a Vite HMR websocket, so an established connection to the web port
// is the truest "in use" signal available without asking the client to cooperate. Connections
// owned by devd itself (health probes, keep-alive pools) are excluded by pid.
async function liveClientPorts() {
  if (process.env.OFFICEDEX_DEVCTL_DISABLE_LIVE_CLIENT_PROBE === "1") return new Map();
  if (liveClientProbe.unsupported) return new Map();
  if (Date.now() - liveClientProbe.at < 5_000) return liveClientProbe.ports;
  const result = spawnSync("lsof", ["-nP", "-iTCP", "-sTCP:ESTABLISHED", "-Fpn"], { encoding: "utf8", timeout: 5_000 });
  if (result.error || typeof result.stdout !== "string") {
    liveClientProbe.unsupported = true;
    await appendLog(p.log, `live-client probe disabled: ${result.error?.message || "lsof unavailable"}; idle GC falls back to lease timers`);
    return new Map();
  }
  const ports = new Map();
  let pid = 0;
  for (const line of result.stdout.split("\n")) {
    if (line.startsWith("p")) { pid = Number(line.slice(1)) || 0; continue; }
    if (!line.startsWith("n") || pid === process.pid) continue;
    const remote = line.slice(1).split("->")[1];
    const port = Number(remote?.split(":").pop());
    if (!Number.isInteger(port)) continue;
    ports.set(port, (ports.get(port) || 0) + 1);
  }
  liveClientProbe.at = Date.now();
  liveClientProbe.ports = ports;
  return ports;
}

async function liveClientCount(instance) {
  const ports = await liveClientPorts();
  return ports.get(instance.ports?.web) || 0;
}

async function releaseLease(id) {
  if (!id) throw new Error("--lease is required");
  for (const instance of instances.values()) {
    const file = path.join(p.instances, instance.instance_id, "leases", `${id}.json`);
    const lease = await readJSON(file, null);
    if (!lease) continue;
    if (!lease.released_at) {
      lease.released_at = new Date().toISOString();
      await atomicWriteJSON(file, lease);
    }
    instance.leases = await activeLeases(instance);
    if (instance.scope === "worktree" && instance.leases.length === 0 && !instance.idle_since) instance.idle_since = new Date().toISOString();
    await saveInstance(instance);
    return { released: true, lease_id: id, instance_id: instance.instance_id, instance_stopped: false };
  }
  throw new Error(`lease not found: ${id}`);
}

async function stopInstance(id, options = {}) {
  const instance = instances.get(id);
  if (!instance) throw new Error(`instance not found: ${id}`);
  if (instance.scope === "shared" && !options.forceShared) throw new Error("shared instance cannot be stopped without --force-shared");
  return stopInstanceRecord(instance, options.reason || "stop");
}

async function stopInstanceRecord(instance, reason, { tolerateMismatch = false } = {}) {
  instance.status = "stopping";
  instance.updated_at = new Date().toISOString();
  await saveInstance(instance).catch(() => {});
  const stopped = [];
  const refused = [];
  for (const service of ["learnof", "web", "api"]) {
    const record = instance.processes?.[service];
    if (!record) continue;
    const check = await verifyOwnedProcess(record, { requirePort: Boolean(record.port) });
    if (!check.ok) {
      refused.push({ service, pid: record.pid, reason: check.reason });
      continue;
    }
    try { process.kill(-record.pgid, "SIGTERM"); } catch (error) { if (error?.code !== "ESRCH") throw error; }
    await waitUntilNotOwned(record, Number(process.env.OFFICEDEX_DEVCTL_TERM_TIMEOUT_MS || 5_000), `${service} SIGTERM`).catch(() => null);
    const stillOwned = await verifyOwnedProcess(record);
    if (stillOwned.ok) {
      process.kill(-record.pgid, "SIGKILL");
    }
    stopped.push({ service, pid: record.pid, pgid: record.pgid });
  }
  const runtime = runtimeServers.get(instance.instance_id);
  if (runtime) await new Promise((resolve) => runtime.close(resolve));
  runtimeServers.delete(instance.instance_id);
  instance.status = refused.length && !tolerateMismatch ? "ownership_mismatch" : "stopped";
  instance.stopped_at = new Date().toISOString();
  instance.stop_reason = reason;
  instance.updated_at = instance.stopped_at;
  instance.ownership_refusals = refused;
  await saveInstance(instance);
  if (refused.length && !tolerateMismatch) throw new Error(`refused to stop unverified processes: ${JSON.stringify(refused)}`);
  return { instance_id: instance.instance_id, status: instance.status, stopped, refused };
}

async function restartService(id, service) {
  if (!id) throw new Error("--instance is required");
  if (!['api', 'web', 'learnof'].includes(service)) throw new Error("--service must be api, web or learnof");
  const instance = instances.get(id);
  if (!instance) throw new Error(`instance not found: ${id}`);
  instance.status = "restarting";
  await saveInstance(instance);
  if (instance.mode === "browser") {
    await stopVerifiedService(instance, "web");
    await stopVerifiedService(instance, "api");
    if (instance.processes.learnof) await stopVerifiedService(instance, "learnof");
    const bridge = await spawnBrowserBridge(instance);
    instance.processes.api = bridge.process;
    instance.bridge_url = bridge.endpoint;
    instance.processes.learnof = await spawnService(instance, "learnof");
    await waitFor(async () => fetch(instance.learnof_url).then((r) => r.ok).catch(() => false), 120_000, "learnof/pptx editor");
    instance.processes.web = await spawnService(instance, "web");
    await waitFor(async () => fetch(instance.web_url).then((r) => r.ok).catch(() => false), 120_000, "browser-mode Vite web server");
    instance.status = "ready";
    await saveInstance(instance);
    return { ...publicInstance(instance), restarted_services: ["web", "api", "learnof"] };
  }
  if (instance.processes.web?.managed_by === "api") {
    await stopVerifiedService(instance, "web");
    await stopVerifiedService(instance, "api");
    instance.processes.api = await spawnService(instance, "api");
    await waitFor(async () => fetch(instance.web_url).then((r) => r.ok).catch(() => false), 120_000, "Wails-managed Vite web server");
    instance.processes.web = await discoverWebProcess(instance);
    await waitForOwnedReady(instance.processes.api, 120_000, "Wails application process and dev server");
    instance.status = "ready";
    await saveInstance(instance);
    return { ...publicInstance(instance), restarted_services: ["web", "api"] };
  }
  await stopVerifiedService(instance, service);
  instance.processes[service] = await spawnService(instance, service);
  if (service === "web") await waitFor(async () => fetch(instance.web_url).then((r) => r.ok).catch(() => false), 120_000, "Vite web server");
  if (service === "learnof") await waitFor(async () => fetch(instance.learnof_url).then((r) => r.ok).catch(() => false), 120_000, "learnof/pptx editor");
  instance.status = "ready";
  instance.updated_at = new Date().toISOString();
  await saveInstance(instance);
  return publicInstance(instance);
}

async function reallocatePorts(id) {
  if (!id) throw new Error("--instance is required");
  const instance = instances.get(id);
  if (!instance) throw new Error(`instance not found: ${id}`);
  const releaseLock = await acquireMkdirLock(path.join(p.locks, `instance-${id}.lock`), {
    pid: process.pid, started_at_os: selfIdentity?.started_at_os, instance_id: id,
    worktree: instance.worktree, created_at: new Date().toISOString(), operation: "reallocate-ports",
  });
  try {
    const oldPorts = persistentPorts(instance);
    const avoidPorts = new Set(Object.values(oldPorts).filter(Number.isInteger));
    await stopInstanceRecord(instance, "explicit port reallocation");
    const replacement = await startInstance({
      id: instance.instance_id, scope: instance.scope, mode: instance.mode, learnofEnabled: Boolean(instance.learnof_enabled), demoMode: Boolean(instance.demo_mode),
      demoSession: { auth: instance.demo_auth, credits: instance.demo_credits },
      devOfficeCLIBinary: instance.dev_officecli_binary,
      worktree: instance.worktree, dir: path.join(p.instances, id), avoidPorts,
    });
    replacement.leases = await activeLeases(replacement);
    await saveInstance(replacement);
    return { ...publicInstance(replacement), reallocated: true, previous_ports: oldPorts };
  } finally {
    await releaseLock();
  }
}

async function stopVerifiedService(instance, service) {
  const record = instance.processes[service];
  const check = await verifyOwnedProcess(record, { requirePort: Boolean(record.port) });
  if (!check.ok) throw new Error(`refused to stop unverified ${service}: ${check.reason}`);
  process.kill(-record.pgid, "SIGTERM");
  try {
    await waitUntilNotOwned(record, 15_000, `${service} stop`);
  } catch (error) {
    const stillOwned = await verifyOwnedProcess(record);
    if (!stillOwned.ok) return;
    process.kill(-record.pgid, "SIGKILL");
    await waitUntilNotOwned(record, 5_000, `${service} SIGKILL`);
  }
}

function logsResult(id, service) {
  const instance = instances.get(id);
  if (!instance) throw new Error(`instance not found: ${id}`);
  if (!['api', 'web', 'learnof'].includes(service)) throw new Error("--service must be api, web or learnof");
  return { instance_id: id, service, log_path: instance.logs[service] };
}

async function expireLeasesAndGC() {
  for (const instance of instances.values()) {
    const previousIdle = instance.idle_since;
    const previousCount = (instance.leases || []).length;
    const { all, active } = await readLeases(instance);
    instance.leases = active;
    await pruneLeases(all);
    if (instance.scope === "worktree" && !["stopped", "ownership_mismatch"].includes(instance.status)) {
      const busy = active.length > 0 || (await liveClientCount(instance)) > 0;
      if (busy) instance.idle_since = null;
      else if (!instance.idle_since) instance.idle_since = idleSinceFrom(all);
    }
    // Writing unconditionally churned every state.json every 30s and made `updated_at` mean
    // "last sweep" instead of "last change", which hid the real stop time during diagnosis.
    if (instance.idle_since !== previousIdle || active.length !== previousCount) {
      await saveInstance(instance).catch(() => {});
    } else {
      instances.set(instance.instance_id, instance);
    }
  }
  await gcInstances(false);
}

async function gcInstances(force) {
  const idleMs = idleTTL();
  const results = [];
  for (const instance of instances.values()) {
    if (["stopped", "ownership_mismatch"].includes(instance.status)) continue;
    instance.leases = await activeLeases(instance);
    if (instance.scope === "shared" || instance.leases.length > 0 || !instance.idle_since) continue;
    if (!force && Date.now() - Date.parse(instance.idle_since) < idleMs) continue;
    if (!force && (await liveClientCount(instance)) > 0) continue;
    results.push(await stopInstanceRecord(instance, "garbage collection", { tolerateMismatch: true }));
  }
  return { collected: results };
}

async function resetInstance(id, confirm) {
  if (!id) throw new Error("--instance is required");
  if (confirm !== id) throw new Error(`destructive reset requires --confirm ${id}`);
  const instance = instances.get(id);
  if (!instance) throw new Error(`instance not found: ${id}`);
  if (instance.status !== "stopped") throw new Error("instance must be safely stopped before reset");
  const leases = await activeLeases(instance);
  if (leases.length) throw new Error("instance still has active leases");
  await rm(instance.resources.user_data_dir, { recursive: true, force: true });
  await rm(path.dirname(instance.resources.officecli_config), { recursive: true, force: true });
  return { instance_id: id, reset: true, removed: [instance.resources.user_data_dir, path.dirname(instance.resources.officecli_config)] };
}

async function doctor(cwd) {
  const checks = [];
  for (const cmd of ["node", "git", "lsof", "ps", "wails"]) {
    const found = spawnSync("which", [cmd], { encoding: "utf8" }).status === 0;
    checks.push({ name: `command:${cmd}`, status: found ? "ok" : "error", detail: found ? "available" : "missing" });
  }
  let root = "";
  try { root = worktreeRoot(cwd); checks.push({ name: "git-worktree", status: "ok", detail: root }); }
  catch (error) { checks.push({ name: "git-worktree", status: "error", detail: error.message }); }
  checks.push({ name: "daemon-socket", status: "ok", detail: p.socket });
  for (const instance of instances.values()) {
    const healthy = await instanceHealthy(instance);
    checks.push({ name: `instance:${instance.instance_id}`, status: healthy ? "ok" : "error", detail: healthy ? "runtime, fingerprint baseline and processes verified" : instance.failure || instance.status });
    checks.push({ name: `cookies:${instance.instance_id}`, status: "n/a", detail: "Wails desktop IPC does not use browser auth or CSRF cookies" });
    checks.push({ name: `infra:${instance.instance_id}`, status: "n/a", detail: "OfficeDex has no Docker, Kubernetes, remote database or object store dependency" });
  }
  const duplicateData = new Map();
  for (const instance of instances.values()) {
    const key = instance.resources?.user_data_dir;
    if (!key) continue;
    duplicateData.set(key, [...(duplicateData.get(key) || []), instance.instance_id]);
  }
  for (const [dir, ids] of duplicateData) if (ids.length > 1) checks.push({ name: "data-dir-isolation", status: "error", detail: `${dir} shared by ${ids.join(", ")}` });
  const suspicious = root ? suspiciousProcesses(root) : [];
  checks.push({ name: "unmanaged-processes", status: suspicious.length ? "warning" : "ok", detail: suspicious });
  return { healthy: !checks.some((check) => check.status === "error"), checks, destructive_actions: false };
}

function suspiciousProcesses(root) {
  const result = spawnSync("ps", ["-axo", "pid=,ppid=,pgid=,command="], { encoding: "utf8" });
  const managedPIDs = new Set([...instances.values()].flatMap((instance) => Object.values(instance.processes || {}).map((record) => record.pid)));
  const managedPGIDs = new Set([...instances.values()].flatMap((instance) => Object.values(instance.processes || {}).map((record) => record.pgid)));
  return result.stdout.split(/\r?\n/).filter((line) => line.includes(root)).map((line) => line.trim()).filter((line) => {
    const fields = line.split(/\s+/);
    const pid = Number(fields[0]);
    const pgid = Number(fields[2]);
    return pid && pid !== process.pid && !managedPIDs.has(pid) && !managedPGIDs.has(pgid) && !line.includes("scripts/devctl") && !line.includes("scripts/devd");
  }).slice(0, 50);
}

function infra(action) {
  if (!['ensure', 'status', 'logs'].includes(action)) throw new Error("infra action must be ensure, status or logs");
  return { action, status: "not_applicable", managed: false, detail: "OfficeDex local development has no Docker, Compose, Kubernetes, database, cache, or object-store infrastructure." };
}

async function recoverRegistry() {
  let names = [];
  try { names = await readdir(p.instances); } catch { return; }
  for (const name of names) {
    const state = await readJSON(path.join(p.instances, name, "state.json"), null);
    if (!state) continue;
    migrateInstanceState(state);
    instances.set(state.instance_id, state);
    if (state.status === "ready") {
      try { await startRuntimeServer(state); } catch (error) {
        state.status = "failed";
        state.failure = `daemon recovery: ${error.message}`;
      }
    }
    await saveInstance(state);
  }
}

async function saveInstance(instance) {
  instance.updated_at = new Date().toISOString();
  instances.set(instance.instance_id, instance);
  await atomicWriteJSON(path.join(p.instances, instance.instance_id, "state.json"), instance);
}

function publicInstance(instance, extra = {}) {
  return {
    instance_id: instance.instance_id, scope: instance.scope, mode: instance.mode, status: instance.status,
    demo_mode: Boolean(instance.demo_mode),
    demo_auth: instance.demo_auth,
    demo_credits: instance.demo_credits,
    reused: extra.reused, lease_id: extra.lease_id,
    web_url: instance.web_url, api_url: instance.api_url, runtime_url: instance.runtime_url, bridge_url: instance.bridge_url,
    learnof_url: instance.learnof_url || null,
    dev_officecli_binary: instance.dev_officecli_binary || null,
    worktree: instance.worktree, git_revision: instance.git_revision,
    dirty_fingerprint: instance.dirty_fingerprint, logs: instance.logs, processes: instance.processes,
    ports: instance.ports, resources: instance.resources,
    leases: (instance.leases || []).map((lease) => ({ id: lease.id, expires_at: lease.expires_at })),
    started_at: instance.started_at, idle_since: instance.idle_since, failure: instance.failure,
    stop_reason: instance.stop_reason || null, stopped_at: instance.stopped_at || null,
    restart_count: instance.restart_count || 0, last_restart_at: instance.last_restart_at || null,
    reclaim_at: reclaimAt(instance),
  };
}

// When this instance gets collected if nothing renews a lease or reconnects. Shared instances are
// never collected, so they have no reclaim time.
function reclaimAt(instance) {
  if (instance.scope === "shared") return null;
  if (["stopped", "ownership_mismatch"].includes(instance.status)) return null;
  const leases = instance.leases || [];
  const base = leases.length
    ? Math.max(...leases.map((lease) => Date.parse(lease.expires_at)))
    : (instance.idle_since ? Date.parse(instance.idle_since) : NaN);
  if (!Number.isFinite(base)) return null;
  return new Date(base + idleTTL()).toISOString();
}

function migrateInstanceState(instance) {
  instance.daemon_version = DAEMON_VERSION;
  instance.demo_mode = Boolean(instance.demo_mode);
  instance.demo_auth = instance.demo_mode && instance.demo_auth === "logged_in" ? "logged_in" : "anonymous";
  instance.demo_credits = instance.demo_mode && Number.isSafeInteger(instance.demo_credits) ? instance.demo_credits : 0;
  instance.dev_officecli_binary = typeof instance.dev_officecli_binary === "string" ? instance.dev_officecli_binary : "";
  instance.ports ||= {};
  if (instance.mode === "browser" && !Number.isInteger(instance.ports.bridge) && instance.bridge_url) {
    try { instance.ports.bridge = Number(new URL(instance.bridge_url).port); } catch {}
  }
  if (instance.learnof_enabled && !Number.isInteger(instance.ports.learnof)) {
    const reserved = new Set(Object.values(instance.ports).filter(Number.isInteger));
    instance.ports.learnof = allocatePersistentPort(instance.instance_id, Number(process.env.OFFICEDEX_DEVCTL_LEARNOF_PORT_BASE || 4178), reserved);
  }
  if (instance.learnof_enabled && !instance.learnof_url) {
    instance.learnof_url = `http://127.0.0.1:${instance.ports.learnof}`;
  }
  return instance;
}

function persistentPorts(instance) {
  migrateInstanceState(instance);
  return { ...instance.ports };
}

function allocateInstancePorts(id, { preferredPorts = null, avoidPorts = new Set(), mode = "desktop", learnofEnabled = mode === "browser" } = {}) {
  const specs = [
    ["web", Number(process.env.OFFICEDEX_DEVCTL_WEB_PORT_BASE || 3100)],
    ["api", Number(process.env.OFFICEDEX_DEVCTL_API_PORT_BASE || 18100)],
    ["wails", Number(process.env.OFFICEDEX_DEVCTL_WAILS_PORT_BASE || 34115)],
  ];
  if (mode === "browser") specs.push(["bridge", Number(process.env.OFFICEDEX_DEVCTL_BRIDGE_PORT_BASE || 37100)]);
  if (learnofEnabled) specs.push(["learnof", Number(process.env.OFFICEDEX_DEVCTL_LEARNOF_PORT_BASE || 4178)]);
  const reserved = new Set(avoidPorts);
  const result = {};
  for (const [service, base] of specs) {
    const preferred = Number(preferredPorts?.[service]);
    if (Number.isInteger(preferred) && preferred > 0) {
      if (reserved.has(preferred) || portReservedByOtherInstance(id, preferred) || !portIsFree(preferred)) {
        throw new Error(`stable ${service} port ${preferred} for ${id} is unavailable; inspect the listener or run devctl reallocate-ports --instance ${id}`);
      }
      result[service] = preferred;
      reserved.add(preferred);
      continue;
    }
    result[service] = allocatePersistentPort(id, base, reserved);
    reserved.add(result[service]);
  }
  return result;
}

function allocatePersistentPort(id, base, reserved) {
  const span = 1000;
  const offset = stablePortOffset(id, span);
  for (let step = 0; step < span; step += 1) {
    const port = base + ((offset + step) % span);
    if (!reserved.has(port) && !portReservedByOtherInstance(id, port) && portIsFree(port)) return port;
  }
  throw new Error(`no free loopback port in ${base}-${base + span - 1}`);
}

function portReservedByOtherInstance(id, port) {
  return [...instances.values()].some((instance) => {
    if (instance.instance_id === id) return false;
    return Object.values(persistentPorts(instance)).includes(port);
  });
}

async function waitFor(check, timeoutMs, label) {
  const started = Date.now();
  let lastError;
  while (Date.now() - started < timeoutMs) {
    try {
      const result = await check();
      if (result) return result;
    } catch (error) { lastError = error; }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`timed out waiting for ${label}${lastError ? `: ${lastError.message}` : ""}`);
}

async function waitForOwnedReady(record, timeoutMs, label) {
  const started = Date.now();
  let lastReason = "not ready";
  while (Date.now() - started < timeoutMs) {
    const check = await verifyOwnedProcess(record, { requirePort: Boolean(record.port) });
    if (check.ok) return;
    lastReason = check.reason;
    if (check.reason === "process is not running") throw new Error(`${label} exited before readiness`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`timed out waiting for ${label}: ${lastReason}`);
}

async function waitUntilNotOwned(record, timeoutMs, label) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const check = await verifyOwnedProcess(record);
    if (!check.ok) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`timed out waiting for ${label}`);
}

async function discoverWebProcess(instance) {
  const lsof = spawnSync("lsof", ["-nP", `-iTCP:${instance.ports.web}`, "-sTCP:LISTEN", "-Fp"], { encoding: "utf8" });
  const pid = Number(lsof.stdout.split(/\r?\n/).find((line) => line.startsWith("p"))?.slice(1));
  if (!pid) throw new Error(`unable to identify Vite listener on ${instance.ports.web}`);
  const identity = await processIdentity(pid);
  if (!identity || path.resolve(identity.cwd) !== path.resolve(instance.worktree)) throw new Error("Vite listener ownership does not match the instance worktree");
  return {
    ...identity, service: "web", executable: identity.command.split(/\s+/, 1)[0], args: [],
    command_token: "vite", port: instance.ports.web, log: instance.logs.web, managed_by: "api",
  };
}

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  await appendLog(p.log, `devd shutting down signal=${signal}`);
  socketServer.close();
  for (const server of runtimeServers.values()) await new Promise((resolve) => server.close(resolve));
  await rm(p.socket, { force: true });
  await rm(p.pid, { force: true });
  const lockOwner = await readJSON(path.join(daemonRuntimeLock, "owner.json"), null);
  if (lockOwner?.lock_id === daemonLockID) await rm(daemonRuntimeLock, { recursive: true, force: true });
  process.exit(0);
}

async function claimDaemonRuntimeLock() {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await mkdir(daemonRuntimeLock);
      await atomicWriteJSON(path.join(daemonRuntimeLock, "owner.json"), {
        lock_id: daemonLockID,
        pid: process.pid,
        started_at_os: selfIdentity?.started_at_os,
        command: process.argv.join(" "),
        created_at: daemonStartedAt,
      });
      return;
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      const owner = await readJSON(path.join(daemonRuntimeLock, "owner.json"), null);
      const identity = owner?.pid ? await processIdentity(owner.pid) : null;
      if (identity && (!owner.started_at_os || identity.started_at_os === owner.started_at_os) && identity.command.includes("devd.mjs")) {
        process.exit(0);
      }
      await rm(daemonRuntimeLock, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
    }
  }
  throw new Error("unable to claim daemon runtime lock");
}
