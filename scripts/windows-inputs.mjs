#!/usr/bin/env node
// Packs and unpacks the "windows inputs" archive: everything a Windows build
// needs that only a Mac with the private sibling checkouts can produce.
//
//   node scripts/windows-inputs.mjs pack   [--out dist-artifacts/officedex-windows-inputs-<rev>.tar.gz]
//   node scripts/windows-inputs.mjs unpack <archive> [--sha256 <hex>] [--dest build/windows-inputs]
//
// The archive holds:
//
//   dist/                          the desktop renderer build (needs the presentation and writer checkouts)
//   presentation/                  build/presentation staged for win32-x64 (needs the presentation checkout)
//   writer-fonts/                  build/writer-fonts (needs the writer embed build)
//   mop-convert/win32-x64/mop-convert.exe   built from ppt2mop (needs the Rust registry)
//   word2mow/win32-x64/convert.exe          built from word2mow (needs the Rust registry)
//   manifest.json                  sha256 and size of every file, plus provenance
//
// A GitHub-hosted Windows runner reaches none of those sources, so the
// windows-smoke workflow takes this archive as its input and lets
// scripts/dist-win.mjs --inputs <dir> build from it. Everything else the
// package needs (officecli, node.exe, office2modoc_ffi.dll, licences) is
// public or already a secret the release workflow has.
//
// tar.gz rather than zip: bsdtar is on every macOS and Windows 10+ machine and
// streams, so a 400MB tree does not have to fit in memory the way fflate's
// zipSync would need.

import { spawnSync, execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");

export const INPUTS_FORMAT = 1;

/** What goes in, keyed by the path inside the archive. */
export function inputEntries(root = ROOT, slice = "win32-x64") {
  return [
    { at: "dist", from: path.join(root, "dist"), kind: "tree", mustContain: ["index.html"] },
    { at: "presentation", from: path.join(root, "build", "presentation"), kind: "tree", mustContain: ["runtime.json", path.join("tools", "bin", "mop-convert.exe")] },
    { at: "writer-fonts", from: path.join(root, "build", "writer-fonts"), kind: "tree", mustContain: ["prebuilt", "files"] },
    { at: path.join("mop-convert", slice, "mop-convert.exe"), from: path.join(root, "build", "cache", "mop-convert", slice, "mop-convert.exe"), kind: "file" },
    { at: path.join("word2mow", slice, "convert.exe"), from: path.join(root, "build", "cache", "word2mow", slice, "convert.exe"), kind: "file" },
  ];
}

async function sha256(file) {
  return createHash("sha256").update(await readFile(file)).digest("hex");
}

/**
 * The tar to run. On Windows, Git's GNU tar can be first on PATH in a bash
 * step and reads `C:\...` as a remote host; the system's bsdtar handles
 * Windows paths, so it is preferred when present.
 */
export function tarExecutable(platform = process.platform, env = process.env) {
  if (platform !== "win32") return "tar";
  const system = path.join(env.SystemRoot || env.windir || "C:\\Windows", "System32", "tar.exe");
  return existsSync(system) ? system : "tar";
}

/** Runs tar with the archive named relative to its own directory, for the same reason. */
export function runTar(args, archive, { cwd } = {}) {
  const archiveDir = path.dirname(archive);
  const resolved = args.map((arg) => (arg === archive ? path.basename(archive) : arg));
  return spawnSync(tarExecutable(), resolved, { cwd: cwd || archiveDir, stdio: "inherit" });
}

async function listFiles(dir) {
  const files = [];
  const walk = async (current) => {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile()) files.push(full);
    }
  };
  await walk(dir);
  return files.sort();
}

function gitRevision(root) {
  try {
    return execSync("git rev-parse HEAD", { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "unknown";
  }
}

/**
 * Builds the manifest for a staging directory laid out like the archive:
 * every file with its digest, so unpack can prove the tree arrived intact
 * even when the archive itself was not pinned.
 */
export async function buildManifest(stagingDir, { root = ROOT, slice = "win32-x64" } = {}) {
  const files = [];
  for (const file of await listFiles(stagingDir)) {
    const relative = path.relative(stagingDir, file).split(path.sep).join("/");
    if (relative === "manifest.json") continue;
    files.push({ path: relative, size: (await stat(file)).size, sha256: await sha256(file) });
  }
  let presentation = null;
  const runtimeJson = path.join(stagingDir, "presentation", "runtime.json");
  if (existsSync(runtimeJson)) {
    const parsed = JSON.parse(await readFile(runtimeJson, "utf8"));
    presentation = { platform: parsed.platform, arch: parsed.arch, sourceRevision: parsed.sourceRevision, sourceDirty: parsed.sourceDirty };
  }
  return {
    format: INPUTS_FORMAT,
    target: slice,
    officedexRevision: gitRevision(root),
    createdAt: new Date().toISOString(),
    createdOn: `${process.platform}-${os.arch()}`,
    presentation,
    files,
  };
}

/** Verifies a tree against its manifest; returns the problems found. */
export async function verifyManifest(dir, manifest) {
  const problems = [];
  for (const entry of manifest.files) {
    const file = path.join(dir, ...entry.path.split("/"));
    if (!existsSync(file)) {
      problems.push(`${entry.path}: missing`);
      continue;
    }
    const actual = await sha256(file);
    if (actual !== entry.sha256) problems.push(`${entry.path}: sha256 ${actual}, manifest says ${entry.sha256}`);
  }
  return problems;
}

export async function packInputs({ root = ROOT, out = "", slice = "win32-x64", entries = inputEntries(root, slice) } = {}) {
  for (const entry of entries) {
    if (!existsSync(entry.from)) throw new Error(`${entry.at}: ${entry.from} does not exist; run the matching dist-win step first`);
    for (const must of entry.mustContain ?? []) {
      if (!existsSync(path.join(entry.from, must))) throw new Error(`${entry.at}: ${entry.from} is missing ${must}`);
    }
  }
  const presentationManifest = JSON.parse(await readFile(path.join(root, "build", "presentation", "runtime.json"), "utf8"));
  if (`${presentationManifest.platform}-${presentationManifest.arch}` !== slice) {
    throw new Error(`build/presentation is staged for ${presentationManifest.platform}-${presentationManifest.arch}, not ${slice}; run dist-win --only presentation first`);
  }

  const staging = await mkdtemp(path.join(os.tmpdir(), "officedex-windows-inputs-"));
  try {
    for (const entry of entries) {
      const to = path.join(staging, entry.at);
      await mkdir(path.dirname(to), { recursive: true });
      await cp(entry.from, to, { recursive: entry.kind === "tree", dereference: true });
    }
    const manifest = await buildManifest(staging, { root, slice });
    await writeFile(path.join(staging, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n", "utf8");

    const archive = out || path.join(root, "dist-artifacts", `officedex-windows-inputs-${manifest.officedexRevision.slice(0, 12)}.tar.gz`);
    await mkdir(path.dirname(archive), { recursive: true });
    await rm(archive, { force: true });
    const tar = runTar(["-czf", archive, "-C", staging, "."], archive);
    if (tar.status !== 0) throw new Error(`tar exited with ${tar.status}`);
    return { archive, sha256: await sha256(archive), size: (await stat(archive)).size, files: manifest.files.length, manifest };
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

export async function unpackInputs({ archive, dest = path.join(ROOT, "build", "windows-inputs"), expectedSha256 = "" } = {}) {
  if (!archive || !existsSync(archive)) throw new Error(`inputs archive not found: ${archive}`);
  const actual = await sha256(archive);
  if (expectedSha256 && actual !== expectedSha256.toLowerCase()) {
    throw new Error(`inputs archive sha256 ${actual} does not match the expected ${expectedSha256}`);
  }
  await rm(dest, { recursive: true, force: true });
  await mkdir(dest, { recursive: true });
  const tar = runTar(["-xzf", archive, "-C", dest], archive);
  if (tar.status !== 0) throw new Error(`tar exited with ${tar.status}`);
  const manifestPath = path.join(dest, "manifest.json");
  if (!existsSync(manifestPath)) throw new Error(`${archive} has no manifest.json; not a windows-inputs archive`);
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  if (manifest.format !== INPUTS_FORMAT) throw new Error(`inputs archive format ${manifest.format}; this script reads format ${INPUTS_FORMAT}`);
  const problems = await verifyManifest(dest, manifest);
  if (problems.length > 0) throw new Error(`inputs archive did not unpack intact:\n  ${problems.join("\n  ")}`);
  return { dest, sha256: actual, manifest };
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const options = { command };
  for (let index = 0; index < rest.length; index += 1) {
    const flag = rest[index];
    if (flag === "--out") options.out = path.resolve(rest[++index]);
    else if (flag === "--dest") options.dest = path.resolve(rest[++index]);
    else if (flag === "--sha256") options.expectedSha256 = rest[++index];
    else if (!flag.startsWith("--") && !options.archive) options.archive = path.resolve(flag);
    else throw new Error(`unknown argument ${flag}`);
  }
  return options;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.command === "pack") {
      const result = await packInputs({ out: options.out });
      console.log(`[windows-inputs] ${result.archive}`);
      console.log(`[windows-inputs] ${result.files} file(s), ${result.size} bytes, sha256 ${result.sha256}`);
      console.log(`[windows-inputs] officedex ${result.manifest.officedexRevision}; presentation ${result.manifest.presentation?.sourceRevision}${result.manifest.presentation?.sourceDirty ? " (dirty)" : ""}`);
    } else if (options.command === "unpack") {
      const result = await unpackInputs(options);
      console.log(`[windows-inputs] unpacked ${result.manifest.files.length} file(s) into ${result.dest} (archive sha256 ${result.sha256})`);
    } else {
      throw new Error("usage: windows-inputs.mjs pack [--out <archive>] | unpack <archive> [--sha256 <hex>] [--dest <dir>]");
    }
  } catch (error) {
    console.error(`[windows-inputs] ${error.message}`);
    process.exit(1);
  }
}
