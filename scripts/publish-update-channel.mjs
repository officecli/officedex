#!/usr/bin/env node
// Publish a locally compiled OfficeDex build onto an auto-update channel.
//
// 1.0 releases are compiled on this machine (scripts/build-mac-dmg.sh), not
// by GitHub Actions. After the zip exists, this writes officedex-dist's
// channel manifest and refuses to touch the 0.5.x production file.
//
//   node scripts/publish-update-channel.mjs \
//     --channel 1.0 \
//     --darwin-arm64 dist-artifacts/OfficeDex-v1.0.1-darwin-arm64.zip \
//     --dist ../officedex-dist \
//     [--version 1.0.1] \
//     [--windows path/to.zip] \
//     [--notes "..."] \
//     [--commit]
//
// Asset URLs default to GitHub Releases (`/releases/download/vX.Y.Z/<file>`).
// Upload the zip with `gh release create vX.Y.Z --prerelease` before or after;
// clients only fetch once the manifest is on officedex-dist main.

import { readFile, writeFile, mkdir, copyFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import {
  CHANNEL_10,
  assertVersionMatchesChannel,
  distArchiveDir,
  distManifestPath,
  forbiddenGitPaths,
} from "./update-channel.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OFFICEDEX_ROOT = path.resolve(HERE, "..");
const BUILD_MANIFEST = path.join(HERE, "build-manifest.mjs");

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) {
      args[key] = true;
    } else {
      args[key] = next;
      i++;
    }
  }
  return args;
}

function run(cmd, cmdArgs, cwd) {
  const result = spawnSync(cmd, cmdArgs, { cwd, encoding: "utf8" });
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || "").trim();
    throw new Error(`${cmd} ${cmdArgs.join(" ")} failed${detail ? `: ${detail}` : ""}`);
  }
  return result.stdout;
}

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

async function main() {
  const args = parseArgs(process.argv);
  const channel = String(args.channel || CHANNEL_10);
  const version = String(args.version || (await readJson(path.join(OFFICEDEX_ROOT, "package.json"))).version).replace(/^v/, "");
  assertVersionMatchesChannel(channel, version);

  const distRoot = path.resolve(OFFICEDEX_ROOT, args.dist || "../officedex-dist");
  const manifestRel = distManifestPath(channel);
  const archiveRel = distArchiveDir(channel);
  const outPath = path.join(distRoot, manifestRel);
  const tmpOut = path.join(distRoot, `.manifest-${channel}-${version}.json`);

  const assetFlags = [];
  for (const flag of ["darwin", "darwin-arm64", "darwin-amd64", "windows"]) {
    if (args[flag]) {
      assetFlags.push(`--${flag}`, path.resolve(String(args[flag])));
    }
  }
  if (assetFlags.length === 0) {
    throw new Error("Need at least one of --darwin / --darwin-arm64 / --darwin-amd64 / --windows");
  }

  const buildArgs = [
    BUILD_MANIFEST,
    "--version", version,
    "--channel", channel,
    "--out", tmpOut,
    ...assetFlags,
  ];
  if (typeof args.notes === "string") buildArgs.push("--notes", args.notes);
  if (args["base-url"]) buildArgs.push("--base-url", String(args["base-url"]));
  if (args["min-supported"]) buildArgs.push("--min-supported", String(args["min-supported"]));
  if (args.mandatory) buildArgs.push("--mandatory");

  run(process.execPath, buildArgs, OFFICEDEX_ROOT);
  const incoming = await readJson(tmpOut);

  if (existsSync(outPath)) {
    const existing = await readJson(outPath);
    if (existing.version === version && existing.assets && typeof existing.assets === "object") {
      incoming.assets = { ...existing.assets, ...incoming.assets };
    }
  }

  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, `${JSON.stringify(incoming, null, 2)}\n`);
  await mkdir(path.join(distRoot, archiveRel), { recursive: true });
  await copyFile(outPath, path.join(distRoot, archiveRel, `manifest-v${version}.json`));
  await mkdir(path.dirname(tmpOut), { recursive: true });
  try {
    const { unlink } = await import("node:fs/promises");
    await unlink(tmpOut);
  } catch {
    // ignore
  }

  if (channel === CHANNEL_10) {
    const rootManifest = path.join(distRoot, "manifest.json");
    if (existsSync(rootManifest)) {
      const production = await readJson(rootManifest);
      if (String(production.version || "").startsWith("1.")) {
        throw new Error("refusing to leave a 1.x version in officedex-dist/manifest.json; 1.0 lives under channels/1.0/");
      }
    }
  }

  console.log(`Wrote ${path.relative(distRoot, outPath) || outPath} (channel=${channel}, version=${version}, assets=${Object.keys(incoming.assets).join(",")})`);

  if (!args.commit) return;

  const addPaths = channel === CHANNEL_10 ? ["channels/1.0/"] : ["manifest.json", "archive/"];
  run("git", ["add", "--", ...addPaths], distRoot);
  const staged = run("git", ["diff", "--cached", "--name-only"], distRoot).split("\n").filter(Boolean);
  for (const prefix of forbiddenGitPaths(channel)) {
    if (staged.some((name) => name === prefix || name.startsWith(prefix))) {
      run("git", ["reset", "HEAD", "--", ...staged], distRoot);
      throw new Error(`channel ${channel} refused to modify ${prefix}`);
    }
  }
  if (staged.length === 0) {
    console.log("Nothing to commit in officedex-dist.");
    return;
  }
  run("git", ["commit", "-m", `release: v${version} (${channel})`], distRoot);
  console.log(`Committed v${version} (${channel}) in ${distRoot}`);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
