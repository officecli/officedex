#!/usr/bin/env node
// Fetches the platform-specific native packages a *foreign* presentation
// runtime needs (esbuild, rolldown/rollup, lightningcss for win32-x64 when the
// build host is a Mac) into build/cache/presentation-natives/<platform>-<arch>/.
//
// pnpm installs only the host's slice unless the presentation checkout's
// package.json lists the target under pnpm.supportedArchitectures. Until that
// lands there, the packages are fetched here with `npm pack` at exactly the
// version the staged host packages declare, so stage-presentation-runtime.mjs
// can find them through PRESENTATION_NATIVE_PACKAGES_DIR. Nothing is installed
// or executed; the tarballs are unpacked and their version re-read.
//
//   node scripts/fetch-presentation-natives.mjs --platform win32 --arch x64 [--source <presentation checkout>]

import { execFile as execFileCallback } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, realpath, rename, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { nativePackages, resolvePresentationSource } from "./stage-presentation-runtime.mjs";

const execFile = promisify(execFileCallback);

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");

export function nativesCacheDir(platform, arch, root = ROOT) {
  return path.join(root, "build", "cache", "presentation-natives", `${platform}-${arch}`);
}

/**
 * The exact versions the checkout's host packages pin for the target slice.
 * Read from the real packages (through pnpm's links), never guessed: a native
 * one patch level off is refused by the host at load time.
 */
export async function requiredNativeVersions(checkout, platform, arch) {
  const required = [];
  for (const native of nativePackages(platform, arch)) {
    const hostDir = path.join(checkout, "node_modules", native.host);
    if (!existsSync(path.join(hostDir, "package.json"))) {
      // rolldown and lightningcss are not top-level in every checkout; look
      // through the pnpm store for the host vite actually links to.
      const nested = await findHostInStore(checkout, native.host);
      if (!nested) continue;
      required.push(await versionFromHost(nested, native));
      continue;
    }
    required.push(await versionFromHost(await realpath(hostDir), native));
  }
  return required.filter(Boolean);
}

async function versionFromHost(hostDir, native) {
  const manifest = JSON.parse(await readFile(path.join(hostDir, "package.json"), "utf8"));
  const version = String(manifest.optionalDependencies?.[native.name] || "").trim();
  if (!version) return null;
  return { ...native, version, hostVersion: manifest.version };
}

async function findHostInStore(checkout, host) {
  const store = path.join(checkout, "node_modules", ".pnpm");
  if (!existsSync(store)) return null;
  const entries = (await readdir(store)).filter((name) => name.startsWith(`${host}@`)).sort();
  if (entries.length === 0) return null;
  // Prefer the one vite links to: vite's own sibling set names the host.
  for (const entry of entries) {
    const candidate = path.join(store, entry, "node_modules", host);
    if (existsSync(path.join(candidate, "package.json"))) return candidate;
  }
  return null;
}

/** `npm pack name@version` into a scratch dir, unpacked to <dest>/<name>/. */
async function fetchOne({ name, version }, dest, { npm = "npm", env = process.env } = {}) {
  const target = path.join(dest, name);
  if (existsSync(path.join(target, "package.json"))) {
    const have = JSON.parse(await readFile(path.join(target, "package.json"), "utf8"));
    if (have.version === version) return { name, version, path: target, cached: true };
    await rm(target, { recursive: true, force: true });
  }
  const scratch = await mkdtemp(path.join(os.tmpdir(), "officedex-natives-"));
  try {
    const { stdout } = await execFile(npm, ["pack", `${name}@${version}`, "--pack-destination", scratch, "--json"], {
      env,
      maxBuffer: 16 * 1024 * 1024,
    });
    const [packed] = JSON.parse(stdout);
    const tarball = path.join(scratch, packed.filename);
    const unpacked = path.join(scratch, "unpacked");
    await mkdir(unpacked, { recursive: true });
    await execFile("tar", ["-xzf", tarball, "-C", unpacked]);
    const manifest = JSON.parse(await readFile(path.join(unpacked, "package", "package.json"), "utf8"));
    if (manifest.name !== name || manifest.version !== version) {
      throw new Error(`npm pack returned ${manifest.name}@${manifest.version}, wanted ${name}@${version}`);
    }
    await mkdir(path.dirname(target), { recursive: true });
    await rename(path.join(unpacked, "package"), target);
    return { name, version, path: target, cached: false };
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

export async function fetchPresentationNatives({ platform, arch, source, dest, npm, env } = {}) {
  const checkout = source || resolvePresentationSource();
  const out = dest || nativesCacheDir(platform, arch);
  const required = await requiredNativeVersions(checkout, platform, arch);
  if (required.length === 0) {
    throw new Error(`no host package in ${checkout} declares a native for ${platform}-${arch}`);
  }
  await mkdir(out, { recursive: true });
  const fetched = [];
  for (const native of required) {
    fetched.push(await fetchOne(native, out, { npm, env }));
  }
  return { dest: out, fetched };
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (flag === "--platform") options.platform = value;
    else if (flag === "--arch") options.arch = value;
    else if (flag === "--source") options.source = value;
    else if (flag === "--dest") options.dest = value;
    else continue;
    index += 1;
  }
  if (!options.platform || !options.arch) {
    throw new Error("usage: fetch-presentation-natives.mjs --platform <win32|darwin|linux> --arch <x64|arm64> [--source <checkout>] [--dest <dir>]");
  }
  return options;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    const { dest, fetched } = await fetchPresentationNatives(parseArgs(process.argv.slice(2)));
    for (const native of fetched) {
      console.log(`[fetch-presentation-natives] ${native.name}@${native.version}${native.cached ? " (cached)" : ""} -> ${native.path}`);
    }
    console.log(`[fetch-presentation-natives] ${fetched.length} package(s) in ${dest}`);
  } catch (error) {
    console.error(`[fetch-presentation-natives] ${error.message}`);
    process.exit(1);
  }
}
