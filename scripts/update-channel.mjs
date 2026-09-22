#!/usr/bin/env node
// Channel names, dist paths, and version guards for OfficeDex auto-update.
//
// Usage:
//   node scripts/update-channel.mjs --assert --channel 1.0 --version 1.0.1
//   node scripts/update-channel.mjs --paths --channel stable

import path from "node:path";
import { fileURLToPath } from "node:url";

export const CHANNEL_STABLE = "stable";
export const CHANNEL_10 = "1.0";

export const MANIFEST_URLS = {
  [CHANNEL_STABLE]: "https://raw.githubusercontent.com/officecli/officedex-dist/main/manifest.json",
  [CHANNEL_10]: "https://raw.githubusercontent.com/officecli/officedex-dist/main/channels/1.0/manifest.json",
};

const CHANNELS = new Set([CHANNEL_STABLE, CHANNEL_10]);

export function normalizeChannel(channel) {
  return String(channel ?? "").trim();
}

export function normalizeVersion(version) {
  return String(version ?? "").trim().replace(/^v/, "");
}

export function assertKnownChannel(channel) {
  const name = normalizeChannel(channel);
  if (!CHANNELS.has(name)) {
    throw new Error(`unknown update channel ${JSON.stringify(channel)}; expected ${CHANNEL_STABLE} or ${CHANNEL_10}`);
  }
  return name;
}

export function assertVersionMatchesChannel(channel, version) {
  const name = assertKnownChannel(channel);
  const ver = normalizeVersion(version);
  if (!ver) {
    throw new Error("version is required");
  }
  if (name === CHANNEL_10) {
    if (!/^1\.0\.\d+$/.test(ver)) {
      throw new Error(`channel ${CHANNEL_10} requires version 1.0.N, got ${JSON.stringify(version)}`);
    }
    return { channel: name, version: ver };
  }
  if (!/^0\.\d+\.\d+$/.test(ver)) {
    throw new Error(`channel ${CHANNEL_STABLE} requires version 0.x.y, got ${JSON.stringify(version)}`);
  }
  return { channel: name, version: ver };
}

export function distManifestPath(channel) {
  const name = assertKnownChannel(channel);
  return name === CHANNEL_10 ? "channels/1.0/manifest.json" : "manifest.json";
}

export function distArchiveDir(channel) {
  const name = assertKnownChannel(channel);
  return name === CHANNEL_10 ? "channels/1.0/archive" : "archive";
}

export function isPrereleaseChannel(channel) {
  return assertKnownChannel(channel) === CHANNEL_10;
}

export function gitAddPaths(channel) {
  const name = assertKnownChannel(channel);
  return name === CHANNEL_10 ? ["channels/1.0/"] : ["manifest.json", "archive/"];
}

export function forbiddenGitPaths(channel) {
  const name = assertKnownChannel(channel);
  return name === CHANNEL_10 ? ["manifest.json"] : ["channels/"];
}

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

function main() {
  const args = parseArgs(process.argv);
  if (args.assert) {
    const result = assertVersionMatchesChannel(args.channel, args.version);
    console.log(`update channel ${result.channel} accepts ${result.version}`);
    return;
  }
  if (args.paths) {
    const channel = assertKnownChannel(args.channel);
    console.log(JSON.stringify({
      channel,
      manifest: distManifestPath(channel),
      archiveDir: distArchiveDir(channel),
      prerelease: isPrereleaseChannel(channel),
      gitAdd: gitAddPaths(channel),
      forbidden: forbiddenGitPaths(channel),
    }));
    return;
  }
  console.error("Usage: node scripts/update-channel.mjs --assert --channel <stable|1.0> --version <x.y.z>");
  console.error("       node scripts/update-channel.mjs --paths --channel <stable|1.0>");
  process.exit(2);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    main();
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}
