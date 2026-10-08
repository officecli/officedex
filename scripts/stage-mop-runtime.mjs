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

//
// A Windows package can be staged on a Mac. node.org ships Windows as a zip
// with node.exe at the archive root (there is no tar.gz and no bin/), so the
// archive name and the unpacking differ per platform, and the staged tree is
// normalised to bin/<node> because that is where the Go side looks
// (internal/runtimeenv NodeExecutable). What a Mac cannot do is start that
// node.exe, so the relocation probe is skipped *explicitly*: runtime.json then
// says relocationVerified:false and why, and the Windows smoke workflow is
// what turns it true.

import { chmod, cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createReadStream, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFile as execFileCallback } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { unzipSync } from "fflate";

import { canExecuteRuntime, nodeExecutableName, verifyRelocatableRuntime } from "./relocatable-runtime.mjs";

const execFile = promisify(execFileCallback);

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const DEST = path.join(ROOT, "build", "mop-runtime");

// The runtime that ships. Pinned here rather than in each build script, so the
// release DMG and a local build cannot drift onto different Node versions.
export const PINNED_NODE_VERSION = "v24.18.0";
const CACHE = path.join(ROOT, "build", "cache", "pptxgenjs-runtime");

/**
 * The archive name node.org publishes for a platform, which is also the name
 * in SHASUMS256: `node-vX-darwin-arm64.tar.gz`, but `node-vX-win-x64.zip`.
 */
export function archiveName(platform, arch, version = PINNED_NODE_VERSION) {
  if (platform === "win32") return `node-${version}-win-${arch}.zip`;
  return `node-${version}-${platform}-${arch}.tar.gz`;
}

/** Where the download lives in build/cache, and the one-line hint when it does not. */
export function archiveDownloadHint(platform, arch, version = PINNED_NODE_VERSION) {
  const name = archiveName(platform, arch, version);
  return `Download ${name} and SHASUMS256.txt from https://nodejs.org/dist/${version}/ into build/cache/pptxgenjs-runtime/ (save the checksums as node-${version}-SHASUMS256.txt)`;
}

/**
 * Unpacks a node.org archive into `dest` as `<dest>/bin/<node>`, whatever the
 * archive's own layout. tar.gz archives already carry bin/node under one top
 * directory; the Windows zip has node.exe at the root of its top directory.
 * The zip is read with fflate rather than a system unzip so staging does not
 * depend on which tools the build host happens to have.
 */
export async function extractNodeArchive(archive, dest, { platform }) {
  await rm(dest, { recursive: true, force: true });
  await mkdir(path.join(dest, "bin"), { recursive: true });
  if (platform !== "win32") {
    await execFile("tar", ["-xzf", archive, "-C", dest, "--strip-components=1"]);
    return path.join(dest, "bin", nodeExecutableName(platform));
  }
  const entries = unzipSync(new Uint8Array(await readFile(archive)));
  const wanted = Object.keys(entries).find((name) => {
    const parts = name.split("/").filter(Boolean);
    return parts.length === 2 && parts[1] === "node.exe";
  });
  if (!wanted) {
    throw new Error(`${archive} has no <top>/node.exe entry; is it really the node.org Windows zip?`);
  }
  const executable = path.join(dest, "bin", "node.exe");
  await writeFile(executable, entries[wanted]);
  return executable;
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
async function extractPinnedRuntime({ platform, arch, cache = CACHE }) {
  const tarball = path.join(cache, archiveName(platform, arch));
  if (!existsSync(tarball)) {
    throw new Error(`missing ${tarball}\n${archiveDownloadHint(platform, arch)}`);
  }
  const sumsFile = path.join(cache, `node-${PINNED_NODE_VERSION}-SHASUMS256.txt`);
  if (!existsSync(sumsFile)) throw new Error(`missing ${sumsFile}`);

  const wanted = archiveName(platform, arch);
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
  await extractNodeArchive(tarball, extracted, { platform });
  return extracted;
}

export async function stageMopRuntime({
  platform = process.platform,
  arch = os.arch(),
  source = process.env.MOP_RUNTIME_SOURCE?.trim() || "",
  dest = DEST,
  cache = CACHE,
  // The probe runs whenever this host can run the target. A cross-build (a
  // Windows runtime staged on a Mac) cannot, and says so in runtime.json
  // rather than pretending; passing probe:false on a host that *could* run
  // the runtime is refused by verifyRelocatableRuntime.
  probe = canExecuteRuntime(platform),
  verify = verifyRelocatableRuntime,
} = {}) {
  // An explicit source is still honoured: CI may hand over a runtime it built
  // and audited itself. What it no longer does is decide whether a runtime is
  // acceptable -- that is settled below, for every source alike.
  const sourceRoot = source || (await extractPinnedRuntime({ platform, arch, cache }));
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

    const verified = await verify(staging, { platform, arch, relocate: true, probe });

    await writeFile(
      path.join(staging, "runtime.json"),
      JSON.stringify(
        {
          name: "officedex-mop-runtime",
          // A cross-build has no version to report: nothing ran. The pinned
          // version is what the archive's checksum vouched for.
          nodeVersion: verified.version ?? PINNED_NODE_VERSION,
          platform,
          arch,
          source: source || `pinned:${PINNED_NODE_VERSION}`,
          // Recorded so a bundle can be audited without re-running the checks,
          // and so "it was verified" is a claim with a date on it -- or, for a
          // cross-build, an honest "it was not", with the reason and what did
          // get checked.
          relocationVerified: verified.probed,
          ...(verified.probed
            ? { verifiedAt: new Date().toISOString() }
            : {
                relocationUnverifiedReason: verified.unverifiedReason,
                fileChecks: verified.fileChecks,
                stagedOn: `${process.platform}-${os.arch()}`,
                stagedAt: new Date().toISOString(),
              }),
        },
        null,
        2,
      ) + "\n",
      "utf8",
    );

    await rm(dest, { recursive: true, force: true });
    await mkdir(path.dirname(dest), { recursive: true });
    await cp(staging, dest, { recursive: true, dereference: true });
    return {
      dest,
      version: verified.version,
      sourceNode,
      provenFrom: verified.provenFrom,
      probed: verified.probed,
      unverifiedReason: verified.unverifiedReason,
    };
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) {
  try {
    // A cross-platform or cross-architecture build stages the runtime that
    // ships, which is the target's, not the build host's.
    const { dest, version, sourceNode, probed, unverifiedReason } = await stageMopRuntime({
      platform: process.env.MOP_RUNTIME_PLATFORM?.trim() || process.platform,
      arch: process.env.MOP_RUNTIME_ARCH?.trim() || os.arch(),
    });
    if (probed) {
      console.log(`[stage-mop-runtime] ${sourceNode} -> ${dest} (${version}, verified relocatable)`);
    } else {
      console.log(`[stage-mop-runtime] ${sourceNode} -> ${dest} (NOT executed: ${unverifiedReason})`);
    }
  } catch (error) {
    console.error(`[stage-mop-runtime] ${error.message}`);
    process.exit(1);
  }
}
