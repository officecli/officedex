import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

export const DAEMON_VERSION = "18";

export function browserBridgeBuildTags(demoMode = false) {
  return demoMode
    ? "real_e2e,officedex_demo"
    : "real_e2e";
}

export function stateRoot() {
  return path.resolve(process.env.OFFICEDEX_DEVCTL_STATE_DIR || path.join(homedir(), ".cache", "officedex-dev"));
}

export function paths() {
  const root = stateRoot();
  return {
    root,
    socket: path.join(root, "devd.sock"),
    pid: path.join(root, "devd.pid"),
    log: path.join(root, "devd.log"),
    version: path.join(root, "daemon-version"),
    locks: path.join(root, "locks"),
    instances: path.join(root, "instances"),
  };
}

export async function ensureStateDirs() {
  const p = paths();
  await mkdir(p.locks, { recursive: true });
  await mkdir(p.instances, { recursive: true });
  return p;
}

export async function atomicWriteJSON(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${randomUUID()}`;
  await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(tmp, file);
}

export async function readJSON(file, fallback = null) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return fallback;
    throw error;
  }
}

export function runGit(cwd, args, fallback = "") {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : fallback;
}

export function worktreeRoot(cwd = process.cwd()) {
  const root = runGit(cwd, ["rev-parse", "--show-toplevel"]);
  if (!root) throw new Error(`not inside a Git worktree: ${cwd}`);
  return path.resolve(root);
}

export function sharedWorktree(cwd = process.cwd()) {
  const common = runGit(cwd, ["worktree", "list", "--porcelain"]);
  const first = common.split(/\r?\n/).find((line) => line.startsWith("worktree "));
  return first ? path.resolve(first.slice("worktree ".length)) : worktreeRoot(cwd);
}

export function instanceID(scope, worktree, mode = "desktop") {
  const base = scope === "shared"
    ? "shared"
    : `wt-${createHash("sha256").update(path.resolve(worktree)).digest("hex").slice(0, 10)}`;
  return mode === "browser" ? `${base}-browser` : base;
}

export function stablePortOffset(instanceId, span = 1000) {
  const size = Math.max(1, Number(span) || 1);
  const digest = createHash("sha256").update(String(instanceId)).digest();
  return digest.readUInt32BE(0) % size;
}

export function gitIdentity(worktree) {
  const revision = runGit(worktree, ["rev-parse", "HEAD"], "unknown");
  const status = runGit(worktree, ["status", "--porcelain=v1", "--untracked-files=all"], "");
  const diff = runGit(worktree, ["diff", "--no-ext-diff", "--binary", "HEAD"], "");
  const untracked = untrackedContentIdentity(worktree);
  const dirtyFingerprint = `sha256:${createHash("sha256").update(`${status}\0${diff}\0${untracked}`).digest("hex")}`;
  return { revision, dirty_fingerprint: dirtyFingerprint, dirty: status.length > 0 };
}

function untrackedContentIdentity(worktree) {
  const listed = spawnSync("git", ["ls-files", "--others", "--exclude-standard", "-z"], { cwd: worktree, encoding: "utf8" });
  if (listed.status !== 0 || !listed.stdout) return "";
  return listed.stdout
    .split("\0")
    .filter(Boolean)
    .sort()
    .map((relativePath) => `${relativePath}\0${runGit(worktree, ["hash-object", "--", relativePath], "missing")}`)
    .join("\0");
}

export function instanceResources(id, dir) {
  const safe = id.replace(/[^a-zA-Z0-9_-]/g, "_");
  return {
    user_data_dir: path.join(dir, "data"),
    sqlite: path.join(dir, "data", "officedex.sqlite"),
    workspace: path.join(dir, "data", "workspace"),
    runtime: path.join(dir, "data", "runtime"),
    officecli_home: path.join(dir, "officecli", "home"),
    officecli_config: path.join(dir, "officecli", "config.json"),
    temp_dir: path.join(dir, "tmp"),
    auth_namespace: `officedex_${safe}`,
    refresh_cookie: null,
    csrf_cookie: null,
    database: null,
    object_bucket: null,
  };
}

export async function processIdentity(pid) {
  if (!Number.isInteger(Number(pid)) || Number(pid) <= 0) return null;
  const ps = spawnSync("ps", ["-o", "pid=", "-o", "pgid=", "-o", "lstart=", "-o", "command=", "-p", String(pid)], { encoding: "utf8" });
  if (ps.status !== 0 || !ps.stdout.trim()) return null;
  const line = ps.stdout.trim();
  const match = line.match(/^\s*(\d+)\s+(\d+)\s+(.{24})\s+([\s\S]+)$/);
  if (!match) return null;
  let cwd = "";
  const lsof = spawnSync("lsof", ["-a", "-p", String(pid), "-d", "cwd", "-Fn"], { encoding: "utf8" });
  if (lsof.status === 0) cwd = lsof.stdout.split(/\r?\n/).find((entry) => entry.startsWith("n"))?.slice(1) || "";
  return { pid: Number(match[1]), pgid: Number(match[2]), started_at_os: match[3].trim(), command: match[4], cwd: path.resolve(cwd || "/") };
}

export async function verifyOwnedProcess(record, { requirePort = false } = {}) {
  if (!record) return { ok: false, reason: "missing process record" };
  const current = await processIdentity(record.pid);
  if (!current) return { ok: false, reason: "process is not running" };
  if (current.pgid !== record.pgid) return { ok: false, reason: "process group changed" };
  if (current.started_at_os !== record.started_at_os) return { ok: false, reason: "process start time changed" };
  if (path.resolve(current.cwd) !== path.resolve(record.cwd)) return { ok: false, reason: "process cwd changed" };
  if (record.command_token && !current.command.includes(record.command_token)) return { ok: false, reason: "process command changed" };
  if (requirePort && record.port && !(await groupOwnsPort(record.pgid, record.port))) return { ok: false, reason: "recorded port is not owned by the process group" };
  return { ok: true, current };
}

export async function groupOwnsPort(pgid, port) {
  const lsof = spawnSync("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-Fp"], { encoding: "utf8" });
  const pids = lsof.stdout.split(/\r?\n/).filter((line) => line.startsWith("p")).map((line) => Number(line.slice(1)));
  for (const pid of pids) {
    const identity = await processIdentity(pid);
    if (identity?.pgid === Number(pgid)) return true;
  }
  return false;
}

export function portIsFree(port) {
  const script = `const n=require('net');const s=n.createServer();s.once('error',()=>process.exit(1));s.listen(${Number(port)},'127.0.0.1',()=>s.close(()=>process.exit(0)))`;
  return spawnSync(process.execPath, ["-e", script]).status === 0;
}

export async function acquireMkdirLock(lockDir, owner, timeoutMs = 30_000) {
  const started = Date.now();
  const lockID = randomUUID();
  const ownedRecord = { ...owner, lock_id: lockID };
  while (Date.now() - started < timeoutMs) {
    try {
      await mkdir(lockDir);
      await atomicWriteJSON(path.join(lockDir, "owner.json"), ownedRecord);
      return async () => {
        const current = await readJSON(path.join(lockDir, "owner.json"), null);
        if (current?.lock_id === lockID) await rm(lockDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
      };
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      const existing = await readJSON(path.join(lockDir, "owner.json"), null);
      if (!existing) {
        const lockStat = await stat(lockDir).catch(() => null);
        if (lockStat && Date.now() - lockStat.mtimeMs < 2_000) {
          await new Promise((resolve) => setTimeout(resolve, 50));
          continue;
        }
      }
      const identity = existing?.pid ? await processIdentity(existing.pid) : null;
      if (!identity || (existing.started_at_os && identity.started_at_os !== existing.started_at_os)) {
        await rm(lockDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
        continue;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error(`timed out waiting for lock ${lockDir}`);
}

export async function fileExists(file) {
  try { await stat(file); return true; } catch { return false; }
}

export async function appendLog(file, line) {
  await mkdir(path.dirname(file), { recursive: true });
  const handle = await open(file, "a", 0o600);
  try { await handle.write(`${new Date().toISOString()} ${line}\n`); } finally { await handle.close(); }
}
