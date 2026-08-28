import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { acquireMkdirLock, atomicWriteJSON, browserBridgeBuildTags, gitIdentity, instanceID, instanceResources, processIdentity, readJSON, stablePortOffset, verifyOwnedProcess } from "./devlib.mjs";

test("instance IDs are stable by normalized worktree path and resources are isolated", () => {
  const a = instanceID("worktree", "/tmp/含 空格/project");
  assert.equal(a, instanceID("worktree", "/tmp/含 空格/project/../project"));
  assert.notEqual(a, instanceID("worktree", "/tmp/含 空格/other"));
  assert.equal(instanceID("shared", "/anything"), "shared");
  assert.equal(instanceID("shared", "/anything", "browser"), "shared-browser");
  assert.equal(instanceID("worktree", "/tmp/含 空格/project", "browser"), `${a}-browser`);
  const ra = instanceResources(a, "/tmp/a");
  const rb = instanceResources(instanceID("worktree", "/tmp/b"), "/tmp/b");
  assert.notEqual(ra.sqlite, rb.sqlite);
  assert.notEqual(ra.workspace, rb.workspace);
  assert.notEqual(ra.officecli_config, rb.officecli_config);
  assert.notEqual(ra.officecli_home, rb.officecli_home);
  assert.notEqual(ra.auth_namespace, rb.auth_namespace);
  assert.equal(ra.refresh_cookie, null);
  assert.equal(ra.csrf_cookie, null);
  assert.equal(ra.object_bucket, null);
});

test("stable port offsets are deterministic and bounded", () => {
  const first = stablePortOffset("wt-example-browser", 1000);
  assert.equal(first, stablePortOffset("wt-example-browser", 1000));
  assert.ok(first >= 0 && first < 1000);
  assert.notEqual(first, stablePortOffset("wt-other-browser", 1000));
});

test("browser bridge demo mode adds only the compiled local demo tag", () => {
  assert.equal(browserBridgeBuildTags(false), "real_e2e");
  assert.equal(browserBridgeBuildTags(true), "real_e2e,officedex_demo");
});

test("dirty fingerprint changes when an untracked file's content changes", async () => {
  const root = await temp("untracked-fingerprint");
  const git = (...args) => spawnSync("git", args, { cwd: root, encoding: "utf8" });
  assert.equal(git("init").status, 0);
  assert.equal(git("config", "user.email", "devctl@example.test").status, 0);
  assert.equal(git("config", "user.name", "Devctl Test").status, 0);
  await writeFile(path.join(root, "tracked.txt"), "baseline\n");
  assert.equal(git("add", "tracked.txt").status, 0);
  assert.equal(git("commit", "-m", "baseline").status, 0);

  await writeFile(path.join(root, "generator.cjs"), "first\n");
  const first = gitIdentity(root);
  await writeFile(path.join(root, "generator.cjs"), "second\n");
  const second = gitIdentity(root);
  assert.notEqual(first.dirty_fingerprint, second.dirty_fingerprint);
  await rm(root, { recursive: true, force: true });
});

test("atomic JSON writes remain parseable", async () => {
  const root = await temp("atomic-json");
  const file = path.join(root, "state.json");
  await Promise.all(Array.from({ length: 20 }, (_, i) => atomicWriteJSON(file, { i })));
  const parsed = await readJSON(file);
  assert.equal(typeof parsed.i, "number");
  await rm(root, { recursive: true, force: true });
});

test("stale mkdir lock is recovered but a live lock is not stolen", async () => {
  const root = await temp("mkdir-lock");
  const lock = path.join(root, "lock");
  await mkdir(lock);
  await atomicWriteJSON(path.join(lock, "owner.json"), { pid: 99999999, started_at_os: "stale" });
  const release = await acquireMkdirLock(lock, { pid: process.pid }, 1_000);
  await release();

  const self = await processIdentity(process.pid);
  await mkdir(lock);
  await atomicWriteJSON(path.join(lock, "owner.json"), { pid: process.pid, started_at_os: self.started_at_os });
  await assert.rejects(acquireMkdirLock(lock, { pid: process.pid }, 200), /timed out/);
  await rm(root, { recursive: true, force: true });
});

test("PID reuse or command mismatch fails closed", async () => {
  const child = spawn(process.execPath, ["-e", "setInterval(()=>{},60000)"], { cwd: process.cwd(), detached: true, stdio: "ignore" });
  const identity = await waitIdentity(child.pid);
  const record = { ...identity, command_token: "definitely-not-the-running-command", port: 0 };
  const check = await verifyOwnedProcess(record);
  assert.equal(check.ok, false);
  assert.match(check.reason, /command/);
  process.kill(-identity.pgid, "SIGTERM");
});

async function waitIdentity(pid) {
  for (let i = 0; i < 50; i += 1) {
    const value = await processIdentity(pid);
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("process identity unavailable");
}

async function temp(name) {
  const dir = path.join(tmpdir(), `officedex-${name}-${process.pid}-${Date.now()}`);
  await mkdir(dir, { recursive: true });
  return dir;
}
