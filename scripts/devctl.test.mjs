import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { connect } from "node:net";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { realpath } from "node:fs/promises";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const cli = path.join(scriptDir, "devctl.mjs");
const fixture = path.join(scriptDir, "test-fixtures", "devctl-service.mjs");
const browserBridgeFixture = path.join(scriptDir, "test-fixtures", "devctl-browser-bridge.mjs");

test("concurrent sessions reuse safely, worktrees isolate, recovery and GC are fail-closed", { timeout: 120_000 }, async (t) => {
  const root = await temp("devctl 集成 with spaces");
  const state = path.join(tmpdir(), `odc-state-${process.pid}-${Date.now()}`);
  const repoA = await gitRepo(path.join(root, "仓库 A"));
  const repoB = await gitRepo(path.join(root, "仓库 B"));
  const unknown = spawn(process.execPath, [fixture, "39200"], { detached: true, stdio: "ignore" });
  let stablePortBlocker = null;
  t.after(async () => {
    try { process.kill(-unknown.pid, "SIGTERM"); } catch {}
    if (stablePortBlocker) try { process.kill(-stablePortBlocker.pid, "SIGTERM"); } catch {}
    const pidRecord = await readJSONFile(path.join(state, "devd.pid"));
    if (pidRecord?.pid) try { process.kill(pidRecord.pid, "SIGTERM"); } catch {}
    await new Promise((resolve) => setTimeout(resolve, 200));
    await cleanupManaged(state);
    await rm(state, { recursive: true, force: true });
    await rm(root, { recursive: true, force: true });
  });
  const env = {
    ...process.env,
    OFFICEDEX_DEVCTL_STATE_DIR: state,
    OFFICEDEX_DEVCTL_WEB_COMMAND: fixture,
    OFFICEDEX_DEVCTL_API_COMMAND: fixture,
    OFFICEDEX_DEVCTL_WEB_PORT_BASE: "39200",
    OFFICEDEX_DEVCTL_API_PORT_BASE: "39300",
    OFFICEDEX_DEVCTL_WAILS_PORT_BASE: "39400",
    OFFICEDEX_DEVCTL_BROWSER_BRIDGE_COMMAND: browserBridgeFixture,
    OFFICEDEX_DEVCTL_OFFICECLI_BINARY: process.execPath,
    OFFICEDEX_DEVCTL_BRIDGE_PORT_BASE: "39600",
    OFFICEDEX_DEVCTL_IDLE_TTL_MS: "0",
    OFFICEDEX_DEVCTL_TERM_TIMEOUT_MS: "1000",
  };

  const [first, second] = await Promise.all([
    runCLI(repoA, env, "ensure", "--scope", "worktree", "--json"),
    runCLI(repoA, env, "ensure", "--scope", "worktree", "--json"),
  ]);
  assert.equal(first.instance_id, second.instance_id);
  assert.equal([first.reused, second.reused].filter(Boolean).length, 1);
  assert.notEqual(first.ports.web, 39200, "unknown listener must not be killed or reused");
  assert.doesNotThrow(() => process.kill(unknown.pid, 0));

  const other = await runCLI(repoB, env, "ensure", "--scope", "worktree", "--json");
  assert.notEqual(other.instance_id, first.instance_id);
  assert.notEqual(other.resources.sqlite, first.resources.sqlite);
  assert.notEqual(other.resources.workspace, first.resources.workspace);
  assert.notEqual(other.resources.officecli_config, first.resources.officecli_config);

  const shared = await runCLI(repoA, env, "ensure", "--scope", "shared", "--json");
  assert.equal(shared.instance_id, "shared");
  assert.notEqual(shared.instance_id, first.instance_id);
  await assert.rejects(runCLI(repoA, env, "stop", "--instance", "shared", "--json"), /shared instance cannot be stopped/);

  const browser = await runCLI(repoA, env, "ensure", "--scope", "worktree", "--browser", "--no-open", "--json");
  assert.equal(browser.mode, "browser");
  assert.equal(browser.demo_mode, false);
  assert.equal(browser.dev_officecli_binary, process.execPath);
  assert.equal(browser.instance_id, `${first.instance_id}-browser`);
  assert.notEqual(browser.resources.user_data_dir, first.resources.user_data_dir);
  assert.match(browser.bridge_url, /^http:\/\/127\.0\.0\.1:/);
  assert.match(browser.learnof_url, /^http:\/\/127\.0\.0\.1:/);
  assert.equal(browser.processes.learnof.service, "learnof");
  assert.equal((await fetch(browser.learnof_url)).ok, true);
  assert.equal((await fetch(`${browser.bridge_url}/rpc/GetAppVersion`, { method: "POST", body: "null" })).ok, true);
  const demoBrowser = await runCLI(repoA, { ...env, OFFICEDEX_DEVCTL_BROWSER_DEMO: "1" }, "ensure", "--scope", "worktree", "--browser", "--no-open", "--json");
  assert.equal(demoBrowser.reused, false, "changing demo mode must replace the browser bridge");
  assert.equal(demoBrowser.demo_mode, true);
  assert.equal(demoBrowser.demo_auth, "anonymous");
  assert.equal(demoBrowser.demo_credits, 0);
  assert.deepEqual(demoBrowser.ports, browser.ports, "demo mode replacement must preserve stable ports");
  const demoRuntime = await fetch(demoBrowser.runtime_url).then((response) => response.json());
  assert.equal(demoRuntime.demo_mode, true);
  assert.equal(demoRuntime.demo_auth, "anonymous");
  assert.equal(demoRuntime.demo_credits, 0);
  assert.match(demoBrowser.learnof_url, /^http:\/\/127\.0\.0\.1:/);
  assert.equal(demoBrowser.processes.learnof.service, "learnof");
  assert.equal((await fetch(demoBrowser.learnof_url)).ok, true);
  const loggedInDemoEnv = {
    ...env,
    OFFICEDEX_DEVCTL_BROWSER_DEMO: "1",
    OFFICEDEX_DEVCTL_BROWSER_DEMO_AUTH: "logged_in",
    OFFICEDEX_DEVCTL_BROWSER_DEMO_CREDITS: "1000",
  };
  const loggedInDemo = await runCLI(repoA, loggedInDemoEnv, "ensure", "--scope", "worktree", "--browser", "--no-open", "--json");
  assert.equal(loggedInDemo.reused, false, "changing demo identity must replace the browser bridge");
  assert.equal(loggedInDemo.demo_auth, "logged_in");
  assert.equal(loggedInDemo.demo_credits, 1000);
  assert.deepEqual(loggedInDemo.ports, demoBrowser.ports, "demo identity replacement must preserve stable ports");
  const reusedLoggedInDemo = await runCLI(repoA, loggedInDemoEnv, "ensure", "--scope", "worktree", "--browser", "--no-open", "--json");
  assert.equal(reusedLoggedInDemo.reused, true);
  await fetch(`${reusedLoggedInDemo.bridge_url}/control/demo/session`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ auth: "anonymous", credits: 30 }),
  });
  const restoredLoggedInDemo = await runCLI(repoA, loggedInDemoEnv, "ensure", "--scope", "worktree", "--browser", "--no-open", "--json");
  assert.equal(restoredLoggedInDemo.reused, false, "ensure must replace a demo bridge whose live identity drifted from its configured identity");
  assert.equal(restoredLoggedInDemo.demo_auth, "logged_in");
  assert.equal(restoredLoggedInDemo.demo_credits, 1000);
  await assert.rejects(
    runCLI(repoA, { ...loggedInDemoEnv, OFFICEDEX_DEVCTL_BROWSER_DEMO_AUTH: "invalid" }, "ensure", "--scope", "worktree", "--browser", "--no-open", "--json"),
    /must be anonymous or logged_in/,
  );
  const desktopAfterBrowser = await runCLI(repoA, env, "status", "--instance", first.instance_id, "--json");
  assert.equal(desktopAfterBrowser.healthy, true, "browser mode must not replace the desktop instance");
  const restartedBrowser = await runCLI(repoA, env, "restart", "--instance", browser.instance_id, "--service", "api", "--json");
  assert.deepEqual(restartedBrowser.ports, browser.ports, "browser restart must preserve every assigned port");
  assert.equal(restartedBrowser.web_url, browser.web_url);
  assert.equal(restartedBrowser.bridge_url, browser.bridge_url);

  const runtime = await fetch(first.runtime_url).then((response) => response.json());
  assert.equal(runtime.instance_id, first.instance_id);
  assert.equal(await realpath(runtime.worktree), await realpath(repoA));
  assert.equal(runtime.git_revision, first.git_revision);
  assert.equal(runtime.dirty_fingerprint, first.dirty_fingerprint);

  const doctor = await runCLI(repoA, env, "doctor", "--json");
  assert.equal(doctor.destructive_actions, false);
  assert.ok(doctor.checks.some((check) => check.name.startsWith("cookies:") && check.status === "n/a"));

  await runCLI(repoA, env, "release", "--lease", first.lease_id, "--json");
  await runCLI(repoA, env, "release", "--lease", second.lease_id, "--json");
  const gc = await runCLI(repoA, env, "gc", "--force", "--json");
  assert.ok(gc.collected.some((entry) => entry.instance_id === first.instance_id));
  await assert.rejects(runCLI(repoA, env, "reset", "--instance", first.instance_id, "--confirm", "wrong", "--json"), /requires --confirm/);
  const reset = await runCLI(repoA, env, "reset", "--instance", first.instance_id, "--confirm", first.instance_id, "--json");
  assert.equal(reset.reset, true);
  const afterGC = await runCLI(repoA, env, "status", "--json");
  assert.equal(afterGC.instances.find((entry) => entry.instance_id === "shared").status, "ready");

  const priorDaemon = await readJSONFile(path.join(state, "devd.pid"));
  process.kill(priorDaemon.pid, "SIGTERM");
  await waitForExit(priorDaemon.pid);
  const restarted = await runCLI(repoA, env, "daemon", "ensure", "--json");
  assert.equal(restarted.status, "running");
  const recovered = await runCLI(repoA, env, "status", "--json");
  assert.ok(recovered.instances.some((entry) => entry.instance_id === "shared" && entry.healthy));

  await writeFile(path.join(repoB, "dirty.txt"), "changed\n");
  const refreshed = await runCLI(repoB, env, "ensure", "--scope", "worktree", "--json");
  assert.equal(refreshed.reused, false, "fingerprint mismatch must replace the old instance");
  assert.notEqual(refreshed.dirty_fingerprint, other.dirty_fingerprint);
  assert.deepEqual(refreshed.ports, other.ports, "fingerprint replacement must preserve stable instance ports");
  assert.equal(refreshed.web_url, other.web_url);

  await runCLI(repoB, env, "stop", "--instance", refreshed.instance_id, "--json");
  stablePortBlocker = spawn(process.execPath, [fixture, String(refreshed.ports.web)], { detached: true, stdio: "ignore" });
  await waitForHTTP(refreshed.web_url);
  await assert.rejects(
    runCLI(repoB, env, "ensure", "--scope", "worktree", "--json"),
    /stable web port .* is unavailable/,
    "a reserved port taken by an unknown process must fail closed",
  );
  process.kill(-stablePortBlocker.pid, "SIGTERM");
  await waitForExit(stablePortBlocker.pid);
  stablePortBlocker = null;
  const recoveredStablePort = await runCLI(repoB, env, "ensure", "--scope", "worktree", "--json");
  assert.deepEqual(recoveredStablePort.ports, refreshed.ports);

  const reallocated = await runCLI(repoA, env, "reallocate-ports", "--instance", browser.instance_id, "--json");
  assert.equal(reallocated.reallocated, true);
  assert.notDeepEqual(reallocated.ports, browser.ports, "explicit reallocation must move away from every prior port");
  assert.equal((await fetch(reallocated.web_url)).ok, true);
  assert.equal((await fetch(`${reallocated.bridge_url}/rpc/GetAppVersion`, { method: "POST", body: "null" })).ok, true);

  const stable = JSON.parse((await runRaw(repoA, env, "status", "--json")).stdout);
  assert.ok(Array.isArray(stable.instances));
  assert.equal(typeof stable.daemon.pid, "number");
});

test("child startup failure leaves an inspectable failed state and releases locks", { timeout: 30_000 }, async (t) => {
  const root = await temp("devctl-failure");
  const state = path.join(tmpdir(), `odc-fail-${process.pid}-${Date.now()}`);
  const repo = await gitRepo(path.join(root, "repo"));
  const env = {
    ...process.env,
    OFFICEDEX_DEVCTL_STATE_DIR: state,
    OFFICEDEX_DEVCTL_WEB_COMMAND: fixture,
    OFFICEDEX_DEVCTL_API_COMMAND: fixture,
    OFFICEDEX_DEVCTL_FIXTURE_FAIL: "1",
    OFFICEDEX_DEVCTL_WEB_PORT_BASE: "39500",
  };
  t.after(async () => {
    const pidRecord = await readJSONFile(path.join(state, "devd.pid"));
    if (pidRecord?.pid) try { process.kill(pidRecord.pid, "SIGTERM"); } catch {}
    await cleanupManaged(state);
    await rm(state, { recursive: true, force: true });
    await rm(root, { recursive: true, force: true });
  });
  await assert.rejects(runCLI(repo, env, "ensure", "--scope", "worktree", "--json"), /exited|timed out|did not remain healthy/);
  const lockNames = await import("node:fs/promises").then((fs) => fs.readdir(path.join(state, "locks")));
  assert.equal(lockNames.some((name) => name.startsWith("instance-")), false);
  const instanceDirs = await import("node:fs/promises").then((fs) => fs.readdir(path.join(state, "instances")));
  const failed = JSON.parse(await readFile(path.join(state, "instances", instanceDirs[0], "state.json"), "utf8"));
  assert.ok(["failed", "stopped"].includes(failed.status));
  assert.ok(failed.failure);
});

test("an established client connection defers idle GC", { timeout: 60_000 }, async (t) => {
  if (spawnSync("lsof", ["-v"], { encoding: "utf8" }).error) {
    t.skip("lsof is unavailable, so the live-client probe cannot run");
    return;
  }
  const root = await temp("devctl-live-client");
  const state = path.join(tmpdir(), `odc-live-${process.pid}-${Date.now()}`);
  const repo = await gitRepo(path.join(root, "repo"));
  let socket = null;
  const env = {
    ...process.env,
    OFFICEDEX_DEVCTL_STATE_DIR: state,
    OFFICEDEX_DEVCTL_WEB_COMMAND: fixture,
    OFFICEDEX_DEVCTL_API_COMMAND: fixture,
    OFFICEDEX_DEVCTL_WEB_PORT_BASE: "39700",
    OFFICEDEX_DEVCTL_API_PORT_BASE: "39750",
    OFFICEDEX_DEVCTL_WAILS_PORT_BASE: "39800",
    OFFICEDEX_DEVCTL_IDLE_TTL_MS: "0",
    OFFICEDEX_DEVCTL_TERM_TIMEOUT_MS: "1000",
  };
  t.after(async () => {
    socket?.destroy();
    const pidRecord = await readJSONFile(path.join(state, "devd.pid"));
    if (pidRecord?.pid) try { process.kill(pidRecord.pid, "SIGTERM"); } catch {}
    await new Promise((resolve) => setTimeout(resolve, 200));
    await cleanupManaged(state);
    await rm(state, { recursive: true, force: true });
    await rm(root, { recursive: true, force: true });
  });

  const instance = await runCLI(repo, env, "ensure", "--scope", "worktree", "--json");
  await runCLI(repo, env, "release", "--lease", instance.lease_id, "--json");

  socket = connect(instance.ports.web, "127.0.0.1");
  await once(socket, "connect");
  const held = await runCLI(repo, env, "gc", "--json");
  assert.equal(held.collected.length, 0, "an instance with a connected client must survive idle GC");
  const stillUp = await runCLI(repo, env, "status", "--instance", instance.instance_id, "--json");
  assert.equal(stillUp.status, "ready");

  socket.destroy();
  await once(socket, "close");
  socket = null;
  await new Promise((resolve) => setTimeout(resolve, 5_200)); // outlive the probe cache
  const collected = await runCLI(repo, env, "gc", "--json");
  assert.ok(collected.collected.some((entry) => entry.instance_id === instance.instance_id), "GC must resume once the client disconnects");
  const stopped = await runCLI(repo, env, "status", "--instance", instance.instance_id, "--json");
  assert.equal(stopped.status, "stopped");
  assert.equal(stopped.stop_reason, "garbage collection", "status must explain why the instance went away");
  assert.ok(stopped.stopped_at);
});

test("a crashed web server is restarted while a lease is held", { timeout: 60_000 }, async (t) => {
  const root = await temp("devctl-web-restart");
  const state = path.join(tmpdir(), `odc-restart-${process.pid}-${Date.now()}`);
  const repo = await gitRepo(path.join(root, "repo"));
  const env = {
    ...process.env,
    OFFICEDEX_DEVCTL_STATE_DIR: state,
    OFFICEDEX_DEVCTL_WEB_COMMAND: fixture,
    OFFICEDEX_DEVCTL_API_COMMAND: fixture,
    OFFICEDEX_DEVCTL_WEB_PORT_BASE: "39810",
    OFFICEDEX_DEVCTL_API_PORT_BASE: "39860",
    OFFICEDEX_DEVCTL_WAILS_PORT_BASE: "39910",
    OFFICEDEX_DEVCTL_TERM_TIMEOUT_MS: "1000",
    OFFICEDEX_DEVCTL_DISABLE_LIVE_CLIENT_PROBE: "1",
  };
  t.after(async () => {
    const pidRecord = await readJSONFile(path.join(state, "devd.pid"));
    if (pidRecord?.pid) try { process.kill(pidRecord.pid, "SIGTERM"); } catch {}
    await new Promise((resolve) => setTimeout(resolve, 200));
    await cleanupManaged(state);
    await rm(state, { recursive: true, force: true });
    await rm(root, { recursive: true, force: true });
  });

  const instance = await runCLI(repo, env, "ensure", "--scope", "worktree", "--json");
  assert.equal(instance.restart_count, 0);
  const record = await readJSONFile(path.join(state, "instances", instance.instance_id, "state.json"));
  const webPid = record.processes.web.pid;

  process.kill(webPid, "SIGKILL");
  await waitForExit(webPid);

  let restarted = null;
  for (let i = 0; i < 200; i += 1) {
    restarted = await runCLI(repo, env, "status", "--instance", instance.instance_id, "--json");
    if (restarted.status === "ready" && restarted.restart_count === 1) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.equal(restarted.status, "ready", `web was not restarted: ${restarted?.failure || "no failure recorded"}`);
  assert.equal(restarted.restart_count, 1);
  assert.ok(restarted.last_restart_at);
  await waitForHTTP(instance.web_url);
  const after = await readJSONFile(path.join(state, "instances", instance.instance_id, "state.json"));
  assert.notEqual(after.processes.web.pid, webPid, "a new web process must own the port");
});

async function runCLI(cwd, env, ...args) {
  const result = await runRaw(cwd, env, ...args);
  if (result.code !== 0) throw new Error(result.stderr.trim() || result.stdout.trim());
  return JSON.parse(result.stdout.trim());
}

function runRaw(cwd, env, ...args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [cli, ...args], { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("exit", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

async function gitRepo(dir) {
  await mkdir(dir, { recursive: true });
  run("git", ["init", "-q"], dir);
  run("git", ["config", "user.email", "devctl@example.test"], dir);
  run("git", ["config", "user.name", "Devctl Test"], dir);
  await writeFile(path.join(dir, "README.md"), "fixture\n");
  run("git", ["add", "README.md"], dir);
  run("git", ["commit", "-qm", "fixture"], dir);
  return path.resolve(dir);
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr || `${command} failed`);
}

async function cleanupManaged(state) {
  const instancesDir = path.join(state, "instances");
  let dirs = [];
  try { dirs = await import("node:fs/promises").then((fs) => fs.readdir(instancesDir)); } catch { return; }
  for (const dir of dirs) {
    const record = await readJSONFile(path.join(instancesDir, dir, "state.json"));
    for (const processRecord of Object.values(record?.processes || {})) {
      try { process.kill(-processRecord.pgid, "SIGTERM"); } catch {}
    }
  }
}

async function waitForExit(pid) {
  for (let i = 0; i < 100; i += 1) {
    try { process.kill(pid, 0); } catch { return; }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`pid ${pid} did not exit`);
}

async function waitForHTTP(url) {
  for (let i = 0; i < 100; i += 1) {
    if (await fetch(url).then((response) => response.ok).catch(() => false)) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`HTTP fixture did not become ready: ${url}`);
}

async function readJSONFile(file) {
  try { return JSON.parse(await readFile(file, "utf8")); } catch { return null; }
}

async function temp(name) {
  const dir = path.join(tmpdir(), `officedex-${name}-${process.pid}-${Date.now()}`);
  await mkdir(dir, { recursive: true });
  return dir;
}
