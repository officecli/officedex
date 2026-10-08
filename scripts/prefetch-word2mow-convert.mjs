#!/usr/bin/env node
// Stage word2mow's `convert` binary into build/writer-convert.
//
// internal/word2mowhttp shells out to it for DOCX <-> MOW conversion, the same
// way the MOP handler shells out to mop-convert. bundle-runtime.mjs copies the
// staged binary into Contents/Resources/word2mow.
//
// Only one build of this binary exists today (macOS arm64, checked into the
// writer checkout). Every other target is an explicit, loud gap: shipping a
// package whose DOCX editor cannot convert anything is worse than failing here.
import { chmod, copyFile, mkdir, readFile, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { resolveWriterSource } from "./writer-source.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const DEFAULT_DEST = path.join(ROOT, "build", "writer-convert");

/**
 * The word2mow builds we know how to ship, keyed by `<platform>-<arch>`.
 * Digests pin the exact build so a silently swapped binary fails the stage.
 */
export const KNOWN_CONVERT_BUILDS = Object.freeze({
  "darwin-arm64": Object.freeze({
    sha256: "3024c16b06a2c1438a8327d806228efcdecb3f3b564316106cdeeae4164c316a",
    revision: "289bdf45c051f7ad2d7907120b909c8561dd8d5d",
  }),
});

export function convertBinaryName(platform = process.platform) {
  return platform === "win32" ? "convert.exe" : "convert";
}

/** The checked-in binary in the writer repository. */
export function defaultConvertSource({ platform = process.platform, writerSource } = {}) {
  const configured = String(process.env.OFFICEDEX_WORD2MOW_CONVERT_SRC || "").trim();
  if (configured) return path.resolve(configured);
  const source = writerSource || resolveWriterSource();
  return path.join(source, "apps", "docx-demo", "bin", convertBinaryName(platform));
}

export async function sha256File(file) {
  return createHash("sha256")
    .update(await readFile(file))
    .digest("hex");
}

export async function prefetchWord2MowConvert({
  platform = process.platform,
  arch = process.arch,
  source,
  dest = DEFAULT_DEST,
  builds = KNOWN_CONVERT_BUILDS,
} = {}) {
  const target = `${platform}-${arch}`;
  const build = builds[target];
  if (!build) {
    throw new Error(
      `no word2mow convert build for ${target}; only ${Object.keys(builds).join(", ")} exists. ` +
        "The DOCX editor cannot work without it — word2mow must publish a build for this target.",
    );
  }

  const from = source ? path.resolve(source) : defaultConvertSource({ platform });
  if (!existsSync(from)) {
    throw new Error(
      `word2mow convert binary not found: ${from}; set OFFICEDEX_WORD2MOW_CONVERT_SRC to a local build`,
    );
  }

  const digest = await sha256File(from);
  if (digest !== build.sha256) {
    throw new Error(
      `word2mow convert digest mismatch for ${target}: expected ${build.sha256}, got ${digest} (${from})`,
    );
  }

  const name = convertBinaryName(platform);
  const to = path.join(dest, name);
  await rm(dest, { recursive: true, force: true });
  await mkdir(dest, { recursive: true });
  await copyFile(from, to);
  if (platform !== "win32") {
    await chmod(to, 0o755);
  }
  return { target, source: from, dest: to, sha256: digest, revision: build.revision };
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
  return options;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  prefetchWord2MowConvert(parseArgs(process.argv.slice(2)))
    .then(({ target, dest, revision }) =>
      console.log(`[prefetch-word2mow-convert] ${target} -> ${dest} (word2mow ${revision})`),
    )
    .catch((error) => {
      console.error(`[prefetch-word2mow-convert] ${error.message}`);
      process.exit(1);
    });
}
