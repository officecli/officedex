// Cache for the Writer embed build driven by scripts/build-embedded-writer.sh.
//
// The Writer embed is the slowest part of a local OfficeDex build (~160s: seven
// packages rebuilt with two full tsc passes each, plus a 52s default-font asset
// check). Its output only changes when the writer checkout, the officedex-side
// build scripts or the output-affecting environment changes, so this module
// fingerprints those inputs together with the synced public/writer tree. A hit
// lets the build skip both the writer build and the sync.
//
// The fingerprint is content-based on purpose: writer is often built from a
// dirty working tree, so HEAD alone would either miss real edits or hide them.
// It hashes HEAD, the full tracked diff (including staged changes and mode
// changes), every untracked non-ignored file, the resolved source path, the
// selected environment variables and the hashes of the officedex scripts that
// shape the artifact.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { access, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

export const CACHE_RECORD_VERSION = 1;

const SOURCE_FINGERPRINT_DOMAIN = "officedex-writer-embed-source-v1";
const PUBLIC_FINGERPRINT_DOMAIN = "officedex-writer-embed-public-v1";

// `git diff HEAD --binary` on a dirty checkout can be tens of megabytes; the
// default 1MB exec buffer would abort the build instead of simply missing.
const GIT_MAX_BUFFER = 512 * 1024 * 1024;

// Officedex-side inputs that shape the synced artifact. build-embedded-writer.sh
// decides how writer is built and what is copied; sync-writer-component.mjs
// decides what public/writer contains.
const OFFICEDEX_SCRIPT_FILES = [
  "build-embedded-writer.sh",
  "sync-writer-component.mjs",
];

function runGit(sourceDir, args, { quiet = false } = {}) {
  return execFileSync("git", ["-C", sourceDir, ...args], {
    encoding: "buffer",
    maxBuffer: GIT_MAX_BUFFER,
    stdio: quiet ? ["ignore", "pipe", "ignore"] : ["ignore", "pipe", "inherit"],
  });
}

export function isGitRepository(sourceDir) {
  try {
    runGit(sourceDir, ["rev-parse", "--git-dir"], { quiet: true });
    return true;
  } catch {
    return false;
  }
}

function hashEntries(hash, domain, entries) {
  hash.update(`${domain}\0`);
  for (const [name, value] of entries) {
    hash.update(`${name}\0${value}\0`);
  }
}

export async function computeWriterSourceFingerprint({
  sourceDir,
  env = {},
  extraFingerprints = {},
}) {
  const resolvedSource = path.resolve(sourceDir);
  const head = runGit(resolvedSource, ["rev-parse", "HEAD"]).toString("utf8").trim();
  const trackedDiff = runGit(resolvedSource, ["diff", "HEAD", "--binary"]);
  const untrackedPaths = runGit(resolvedSource, [
    "ls-files",
    "--others",
    "--exclude-standard",
    "-z",
  ])
    .toString("utf8")
    .split("\0")
    .filter((entry) => entry.length > 0)
    .sort();

  const hash = createHash("sha256");
  hashEntries(hash, SOURCE_FINGERPRINT_DOMAIN, [["source", resolvedSource]]);
  hash.update(`head\0${head}\0`);
  hash.update("tracked-diff\0");
  hash.update(trackedDiff);
  hash.update("\0");
  for (const relativePath of untrackedPaths) {
    hash.update(`untracked\0${relativePath}\0`);
    hash.update(await readFile(path.join(resolvedSource, relativePath)));
    hash.update("\0");
  }
  for (const name of Object.keys(env).sort()) {
    hash.update(`env\0${name}\0${env[name] ?? ""}\0`);
  }
  for (const name of Object.keys(extraFingerprints).sort()) {
    hash.update(`extra\0${name}\0${extraFingerprints[name] ?? ""}\0`);
  }
  return hash.digest("hex");
}

export async function computeDirectoryFingerprint({ dir }) {
  const resolvedDir = path.resolve(dir);
  const files = [];

  async function walk(current, prefix) {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
      const absolutePath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(absolutePath, relativePath);
      } else if (entry.isFile()) {
        files.push(relativePath);
      } else {
        throw new Error(`unsupported entry in ${resolvedDir}: ${absolutePath}`);
      }
    }
  }

  await walk(resolvedDir, "");
  files.sort();

  const hash = createHash("sha256");
  hashEntries(hash, PUBLIC_FINGERPRINT_DOMAIN, []);
  for (const relativePath of files) {
    hash.update(`file\0${relativePath}\0`);
    hash.update(await readFile(path.join(resolvedDir, relativePath)));
    hash.update("\0");
  }
  return hash.digest("hex");
}

export async function checkWriterEmbedCache({
  sourceDir,
  publicDir,
  distDir,
  recordPath,
  env = {},
  extraFingerprints = {},
}) {
  let record;
  try {
    record = JSON.parse(await readFile(recordPath, "utf8"));
  } catch {
    return { hit: false, reason: "no-record" };
  }
  if (
    record === null ||
    typeof record !== "object" ||
    record.version !== CACHE_RECORD_VERSION ||
    typeof record.sourceFingerprint !== "string" ||
    typeof record.publicFingerprint !== "string"
  ) {
    return { hit: false, reason: "record-invalid" };
  }
  if (!isGitRepository(sourceDir)) {
    return { hit: false, reason: "source-not-git" };
  }

  const sourceFingerprint = await computeWriterSourceFingerprint({
    sourceDir,
    env,
    extraFingerprints,
  });
  if (record.sourceFingerprint !== sourceFingerprint) {
    return { hit: false, reason: "source-changed" };
  }

  let publicFingerprint;
  try {
    publicFingerprint = await computeDirectoryFingerprint({ dir: publicDir });
  } catch {
    return { hit: false, reason: "public-missing" };
  }
  if (record.publicFingerprint !== publicFingerprint) {
    return { hit: false, reason: "public-changed" };
  }
  // stage:writer-fonts reads build/writer/dist, so a hit must not leave that
  // tree missing even though the local build itself only consumes public/writer.
  if (distDir) {
    try {
      await access(path.join(distDir, "index.html"));
    } catch {
      return { hit: false, reason: "dist-missing" };
    }
  }
  return { hit: true, reason: "hit" };
}

export async function writeWriterEmbedCache({
  sourceDir,
  publicDir,
  recordPath,
  env = {},
  extraFingerprints = {},
}) {
  const sourceFingerprint = await computeWriterSourceFingerprint({
    sourceDir,
    env,
    extraFingerprints,
  });
  const publicFingerprint = await computeDirectoryFingerprint({ dir: publicDir });
  await mkdir(path.dirname(recordPath), { recursive: true });
  await writeFile(
    recordPath,
    `${JSON.stringify(
      {
        version: CACHE_RECORD_VERSION,
        sourceFingerprint,
        publicFingerprint,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
}

export function writerEmbedEnvFingerprint(environment = process.env) {
  return {
    WRITER_LEGACY_FONT_DIR: environment.WRITER_LEGACY_FONT_DIR ?? "",
    WRITER_SOURCE_REVISION: environment.WRITER_SOURCE_REVISION ?? "",
  };
}

async function officedexScriptFingerprints(moduleDir) {
  const fingerprints = {};
  for (const name of OFFICEDEX_SCRIPT_FILES) {
    fingerprints[name] = createHash("sha256")
      .update(await readFile(path.join(moduleDir, name)))
      .digest("hex");
  }
  return fingerprints;
}

function parseArgs(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || !value) {
      throw new Error(`Invalid argument near ${key ?? "<end>"}`);
    }
    values.set(key.slice(2), value);
  }
  return values;
}

async function main() {
  const command = process.argv[2];
  const values = parseArgs(process.argv.slice(3));
  const sourceDir = values.get("source");
  const publicDir = values.get("public");
  const distDir = values.get("dist");
  const recordPath = values.get("record");
  if (!sourceDir || !publicDir || !recordPath) {
    throw new Error("check|write requires --source, --public and --record");
  }
  if (command !== "check" && command !== "write") {
    throw new Error(`unknown command: ${command ?? "<none>"}`);
  }

  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const extraFingerprints = await officedexScriptFingerprints(moduleDir);
  const env = writerEmbedEnvFingerprint();

  if (command === "check") {
    const result = await checkWriterEmbedCache({
      sourceDir,
      publicDir,
      distDir,
      recordPath,
      env,
      extraFingerprints,
    });
    process.stdout.write(result.hit ? "hit\n" : `miss:${result.reason}\n`);
    return;
  }

  await writeWriterEmbedCache({
    sourceDir,
    publicDir,
    recordPath,
    env,
    extraFingerprints,
  });
  process.stdout.write("written\n");
}

const isMain =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((error) => {
    // A cache miss must never fail the build; the shell falls back to a rebuild.
    // A cache write failure happens after the artifact already exists, so it is
    // reported but left for the caller to decide.
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    if (process.argv[2] === "check") {
      process.stdout.write("miss:error\n");
      return;
    }
    process.exitCode = 1;
  });
}
