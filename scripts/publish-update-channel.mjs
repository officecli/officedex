#!/usr/bin/env node
// Publish a locally compiled OfficeDex build onto an auto-update channel.
//
// 1.0 releases are compiled on this machine (scripts/build-mac-dmg.sh), not
// by GitHub Actions, and published to Huawei Cloud OBS: the zip goes up
// first, is checked by an anonymous download, and only then does the manifest
// that points at it. No GitHub Release is created for 1.0.
//
//   node scripts/publish-update-channel.mjs \
//     --channel 1.0 \
//     --darwin-arm64 dist-artifacts/OfficeDex-v1.0.6-darwin-arm64.zip \
//     [--version 1.0.6] [--darwin-amd64 path.zip] [--notes "..."] \
//     [--bridge-dist --dist ../officedex-dist --commit]
//
// --bridge-dist also writes the same manifest (OBS URLs) to officedex-dist's
// channels/1.0/, which is what 1.0.1–1.0.5 poll. Use it for the first OBS
// release only; after that those clients have moved and the file is frozen.
//
// --target dist is the old GitHub path (manifest in officedex-dist, assets on
// GitHub Releases); the stable channel always uses it and never touches OBS.
// OBS credentials: see scripts/obs-client.mjs.

import { readFile, writeFile, mkdir, copyFile, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import {
  CHANNEL_10,
  MANIFEST_URLS,
  OBS_BUCKET,
  OBS_PREFIX,
  OBS_REGION,
  assertVersionMatchesChannel,
  distArchiveDir,
  distManifestPath,
  forbiddenGitPaths,
  obsArchiveKey,
  obsAssetBaseUrl,
  obsAssetKey,
  obsManifestKey,
} from "./update-channel.mjs";
import { loadObsCredentials, obsObjectUrl, putObject } from "./obs-client.mjs";

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
  const target = String(args.target || (channel === CHANNEL_10 ? "obs" : "dist"));
  if (target !== "obs" && target !== "dist") throw new Error(`--target must be obs or dist, got ${target}`);
  if (target === "obs" && channel !== CHANNEL_10) throw new Error(`channel ${channel} is not published to OBS`);
  if (args["bridge-dist"] && target !== "obs") throw new Error("--bridge-dist only applies to --target obs");
  // OBS_PREFIX_OVERRIDE exists for a live end-to-end check under a scratch
  // prefix; a real release always uses the default.
  const prefix = String(process.env.OBS_PREFIX_OVERRIDE || OBS_PREFIX);

  const assets = [];
  for (const flag of ["darwin", "darwin-arm64", "darwin-amd64", "windows"]) {
    if (args[flag]) assets.push({ flag, file: path.resolve(String(args[flag])) });
  }
  if (assets.length === 0) {
    throw new Error("Need at least one of --darwin / --darwin-arm64 / --darwin-amd64 / --windows");
  }

  const scratch = await mkdtemp(path.join(os.tmpdir(), "officedex-manifest-"));
  const tmpOut = path.join(scratch, `manifest-${channel}-${version}.json`);
  const buildArgs = [
    BUILD_MANIFEST,
    "--version", version,
    "--channel", channel,
    "--out", tmpOut,
    ...assets.flatMap(({ flag, file }) => [`--${flag}`, file]),
  ];
  if (typeof args.notes === "string") buildArgs.push("--notes", args.notes);
  const baseUrl = target === "obs" ? obsAssetBaseUrl(prefix) : args["base-url"];
  if (baseUrl) buildArgs.push("--base-url", String(baseUrl));
  if (args["min-supported"]) buildArgs.push("--min-supported", String(args["min-supported"]));
  if (args.mandatory) buildArgs.push("--mandatory");
  run(process.execPath, buildArgs, OFFICEDEX_ROOT);
  const incoming = await readJson(tmpOut);
  await rm(scratch, { recursive: true, force: true });

  if (target === "obs") {
    await publishToObs({ channel, version, prefix, assets, incoming });
    if (!args["bridge-dist"]) return;
  }
  await writeDist({ args, channel, version, incoming, merge: target === "dist" });
}

/**
 * Upload order is the safety: every zip is up and downloadable anonymously at
 * the size the manifest will claim before the manifest that names it exists.
 */
async function publishToObs({ channel, version, prefix, assets, incoming }) {
  const credentials = loadObsCredentials();
  const manifestUrl = obsObjectUrl({ bucket: OBS_BUCKET, region: OBS_REGION, key: obsManifestKey(channel, prefix) });
  if (prefix === OBS_PREFIX && manifestUrl !== MANIFEST_URLS[channel]) {
    throw new Error(`OBS manifest ${manifestUrl} is not the URL clients poll (${MANIFEST_URLS[channel]})`);
  }

  // Same version, second arch: keep what is already published.
  const current = await fetch(`${manifestUrl}?t=${Date.now()}`, { cache: "no-store" });
  if (current.ok) {
    const existing = await current.json();
    if (existing.version === version && existing.assets && typeof existing.assets === "object") {
      incoming.assets = { ...existing.assets, ...incoming.assets };
    }
  } else if (current.status !== 404 && current.status !== 403) {
    throw new Error(`reading the current OBS manifest failed: HTTP ${current.status}`);
  }

  for (const { file } of assets) {
    const name = path.basename(file);
    const key = obsAssetKey(version, name, prefix);
    const bytes = await readFile(file);
    console.log(`Uploading ${name} (${bytes.length} bytes) to obs://${OBS_BUCKET}/${key}`);
    await putObject(credentials, { bucket: OBS_BUCKET, region: OBS_REGION, key, body: bytes, contentType: "application/zip" });
    const url = obsObjectUrl({ bucket: OBS_BUCKET, region: OBS_REGION, key });
    const head = await fetch(url, { method: "HEAD" });
    const size = Number(head.headers.get("content-length"));
    if (!head.ok || size !== bytes.length) {
      throw new Error(`anonymous check of ${url} failed: HTTP ${head.status}, ${size} bytes (expected ${bytes.length})`);
    }
    const listed = Object.values(incoming.assets).find((asset) => asset.url === url);
    if (!listed) throw new Error(`manifest has no asset at ${url}`);
  }

  const body = `${JSON.stringify(incoming, null, 2)}\n`;
  await putObject(credentials, {
    bucket: OBS_BUCKET, region: OBS_REGION, key: obsArchiveKey(channel, version, prefix),
    body, contentType: "application/json",
  });
  // Clients poll this file; a cached copy would hide a release.
  await putObject(credentials, {
    bucket: OBS_BUCKET, region: OBS_REGION, key: obsManifestKey(channel, prefix),
    body, contentType: "application/json", cacheControl: "no-cache, max-age=0",
  });
  const check = await fetch(`${manifestUrl}?t=${Date.now()}`, { cache: "no-store" });
  const published = check.ok ? await check.json() : null;
  if (published?.version !== version) {
    throw new Error(`OBS manifest reads back ${published?.version ?? `HTTP ${check.status}`}, expected ${version}`);
  }
  console.log(`Published ${manifestUrl} (channel=${channel}, version=${version}, assets=${Object.keys(incoming.assets).join(",")})`);
}

async function writeDist({ args, channel, version, incoming, merge }) {
  const distRoot = path.resolve(OFFICEDEX_ROOT, args.dist || "../officedex-dist");
  const manifestRel = distManifestPath(channel);
  const archiveRel = distArchiveDir(channel);
  const outPath = path.join(distRoot, manifestRel);

  if (merge && existsSync(outPath)) {
    const existing = await readJson(outPath);
    if (existing.version === version && existing.assets && typeof existing.assets === "object") {
      incoming.assets = { ...existing.assets, ...incoming.assets };
    }
  }

  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, `${JSON.stringify(incoming, null, 2)}\n`);
  await mkdir(path.join(distRoot, archiveRel), { recursive: true });
  await copyFile(outPath, path.join(distRoot, archiveRel, `manifest-v${version}.json`));

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
