#!/usr/bin/env node
// Stage the Node executable used by the MOP authoring worker.
//
// The runtime staged here is copied into the app bundle and run from there, so
// the only runtime worth staging is one that survives the copy. There used to
// be a development fallback to /opt/homebrew/bin/node, and it could not: that
// path is a symlink into the Cellar, and Homebrew's node is a small launcher
// that loads libnode and two dozen other dylibs from the directory it was
// installed in. Staged, it passed every check -- the symlink still pointed
// home. Bundled, it was a 68KB file next to an empty lib directory, and the
// first generation on a real machine died in dyld. So the fallback is gone:
// this script obtains the pinned self-contained runtime itself, which also
// means the release build and a local build no longer stage by different
// rules, and there is no environment variable left for anyone to forget.

import { chmod, cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createReadStream, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFile as execFileCallback } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { nodeExecutableName, verifyRelocatableRuntime } from "./relocatable-runtime.mjs";

const execFile = promisify(execFileCallback);

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const DEST = path.join(ROOT, "build", "mop-runtime");

// The runtime that ships. Pinned here rather than in each build script, so the
// release DMG and a local build cannot drift onto different Node versions.
export const PINNED_NODE_VERSION = "v24.18.0";
const CACHE = path.join(ROOT, "build", "cache", "pptxgenjs-runtime");

/** The tarball name node.org publishes, which is also the name in SHASUMS256. */
function tarballName(platform, arch) {
  return `node-${PINNED_NODE_VERSION}-${platform}-${arch}.tar.gz`;
}

async function sha256(file) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

/**
 * Extracts the pinned tarball into build/, verifying it against the published
 * checksums first. The tarball is a build input like any other: if it is
 * missing or has been altered, say so here rather than staging whatever is on
 * the machine.
 */
async function extractPinnedRuntime({ platform, arch }) {
  const tarball = path.join(CACHE, tarballName(platform, arch));
  if (!existsSync(tarball)) {
    throw new Error(
      `missing ${tarball}\nDownload ${tarballName(platform, arch)} and its SHASUMS256.txt from nodejs.org into build/cache/pptxgenjs-runtime/`,
    );
  }
  const sumsFile = path.join(CACHE, `node-${PINNED_NODE_VERSION}-SHASUMS256.txt`);
  if (!existsSync(sumsFile)) throw new Error(`missing ${sumsFile}`);

  const wanted = tarballName(platform, arch);
  const expected = (await readFile(sumsFile, "utf8"))
    .split("\n")
    .map((line) => line.trim().split(/\s+/))
    .find(([, name]) => name === wanted || name === `*${wanted}`)?.[0];
  const actual = await sha256(tarball);
  if (!expected) throw new Error(`${wanted} is not listed in ${sumsFile}`);
  if (expected !== actual) {
    throw new Error(`checksum mismatch for ${wanted}\n  expected ${expected}\n  actual   ${actual}`);
  }

  const extracted = path.join(ROOT, "build", `node-runtime-${platform}-${arch}`);
  await rm(extracted, { recursive: true, force: true });
  await mkdir(extracted, { recursive: true });
  await execFile("tar", ["-xzf", tarball, "-C", extracted, "--strip-components=1"]);
  return extracted;
}

export async function stageMopRuntime({
  platform = process.platform,
  arch = os.arch(),
  source = process.env.MOP_RUNTIME_SOURCE?.trim() || "",
} = {}) {
  // An explicit source is still honoured: CI may hand over a runtime it built
  // and audited itself. What it no longer does is decide whether a runtime is
  // acceptable -- that is settled below, for every source alike.
  const sourceRoot = source || (await extractPinnedRuntime({ platform, arch }));
  const sourceNode = path.join(sourceRoot, "bin", nodeExecutableName(platform));
  if (!existsSync(sourceNode)) {
    throw new Error(`no runtime executable at ${sourceNode}`);
  }

  // Stage into a scratch directory and move it into place only once it has
  // been proven, so a failed run cannot leave a broken runtime behind for the
  // next build to inherit. Inheriting one is how the Homebrew copy survived
  // four days of builds without anyone noticing.
  const scratch = await mkdtemp(path.join(os.tmpdir(), "officedex-stage-runtime-"));
  const staging = path.join(scratch, "mop-runtime");
  try {
    await mkdir(path.join(staging, "bin"), { recursive: true });
    // dereference: a symlink would be copied as a symlink, and the bundle
    // carries the file it copies, not the tree the link points into.
    await cp(sourceNode, path.join(staging, "bin", nodeExecutableName(platform)), {
      force: true,
      dereference: true,
    });
    if (platform !== "win32") await chmod(path.join(staging, "bin", nodeExecutableName(platform)), 0o755);

    const { version, provenFrom } = await verifyRelocatableRuntime(staging, {
      platform,
      relocate: true,
    });

    await writeFile(
      path.join(staging, "runtime.json"),
      JSON.stringify(
        {
          name: "officedex-mop-runtime",
          nodeVersion: version,
          platform,
          arch,
          source: source || `pinned:${PINNED_NODE_VERSION}`,
          // Recorded so a bundle can be audited without re-running the checks,
          // and so "it was verified" is a claim with a date on it.
          relocationVerified: true,
          verifiedAt: new Date().toISOString(),
        },
        null,
        2,
      ) + "\n",
      "utf8",
    );

    await rm(DEST, { recursive: true, force: true });
    await mkdir(path.dirname(DEST), { recursive: true });
    await cp(staging, DEST, { recursive: true, dereference: true });
    return { dest: DEST, version, sourceNode, provenFrom };
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) {
  try {
    // A cross-architecture build stages the runtime that ships, which is the
    // target's, not the build host's.
    const { dest, version, sourceNode } = await stageMopRuntime({
      arch: process.env.MOP_RUNTIME_ARCH?.trim() || os.arch(),
    });
    console.log(`[stage-mop-runtime] ${sourceNode} -> ${dest} (${version}, verified relocatable)`);
  } catch (error) {
    console.error(`[stage-mop-runtime] ${error.message}`);
    process.exit(1);
  }
}
