#!/usr/bin/env node
// Downloads the iOfficeAI/OfficeCLI binary from GitHub releases, verifies its
// SHA256 against SHA256SUMS, and stages the binary under build/iofficecli/ so
// the Wails build can bundle it as a resource.
//
// VERSION resolution:
//   - "latest" (or empty) → resolved via the GitHub releases API.
//   - "1.0.97" or "v1.0.97" → used verbatim (the leading "v" is stripped).

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..");
const DIST_REPO = process.env.IOFFICECLI_DIST_REPO || "iOfficeAI/OfficeCLI";

const pkg = JSON.parse(readFileSync(path.join(REPO_ROOT, "package.json"), "utf8"));
const REQUESTED_VERSION = process.env.IOFFICECLI_VERSION || pkg.iofficecliVersion;
if (!REQUESTED_VERSION) {
  fail("iofficecliVersion is not set in package.json (and IOFFICECLI_VERSION env is empty).");
}

const TARGET_PLATFORM = process.env.IOFFICECLI_TARGET_PLATFORM || process.platform;
const TARGET_ARCH = process.env.IOFFICECLI_TARGET_ARCH || process.arch;
const FORCE = process.env.IOFFICECLI_FORCE === "1";

const OS_KEY = mapPlatform(TARGET_PLATFORM);
const ARCH_KEY = mapArch(TARGET_ARCH);
const IS_WINDOWS = OS_KEY === "win";
const BINARY_NAME = IS_WINDOWS ? "iofficecli.exe" : "iofficecli";

const STAGE_DIR = path.join(REPO_ROOT, "build", "iofficecli");
const STAGED_BINARY = path.join(STAGE_DIR, BINARY_NAME);
const STAGED_VERSION = path.join(STAGE_DIR, "version.json");

await main();

async function main() {
  const VERSION = await resolveVersion(REQUESTED_VERSION);
  const ASSET_NAME = `officecli-${OS_KEY}-${ARCH_KEY}${IS_WINDOWS ? ".exe" : ""}`;
  const RELEASE_TAG = `v${VERSION}`;
  const RELEASE_BASE = `https://github.com/${DIST_REPO}/releases/download/${RELEASE_TAG}`;
  const ASSET_URL = `${RELEASE_BASE}/${ASSET_NAME}`;
  const CHECKSUMS_URL = `${RELEASE_BASE}/SHA256SUMS`;

  if (!FORCE && (await hasMatchingStage(VERSION))) {
    console.log(`[fetch-iofficecli] already staged: ${VERSION} ${OS_KEY}/${ARCH_KEY} — skipping`);
    return;
  }

  console.log(`[fetch-iofficecli] target ${OS_KEY}/${ARCH_KEY}, version v${VERSION}${REQUESTED_VERSION === "latest" ? ' (resolved from "latest")' : ""}`);
  console.log(`[fetch-iofficecli] asset: ${ASSET_URL}`);

  let expectedSha = null;
  try {
    const checksumsText = await fetchText(CHECKSUMS_URL);
    expectedSha = findChecksum(checksumsText, ASSET_NAME);
    if (!expectedSha) {
      console.warn(`[fetch-iofficecli] WARNING: SHA256SUMS does not contain ${ASSET_NAME}; integrity check skipped`);
    }
  } catch (err) {
    console.warn(`[fetch-iofficecli] WARNING: could not fetch SHA256SUMS (${err.message}); integrity check skipped`);
  }

  await mkdir(STAGE_DIR, { recursive: true });
  await rm(STAGED_BINARY, { force: true });

  await fetchToFile(ASSET_URL, STAGED_BINARY);

  const actualSha = await sha256File(STAGED_BINARY);
  if (expectedSha) {
    if (actualSha !== expectedSha) {
      await rm(STAGED_BINARY, { force: true });
      fail(`SHA256 mismatch for ${ASSET_NAME}\n  expected: ${expectedSha}\n  actual:   ${actualSha}`);
    }
    console.log(`[fetch-iofficecli] sha256 ok (${actualSha.slice(0, 12)}…)`);
  } else {
    console.warn(`[fetch-iofficecli] no expected sha256; downloaded sha256=${actualSha.slice(0, 12)}…`);
  }

  if (!IS_WINDOWS) {
    await chmod(STAGED_BINARY, 0o755);
  }

  const versionRecord = {
    version: VERSION,
    requested: REQUESTED_VERSION,
    platform: OS_KEY,
    arch: ARCH_KEY,
    asset: ASSET_NAME,
    sha256: expectedSha ?? actualSha,
    sha256Verified: Boolean(expectedSha),
    source: DIST_REPO,
    fetchedAt: new Date().toISOString(),
  };
  await writeFile(STAGED_VERSION, `${JSON.stringify(versionRecord, null, 2)}\n`, "utf8");
  console.log(`[fetch-iofficecli] staged ${STAGED_BINARY}`);
}

async function resolveVersion(requested) {
  const trimmed = String(requested ?? "").trim();
  if (trimmed && trimmed.toLowerCase() !== "latest") {
    return trimmed.replace(/^v/, "");
  }
  const apiUrl = `https://api.github.com/repos/${DIST_REPO}/releases/latest`;
  const response = await fetch(apiUrl, {
    headers: {
      accept: "application/vnd.github+json",
      "user-agent": "officedex-fetch-iofficecli",
      ...(process.env.GITHUB_TOKEN ? { authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
    },
  });
  if (!response.ok) {
    fail(`HTTP ${response.status} resolving latest iOfficeAI release from ${apiUrl} — set IOFFICECLI_VERSION or GITHUB_TOKEN to retry`);
  }
  const payload = await response.json();
  const tag = String(payload.tag_name || "").trim();
  if (!tag) {
    fail(`could not parse tag_name from ${apiUrl}`);
  }
  return tag.replace(/^v/, "");
}

async function hasMatchingStage(version) {
  try {
    const text = await readFile(STAGED_VERSION, "utf8");
    const meta = JSON.parse(text);
    return meta.version === version && meta.platform === OS_KEY && meta.arch === ARCH_KEY;
  } catch {
    return false;
  }
}

async function fetchText(url) {
  const response = await followRedirects(url);
  return await response.text();
}

async function fetchToFile(url, dest) {
  const response = await followRedirects(url);
  const buffer = Buffer.from(await response.arrayBuffer());
  await writeFile(dest, buffer);
}

async function followRedirects(url, redirectsLeft = 5) {
  const response = await fetch(url, { redirect: "manual", headers: { "user-agent": "officedex-fetch-iofficecli" } });
  if ([301, 302, 303, 307, 308].includes(response.status)) {
    const next = response.headers.get("location");
    if (!next || redirectsLeft <= 0) {
      fail(`redirect loop or missing Location from ${url}`);
    }
    return followRedirects(new URL(next, url).toString(), redirectsLeft - 1);
  }
  if (!response.ok) {
    fail(`HTTP ${response.status} fetching ${url}`);
  }
  return response;
}

function findChecksum(text, filename) {
  for (const line of text.split(/\r?\n/)) {
    const match = /^([a-f0-9]{64})\s+(\S+)$/i.exec(line.trim());
    if (match && match[2] === filename) return match[1].toLowerCase();
  }
  return null;
}

async function sha256File(filePath) {
  const buffer = await readFile(filePath);
  return createHash("sha256").update(buffer).digest("hex");
}

function mapPlatform(p) {
  switch (p) {
    case "darwin": return "mac";
    case "linux": return "linux";
    case "win32": return "win";
    default: fail(`unsupported platform: ${p}`);
  }
}

function mapArch(a) {
  switch (a) {
    case "x64": return "x64";
    case "arm64": return "arm64";
    default: fail(`unsupported arch: ${a}`);
  }
}

function fail(message) {
  console.error(`[fetch-iofficecli] ${message}`);
  process.exit(1);
}
