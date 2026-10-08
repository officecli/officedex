#!/usr/bin/env node
// The checks that only a Windows host can run against a packaged tree. The
// windows-smoke workflow is a thin shell around these so the same thing can be
// run on a developer's Windows machine:
//
//   node scripts/windows-smoke.mjs verify-runtime --package build/win32-x64
//       runs `officedex.exe --verify-runtime`: the app's own resolver report,
//       which starts the bundled node.exe and finds mop-convert.exe, the
//       presentation tree, convert.exe and the Writer fonts the way the app
//       will at startup. Fails when the app reports anything fatal missing.
//
//   node scripts/windows-smoke.mjs launch --package build/win32-x64 [--seconds 20]
//       starts officedex.exe with a throwaway user-data directory, lets it run,
//       and fails if it exits on its own in that time (a crash at startup, a
//       missing WebView2, a DLL that does not load). Then kills the process
//       tree. Nothing is clicked: this is "does the window process stay up",
//       not UI acceptance.
//
//   node scripts/windows-smoke.mjs mop-smoke --package build/win32-x64 --officecli-source <officecli-internal checkout>
//       runs officecli's TestPPTXMOPSkillEndToEndSmoke against the packaged
//       presentation tree, with the packaged node.exe and mop-convert.exe first
//       on PATH, so the production MOP pipeline (Go -> node.exe -> Vite SSR ->
//       mop-convert.exe) runs once on Windows with exactly the files that ship.
//
//   node scripts/windows-smoke.mjs report --package build/win32-x64 [--out smoke-report]
//       collects the build summary and the runtime manifests into a directory
//       of *scrubbed* text for upload: no binaries, no runtime tree, source
//       paths and internal names redacted (see scrubSensitive).
//
// Every subcommand prints what it ran and exits non-zero on failure. Output of
// anything that touches private checkouts (the officecli-internal test run,
// the app's own resolver report) passes through scrubSensitive first: this
// repository is public, so a workflow's log is public too.

import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");

/**
 * Extra redaction patterns, one regex source per line or comma-separated, from
 * OFFICEDEX_SCRUB_PATTERNS. The built-in list below names only what the
 * public tree already names (.npmrc.example carries the registry domain);
 * anything more specific to the company's network -- machine name prefixes,
 * further domains -- is supplied by the environment (a repository variable in
 * CI, a shell variable on a developer machine) so it never has to appear in
 * this file.
 */
export function extraScrubPatterns(env = process.env) {
  return String(env.OFFICEDEX_SCRUB_PATTERNS || "")
    .split(/[\n,]/)
    .map((pattern) => pattern.trim())
    .filter(Boolean)
    .map((pattern) => new RegExp(pattern, "gi"));
}

/**
 * Redacts what must not reach a public log or artifact: company host names,
 * tokens and credential-bearing URLs, ticket ids, and the user part of home
 * and runner work directories (the path shape stays readable).
 */
export function scrubSensitive(text, { extra = extraScrubPatterns() } = {}) {
  let out = String(text);
  for (const pattern of extra) out = out.replace(pattern, "[redacted]");
  return out
    // Internal infrastructure: any host under the company domains.
    .replace(/\b[a-z0-9.-]*\.shimo\.(?:im|run)\b/gi, "[internal-host]")
    // Credentials in URLs (x-access-token:ghp_...@github.com) and bare tokens.
    .replace(/\/\/[^\s/@]+:[^\s/@]+@/g, "//[redacted]@")
    .replace(/\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g, "[redacted-token]")
    .replace(/\b(Bearer|token)\s+[A-Za-z0-9._~+/=-]{16,}/gi, "$1 [redacted-token]")
    // Private tracker ids (the project key is spelled out in release notes
    // upstream, never in this tree).
    .replace(/\b[A-Z]{6,12}-\d{2,6}\b/g, "[ticket]")
    // Private network addresses.
    .replace(/\b(?:10|127)\.\d{1,3}\.\d{1,3}\.\d{1,3}\b|\b192\.168\.\d{1,3}\.\d{1,3}\b|\b172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}\b/g, "[internal-ip]")
    // Developer and runner home directories: keep the shape, drop the name.
    .replace(/\/Users\/[^/\s]+\//g, "/Users/[user]/")
    .replace(/\/home\/[^/\s]+\//g, "/home/[user]/")
    .replace(/([A-Za-z]:\\Users\\)[^\\\s]+\\/g, "$1[user]\\");
}

export function parseArgs(argv) {
  const [command, ...rest] = argv;
  const options = {
    command,
    package: path.join(ROOT, "build", "win32-x64"),
    seconds: 20,
    officecliSource: "",
    run: "TestPPTXMOPSkillEndToEndSmoke",
    out: path.join(ROOT, "smoke-report"),
  };
  for (let index = 0; index < rest.length; index += 1) {
    const flag = rest[index];
    const value = () => {
      index += 1;
      if (rest[index] === undefined) throw new Error(`${flag} needs a value`);
      return rest[index];
    };
    switch (flag) {
      case "--package": options.package = path.resolve(value()); break;
      case "--seconds": options.seconds = Number(value()); break;
      case "--officecli-source": options.officecliSource = path.resolve(value()); break;
      case "--run": options.run = value(); break;
      case "--out": options.out = path.resolve(value()); break;
      default: throw new Error(`unknown flag ${flag}`);
    }
  }
  if (!["verify-runtime", "launch", "mop-smoke", "report"].includes(command)) {
    throw new Error("usage: windows-smoke.mjs verify-runtime|launch|mop-smoke|report --package <dir> [...]");
  }
  return options;
}

/** The PATH a smoke run needs in front: the packaged node.exe and mop-convert.exe. */
export function smokePath(packageDir, existing = process.env.PATH || "", delimiter = path.delimiter) {
  return [
    path.join(packageDir, "mop-runtime", "bin"),
    path.join(packageDir, "presentation", "tools", "bin"),
    existing,
  ].filter(Boolean).join(delimiter);
}

/** Environment for officecli's smoke test: packaged tree first, nothing from the host. */
export function smokeEnvironment(packageDir, base = process.env) {
  return {
    ...base,
    PATH: smokePath(packageDir, base.PATH || base.Path || ""),
    OFFICECLI_MOP_PRESENTATION_ROOT: path.join(packageDir, "presentation"),
    MOP_CONVERT_BIN: path.join(packageDir, "presentation", "tools", "bin", "mop-convert.exe"),
  };
}

/** Lines of `--verify-runtime` output that mean a fatal payload is missing or broken. */
export function fatalVerifyRuntimeLines(output) {
  return output
    .split(/\r?\n/)
    .filter((line) => /^verify-runtime:\s+(presentation runtime|mop-convert|mop node runtime)\s+(MISSING|BROKEN)/.test(line));
}

function executable(packageDir) {
  const exe = path.join(packageDir, "officedex.exe");
  if (!existsSync(exe)) throw new Error(`no officedex.exe in ${packageDir}; run scripts/dist-win.mjs first`);
  return exe;
}

async function verifyRuntime(options) {
  const exe = executable(options.package);
  console.log(`[windows-smoke] $ ${exe} --verify-runtime`);
  const result = spawnSync(exe, ["--verify-runtime"], { encoding: "utf8", env: smokeEnvironment(options.package), cwd: options.package });
  process.stdout.write(scrubSensitive(result.stdout || ""));
  process.stderr.write(scrubSensitive(result.stderr || ""));
  const fatal = fatalVerifyRuntimeLines(result.stdout || "");
  if (result.status !== 0 || fatal.length > 0) {
    throw new Error(`--verify-runtime exited ${result.status}${fatal.length ? `; fatal:\n  ${fatal.join("\n  ")}` : ""}`);
  }
  console.log("[windows-smoke] verify-runtime: every fatal payload resolved and the packaged node started");
}

async function launch(options) {
  const exe = executable(options.package);
  const userData = await mkdtemp(path.join(os.tmpdir(), "officedex-smoke-"));
  console.log(`[windows-smoke] launching ${exe} for ${options.seconds}s (APPDATA=${userData})`);
  const child = spawn(exe, [], {
    cwd: options.package,
    env: { ...smokeEnvironment(options.package), APPDATA: userData, LOCALAPPDATA: userData },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: false,
  });
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { output += chunk; });
  const exited = new Promise((resolve) => child.once("exit", (code, signal) => resolve({ code, signal })));
  const timer = new Promise((resolve) => setTimeout(() => resolve(null), options.seconds * 1000));
  const outcome = await Promise.race([exited, timer]);
  try {
    if (outcome) {
      process.stdout.write(scrubSensitive(output));
      throw new Error(`officedex.exe exited on its own after less than ${options.seconds}s (code ${outcome.code}, signal ${outcome.signal})`);
    }
    console.log(`[windows-smoke] still running after ${options.seconds}s; stopping it`);
    if (process.platform === "win32") spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    else child.kill("SIGKILL");
    await exited;
    if (output.trim()) process.stdout.write(scrubSensitive(output));
  } finally {
    await rm(userData, { recursive: true, force: true }).catch(() => {});
  }
}

async function mopSmoke(options) {
  if (!options.officecliSource) throw new Error("--officecli-source <officecli-internal checkout> is required");
  if (!existsSync(path.join(options.officecliSource, "go.mod"))) throw new Error(`${options.officecliSource} is not a Go module checkout`);
  executable(options.package);
  for (const required of [
    path.join(options.package, "presentation", "runtime.json"),
    path.join(options.package, "presentation", "tools", "bin", "mop-convert.exe"),
    path.join(options.package, "mop-runtime", "bin", "node.exe"),
  ]) {
    if (!existsSync(required)) throw new Error(`packaged tree is missing ${required}`);
  }
  const env = smokeEnvironment(options.package);
  // No -v: the verbose log of a private test suite is not for a public run
  // log. Pass/fail plus go's own failure output is what the smoke needs, and
  // that output is scrubbed before it is printed.
  const args = ["test", "./internal/runtime", "-run", options.run, "-count=1"];
  console.log(`[windows-smoke] (cd <officecli-internal> && go ${args.join(" ")})`);
  console.log(`[windows-smoke] OFFICECLI_MOP_PRESENTATION_ROOT=${scrubSensitive(env.OFFICECLI_MOP_PRESENTATION_ROOT)}`);
  const result = spawnSync("go", args, { cwd: options.officecliSource, env, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  process.stdout.write(scrubSensitive(result.stdout || ""));
  process.stderr.write(scrubSensitive(result.stderr || ""));
  if (result.status !== 0) throw new Error(`go test exited ${result.status}`);
}

/** The JSON manifests worth keeping from a run, with their private fields dropped. */
export function scrubManifest(name, manifest) {
  const copy = { ...manifest };
  if (name === "presentation") {
    // The staging path and the private repository's revision are not for a
    // public artifact; what the tree *is* (platform, converter, natives) is.
    delete copy.source;
    delete copy.sourceRevision;
    delete copy.sourceDirty;
    delete copy.sourceRepository;
  }
  return JSON.parse(scrubSensitive(JSON.stringify(copy, null, 2)));
}

async function report(options) {
  await rm(options.out, { recursive: true, force: true });
  await mkdir(options.out, { recursive: true });
  const written = [];
  for (const [name, file] of [
    ["mop-runtime", path.join(options.package, "mop-runtime", "runtime.json")],
    ["presentation", path.join(options.package, "presentation", "runtime.json")],
  ]) {
    if (!existsSync(file)) continue;
    const manifest = scrubManifest(name, JSON.parse(await readFile(file, "utf8")));
    const target = path.join(options.out, `${name}.runtime.json`);
    await writeFile(target, JSON.stringify(manifest, null, 2) + "\n", "utf8");
    written.push(target);
  }
  const artifacts = path.join(ROOT, "dist-artifacts");
  if (existsSync(artifacts)) {
    for (const entry of await readdir(artifacts)) {
      if (!entry.endsWith(".build.json")) continue;
      const summary = JSON.parse(scrubSensitive(await readFile(path.join(artifacts, entry), "utf8")));
      await writeFile(path.join(options.out, entry), JSON.stringify(summary, null, 2) + "\n", "utf8");
      written.push(path.join(options.out, entry));
    }
  }
  for (const file of written) console.log(`[windows-smoke] report: ${path.relative(ROOT, file)}`);
  if (written.length === 0) throw new Error("nothing to report; run dist-win first");
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.command === "verify-runtime") await verifyRuntime(options);
    else if (options.command === "launch") await launch(options);
    else if (options.command === "report") await report(options);
    else await mopSmoke(options);
  } catch (error) {
    console.error(`[windows-smoke] ${error.message}`);
    process.exit(1);
  }
}
