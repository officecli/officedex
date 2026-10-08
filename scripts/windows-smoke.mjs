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
// Every subcommand prints what it ran and exits non-zero on failure.

import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");

export function parseArgs(argv) {
  const [command, ...rest] = argv;
  const options = {
    command,
    package: path.join(ROOT, "build", "win32-x64"),
    seconds: 20,
    officecliSource: "",
    run: "TestPPTXMOPSkillEndToEndSmoke",
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
      default: throw new Error(`unknown flag ${flag}`);
    }
  }
  if (!["verify-runtime", "launch", "mop-smoke"].includes(command)) {
    throw new Error("usage: windows-smoke.mjs verify-runtime|launch|mop-smoke --package <dir> [...]");
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
  process.stdout.write(result.stdout || "");
  process.stderr.write(result.stderr || "");
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
      process.stdout.write(output);
      throw new Error(`officedex.exe exited on its own after less than ${options.seconds}s (code ${outcome.code}, signal ${outcome.signal})`);
    }
    console.log(`[windows-smoke] still running after ${options.seconds}s; stopping it`);
    if (process.platform === "win32") spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    else child.kill("SIGKILL");
    await exited;
    if (output.trim()) process.stdout.write(output);
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
  const args = ["test", "./internal/runtime", "-run", options.run, "-count=1", "-v"];
  console.log(`[windows-smoke] (cd ${options.officecliSource} && go ${args.join(" ")})`);
  console.log(`[windows-smoke] OFFICECLI_MOP_PRESENTATION_ROOT=${env.OFFICECLI_MOP_PRESENTATION_ROOT}`);
  const result = spawnSync("go", args, { cwd: options.officecliSource, env, stdio: "inherit" });
  if (result.status !== 0) throw new Error(`go test exited ${result.status}`);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.command === "verify-runtime") await verifyRuntime(options);
    else if (options.command === "launch") await launch(options);
    else await mopSmoke(options);
  } catch (error) {
    console.error(`[windows-smoke] ${error.message}`);
    process.exit(1);
  }
}
