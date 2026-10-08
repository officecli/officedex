#!/usr/bin/env node
// Decides whether a staged Node runtime will still work after it is copied
// into a bundle.
//
// This exists because presence used to be indistinguishable from working. The
// MOP runtime was staged by copying /opt/homebrew/bin/node, which is a symlink
// into the Cellar. Everything downstream said yes: the stager ran the staged
// path and got a version back, and verify-packaged-runtime saw a non-empty
// directory. Both were true and both were meaningless -- the symlink still
// resolved to its Cellar home, where the twenty-seven dylibs Homebrew's node
// links against were sitting next to it. Bundling materialised the symlink
// into a real 68KB launcher, `@loader_path/../lib` became an empty directory,
// and the first PPTX generation died with "Library not loaded:
// @rpath/libnode.147.dylib" -- at the worker, minutes into a user's task.
//
// So the property to check is not "is there a node" but "does this node run
// once it no longer lives where it was built". Two things establish that:
// its recorded dependencies name nothing outside the OS, and it executes from
// a directory that is not the one it was staged from.

import { cp, lstat, mkdtemp, rm } from "node:fs/promises";
import { execFile as execFileCallback } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);

// Paths every macOS machine has. A runtime may link these because they ship
// with the OS; anything else has to travel inside the bundle, and none of the
// staging paths copy loose libraries, so anything else is a defect.
export const SYSTEM_DEPENDENCY_PREFIXES = Object.freeze([
  "/usr/lib/",
  "/System/Library/",
]);

export function nodeExecutableName(platform = process.platform) {
  return platform === "win32" ? "node.exe" : "node";
}

/**
 * Reads the shared libraries a Mach-O binary names, as otool reports them.
 *
 * The first line of otool -L output is the binary itself, not a dependency.
 */
export async function readMachODependencies(binary, { run = execFile } = {}) {
  const { stdout } = await run("otool", ["-L", binary]);
  return stdout
    .split("\n")
    .slice(1)
    .map((line) => line.trim().split(/\s+\(/, 1)[0])
    .filter(Boolean);
}

/**
 * The dependencies that would not be found on a machine that never installed
 * a developer toolchain: @rpath/@loader_path entries the bundle does not
 * carry, and anything under Homebrew, MacPorts or /usr/local.
 */
export function foreignDependencies(dependencies) {
  return dependencies.filter(
    (dependency) => !SYSTEM_DEPENDENCY_PREFIXES.some((prefix) => dependency.startsWith(prefix)),
  );
}

/**
 * Verifies a staged runtime directory is one that survives being copied.
 *
 * `relocate` decides where the executable is proven: a staging directory has
 * not moved yet, so its runtime is copied to a scratch directory and run from
 * there -- in place it would pass on the strength of a neighbour it is about
 * to leave behind. A packaged runtime is already at its destination, so it is
 * run where it sits, which is exactly where the app will run it.
 *
 * Returns the version the runtime reported and the dependencies it names.
 */
export async function verifyRelocatableRuntime(runtimeDir, options = {}) {
  const {
    platform = process.platform,
    relocate = false,
    readDependencies = readMachODependencies,
    run = execFile,
  } = options;

  const executable = path.join(runtimeDir, "bin", nodeExecutableName(platform));

  let info;
  try {
    info = await lstat(executable);
  } catch {
    throw new Error(`no runtime executable at ${executable}`);
  }
  if (info.isSymbolicLink()) {
    throw new Error(
      `${executable} is a symlink; a bundle carries the file it copies, not the tree the link points into. Stage the runtime with dereference so the executable travels with its libraries`,
    );
  }
  if (!info.isFile()) {
    throw new Error(`${executable} is not a file`);
  }

  if (platform === "darwin") {
    const dependencies = await readDependencies(executable, { run });
    const foreign = foreignDependencies(dependencies);
    if (foreign.length > 0) {
      throw new Error(
        `${executable} links libraries the bundle does not carry:\n  ${foreign.join("\n  ")}\nUse a self-contained Node build; a package manager's node loads its own dylibs from where it was installed`,
      );
    }
  }

  const { version, from } = await probeRuntime(runtimeDir, { platform, relocate, run });
  return { executable, version, provenFrom: from };
}

/**
 * Runs the runtime and returns the version it reports. When `relocate` is set
 * the whole directory is copied to a scratch location first, so what is proven
 * is that the runtime works somewhere other than where it was built.
 */
async function probeRuntime(runtimeDir, { platform, relocate, run }) {
  if (!relocate) {
    const executable = path.join(runtimeDir, "bin", nodeExecutableName(platform));
    return { version: await reportVersion(executable, run), from: runtimeDir };
  }

  const scratch = await mkdtemp(path.join(os.tmpdir(), "officedex-runtime-probe-"));
  const relocated = path.join(scratch, "mop-runtime");
  try {
    await cp(runtimeDir, relocated, { recursive: true, dereference: true });
    const executable = path.join(relocated, "bin", nodeExecutableName(platform));
    return { version: await reportVersion(executable, run), from: relocated };
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

async function reportVersion(executable, run) {
  try {
    const { stdout } = await run(executable, ["--version"]);
    return stdout.trim();
  } catch (error) {
    const detail = [error.stderr, error.message].map((part) => String(part ?? "").trim()).find(Boolean);
    throw new Error(
      `the staged runtime does not run from ${path.dirname(path.dirname(executable))}: ${detail}`,
    );
  }
}
