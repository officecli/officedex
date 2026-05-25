#!/usr/bin/env node
// Downloads the officecli Go binary from officecli/officecli-dist releases,
// verifies its SHA256 against checksums.txt, extracts the tarball, and stages
// the binary under build/officecli/ so electron-builder can bundle it as an
// extraResource. Idempotent: re-running with the same version is a no-op.
//
// VERSION resolution:
//   - "latest" (or empty) → resolved via the GitHub releases API.
//   - "0.2.98" or "v0.2.98" → used verbatim (the leading "v" is stripped).

import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..");
const DIST_REPO = process.env.OFFICECLI_DIST_REPO || "officecli/officecli-dist";

const pkg = JSON.parse(readFileSync(path.join(REPO_ROOT, "package.json"), "utf8"));
const REQUESTED_VERSION = process.env.OFFICECLI_VERSION || pkg.officecliVersion;
if (!REQUESTED_VERSION) {
  fail("officecliVersion is not set in package.json (and OFFICECLI_VERSION env is empty).");
}

const TARGET_PLATFORM = process.env.OFFICECLI_TARGET_PLATFORM || process.platform;
const TARGET_ARCH = process.env.OFFICECLI_TARGET_ARCH || process.arch;
const FORCE = process.env.OFFICECLI_FORCE === "1";

const OS_KEY = mapPlatform(TARGET_PLATFORM);
const ARCH_KEY = mapArch(TARGET_ARCH);
const IS_WINDOWS = OS_KEY === "windows";
const BINARY_NAME = IS_WINDOWS ? "officecli.exe" : "officecli";

const STAGE_DIR = path.join(REPO_ROOT, "build", "officecli");
const STAGED_BINARY = path.join(STAGE_DIR, BINARY_NAME);
const STAGED_VERSION = path.join(STAGE_DIR, "version.json");

await main();

async function main() {
  const VERSION = await resolveVersion(REQUESTED_VERSION);
  const TARBALL_NAME = `officecli_${VERSION}_${OS_KEY}_${ARCH_KEY}.tar.gz`;
  const RELEASE_BASE = `https://github.com/${DIST_REPO}/releases/download/v${VERSION}`;
  const TARBALL_URL = `${RELEASE_BASE}/${TARBALL_NAME}`;
  const CHECKSUMS_URL = `${RELEASE_BASE}/checksums.txt`;

  if (!FORCE && (await hasMatchingStage(VERSION))) {
    console.log(`[fetch-officecli] already staged: ${VERSION} ${OS_KEY}/${ARCH_KEY} — skipping`);
    return;
  }

  console.log(`[fetch-officecli] target ${OS_KEY}/${ARCH_KEY}, version v${VERSION}${REQUESTED_VERSION === "latest" ? " (resolved from \"latest\")" : ""}`);
  console.log(`[fetch-officecli] tarball: ${TARBALL_URL}`);

  // checksums.txt may be absent in older releases. If we can fetch it AND it
  // contains an entry for our tarball, verification is mandatory. If either
  // step fails we proceed but warn loudly — better to ship than to brick CI on
  // a manifest schema gap.
  let expectedSha = null;
  try {
    const checksumsText = await fetchText(CHECKSUMS_URL);
    expectedSha = findChecksum(checksumsText, TARBALL_NAME);
    if (!expectedSha) {
      console.warn(`[fetch-officecli] WARNING: checksums.txt at ${CHECKSUMS_URL} does not contain ${TARBALL_NAME}; integrity check skipped`);
    }
  } catch (err) {
    console.warn(`[fetch-officecli] WARNING: could not fetch checksums.txt (${err.message}); integrity check skipped`);
  }

  const work = mkdtempSync(path.join(tmpdir(), "officedex-fetch-officecli-"));
  try {
    const tarballPath = path.join(work, TARBALL_NAME);
    await fetchToFile(TARBALL_URL, tarballPath);

    const actualSha = await sha256File(tarballPath);
    if (expectedSha) {
      if (actualSha !== expectedSha) {
        fail(`SHA256 mismatch for ${TARBALL_NAME}\n  expected: ${expectedSha}\n  actual:   ${actualSha}`);
      }
      console.log(`[fetch-officecli] sha256 ok (${actualSha.slice(0, 12)}…)`);
    } else {
      console.warn(`[fetch-officecli] no expected sha256; downloaded sha256=${actualSha.slice(0, 12)}…`);
    }

    const extractDir = path.join(work, "extracted");
    await mkdir(extractDir, { recursive: true });
    runTar(tarballPath, extractDir);

    const extractedBinary = path.join(extractDir, BINARY_NAME);
    await stat(extractedBinary); // ensure tarball contained the binary at the top level

    await mkdir(STAGE_DIR, { recursive: true });
    await rm(STAGED_BINARY, { force: true });
    try {
      await rename(extractedBinary, STAGED_BINARY);
    } catch (err) {
      // EXDEV: rename across volumes is not allowed on Windows (the temp dir
      // lives on C: while the workspace can be on D:). Fall back to a
      // copy + delete which works for any combination of source/target volumes.
      if (err && err.code === "EXDEV") {
        const { copyFile } = await import("node:fs/promises");
        await copyFile(extractedBinary, STAGED_BINARY);
        await rm(extractedBinary, { force: true });
      } else {
        throw err;
      }
    }
    if (!IS_WINDOWS) {
      const { chmod } = await import("node:fs/promises");
      await chmod(STAGED_BINARY, 0o755);
    }

    const versionRecord = {
      version: VERSION,
      requested: REQUESTED_VERSION,
      platform: OS_KEY,
      arch: ARCH_KEY,
      tarball: TARBALL_NAME,
      sha256: expectedSha ?? actualSha,
      sha256Verified: Boolean(expectedSha),
      source: DIST_REPO,
      fetchedAt: new Date().toISOString(),
    };
    await writeFile(STAGED_VERSION, `${JSON.stringify(versionRecord, null, 2)}\n`, "utf8");
    console.log(`[fetch-officecli] staged ${STAGED_BINARY}`);
  } finally {
    await rm(work, { recursive: true, force: true }).catch(() => undefined);
  }
}

// resolveVersion maps the requested version string to a concrete semver
// (without leading "v"). "latest" / "" hit the GitHub releases API; explicit
// versions are returned verbatim (after stripping an optional leading "v").
async function resolveVersion(requested) {
  const trimmed = String(requested ?? "").trim();
  if (trimmed && trimmed.toLowerCase() !== "latest") {
    return trimmed.replace(/^v/, "");
  }
  const apiUrl = `https://api.github.com/repos/${DIST_REPO}/releases/latest`;
  const response = await fetch(apiUrl, {
    headers: {
      "accept": "application/vnd.github+json",
      "user-agent": "officedex-fetch-officecli",
      ...(process.env.GITHUB_TOKEN ? { "authorization": `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
    },
  });
  if (!response.ok) {
    fail(`HTTP ${response.status} resolving latest officecli release from ${apiUrl} — set OFFICECLI_VERSION or GITHUB_TOKEN to retry`);
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
  const response = await fetch(url, { redirect: "manual", headers: { "user-agent": "officedex-fetch-officecli" } });
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

function runTar(tarballPath, dest) {
  const result = spawnSync("tar", ["-xzf", tarballPath, "-C", dest], { stdio: "inherit" });
  if (result.status !== 0) {
    fail(`tar -xzf ${tarballPath} exited with code ${result.status}`);
  }
}

function mapPlatform(p) {
  switch (p) {
    case "darwin": return "darwin";
    case "linux": return "linux";
    case "win32": return "windows";
    default: fail(`unsupported platform: ${p}`);
  }
}

function mapArch(a) {
  switch (a) {
    case "x64": return "amd64";
    case "arm64": return "arm64";
    default: fail(`unsupported arch: ${a}`);
  }
}

function fail(message) {
  console.error(`[fetch-officecli] ${message}`);
  process.exit(1);
}
