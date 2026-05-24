#!/usr/bin/env node
// build-manifest.mjs — Generate manifest.json for OfficeDex auto-update.
//
// Usage:
//   node scripts/build-manifest.mjs \
//     --version 0.2.0 \
//     --darwin path/to/OfficeDex-v0.2.0-darwin-universal.zip \
//     --windows path/to/OfficeDex-v0.2.0-windows-amd64.zip \
//     [--min-supported 0.1.0] \
//     [--mandatory] \
//     [--notes "Release notes here..."] \
//     [--base-url https://raw.githubusercontent.com/officecli/officedex-dist/main] \
//     [--out manifest.json]
//
// The output matches the schema parsed by internal/appupdate.ReleaseInfo:
// version, notes, minSupportedVersion, mandatory, publishedAt, assets{platform-arch}.
//
// `--darwin` is treated as `darwin-universal` and also exposed as `darwin-arm64`
// and `darwin-amd64` aliases (universal binary works on both). `--windows` is
// `windows-amd64`. Add more flags here when new platform builds get added.

import { createReadStream, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { basename } from "node:path";

const DEFAULT_BASE_URL = "https://raw.githubusercontent.com/officecli/officedex-dist/main";

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

async function sha256File(path) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(path);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

async function buildAsset(filePath, baseUrl, version) {
  const stat = statSync(filePath);
  const sha = await sha256File(filePath);
  const name = basename(filePath);
  return {
    url: `${baseUrl}/releases/v${version}/${name}`,
    sha256: sha,
    size: stat.size,
  };
}

async function main() {
  const args = parseArgs(process.argv);
  const required = ["version"];
  for (const k of required) {
    if (!args[k]) {
      console.error(`Missing required --${k}`);
      process.exit(2);
    }
  }
  if (!args.darwin && !args.windows) {
    console.error("Need at least one of --darwin / --windows");
    process.exit(2);
  }

  const version = String(args.version).replace(/^v/, "");
  const baseUrl = (args["base-url"] || DEFAULT_BASE_URL).replace(/\/$/, "");
  const minSupported = args["min-supported"] || "";
  const mandatory = Boolean(args.mandatory && args.mandatory !== "false");
  const notes = typeof args.notes === "string" ? args.notes : "";
  const outPath = args.out || "manifest.json";

  const assets = {};
  if (args.darwin) {
    const a = await buildAsset(args.darwin, baseUrl, version);
    // Wails ships a universal binary for darwin; expose it under the canonical
    // platform-arch keys the client probes (runtime.GOOS + GOARCH).
    assets["darwin-arm64"] = a;
    assets["darwin-amd64"] = a;
    assets["darwin-universal"] = a;
  }
  if (args.windows) {
    assets["windows-amd64"] = await buildAsset(args.windows, baseUrl, version);
  }

  const manifest = {
    version,
    notes,
    minSupportedVersion: minSupported,
    mandatory,
    publishedAt: new Date().toISOString(),
    assets,
  };

  await writeFile(outPath, JSON.stringify(manifest, null, 2) + "\n");
  console.log(`Wrote ${outPath} (version=${version}, mandatory=${mandatory}, assets=${Object.keys(assets).join(",")})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
