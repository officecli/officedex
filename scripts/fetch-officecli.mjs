#!/usr/bin/env node
// Downloads the officecli Go binary from officecli/officecli-dist releases,
// verifies its SHA256 against checksums.txt, extracts the tarball, and stages
// the binary under build/officecli/ so the packaging scripts can bundle it.
// Idempotent: re-running with the same version/target is a no-op.
//
// On macOS the staged binary is a universal2 (x86_64 + arm64) Mach-O built by
// fetching both per-arch tarballs and merging them with `lipo`. This is
// required because the release builds a `darwin/universal` .app: an arch-
// specific officecli would crash on the other architecture with
// "bad CPU type in executable". Set OFFICECLI_TARGET_ARCH to force a single
// slice (escape hatch for dev/iteration); Windows and Linux are always single
// slice.
//
// VERSION resolution:
//   - "latest" (or empty) → resolved via the GitHub releases API.
//   - "0.2.98" or "v0.2.98" → used verbatim (the leading "v" is stripped).

import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { chmod, copyFile, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
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
const ARCH_OVERRIDE = (process.env.OFFICECLI_TARGET_ARCH || "").trim();
const FORCE = process.env.OFFICECLI_FORCE === "1";

const OS_KEY = mapPlatform(TARGET_PLATFORM);
const IS_WINDOWS = OS_KEY === "windows";
const BINARY_NAME = IS_WINDOWS ? "officecli.exe" : "officecli";

// macOS ships a universal2 binary so the darwin/universal .app runs on both
// Intel and Apple Silicon. An explicit arch override forces a single slice.
const UNIVERSAL = OS_KEY === "darwin" && ARCH_OVERRIDE === "";
const ARCH_KEYS = UNIVERSAL ? ["amd64", "arm64"] : [mapArch(ARCH_OVERRIDE || process.arch)];
const STAGE_ARCH = UNIVERSAL ? "universal" : ARCH_KEYS[0];

const STAGE_DIR = path.join(REPO_ROOT, "build", "officecli");
const STAGED_BINARY = path.join(STAGE_DIR, BINARY_NAME);
const STAGED_VERSION = path.join(STAGE_DIR, "version.json");

await main();

async function main() {
  const VERSION = await resolveVersion(REQUESTED_VERSION);

  if (!FORCE && (await hasMatchingStage(VERSION))) {
    console.log(`[fetch-officecli] already staged: ${VERSION} ${OS_KEY}/${STAGE_ARCH} — skipping`);
    return;
  }

  const RELEASE_BASE = `https://github.com/${DIST_REPO}/releases/download/v${VERSION}`;
  const CHECKSUMS_URL = `${RELEASE_BASE}/checksums.txt`;

  console.log(
    `[fetch-officecli] target ${OS_KEY}/${STAGE_ARCH}, version v${VERSION}` +
      `${REQUESTED_VERSION === "latest" ? ' (resolved from "latest")' : ""}`,
  );

  // checksums.txt may be absent in older releases. If we can fetch it AND it
  // contains an entry for a tarball, verification is mandatory for that
  // tarball. If either step fails we proceed but warn loudly — better to ship
  // than to brick CI on a manifest schema gap.
  let checksumsText = null;
  try {
    checksumsText = await fetchText(CHECKSUMS_URL);
  } catch (err) {
    console.warn(`[fetch-officecli] WARNING: could not fetch checksums.txt (${err.message}); integrity check skipped`);
  }

  const work = mkdtempSync(path.join(tmpdir(), "officedex-fetch-officecli-"));
  try {
    const slices = [];
    for (const archKey of ARCH_KEYS) {
      slices.push(await fetchArchBinary(VERSION, RELEASE_BASE, archKey, checksumsText, work));
    }

    await mkdir(STAGE_DIR, { recursive: true });

    // Build the binary at a temp path inside STAGE_DIR, then atomically rename
    // over the staged binary on success. This way a lipo/move failure leaves
    // any previously staged binary intact instead of deleting it up front.
    const tmpBinary = `${STAGED_BINARY}.tmp`;
    await rm(tmpBinary, { force: true });

    if (slices.length === 1) {
      await moveInto(slices[0].binaryPath, tmpBinary);
    } else {
      lipoCreate(slices.map((s) => s.binaryPath), tmpBinary);
      assertUniversal(tmpBinary);
    }

    if (!IS_WINDOWS) {
      await chmod(tmpBinary, 0o755);
    }
    await rename(tmpBinary, STAGED_BINARY);

    const versionRecord = {
      version: VERSION,
      requested: REQUESTED_VERSION,
      platform: OS_KEY,
      arch: STAGE_ARCH,
      source: DIST_REPO,
      fetchedAt: new Date().toISOString(),
    };
    if (slices.length === 1) {
      versionRecord.tarball = slices[0].tarball;
      versionRecord.sha256 = slices[0].sha256;
      versionRecord.sha256Verified = slices[0].verified;
    } else {
      versionRecord.slices = Object.fromEntries(
        slices.map((s) => [s.arch, { tarball: s.tarball, sha256: s.sha256, sha256Verified: s.verified }]),
      );
    }
    await writeFile(STAGED_VERSION, `${JSON.stringify(versionRecord, null, 2)}\n`, "utf8");
    console.log(`[fetch-officecli] staged ${STAGED_BINARY} (${STAGE_ARCH})`);
  } finally {
    await rm(work, { recursive: true, force: true }).catch(() => undefined);
  }
}

// fetchArchBinary downloads one per-arch tarball, verifies its sha256 (when an
// expected value is available), extracts it, and returns the path to the
// extracted binary plus integrity metadata.
async function fetchArchBinary(version, releaseBase, archKey, checksumsText, work) {
  const tarballName = `officecli_${version}_${OS_KEY}_${archKey}.tar.gz`;
  const tarballUrl = `${releaseBase}/${tarballName}`;
  console.log(`[fetch-officecli] tarball: ${tarballUrl}`);

  let expectedSha = null;
  if (checksumsText) {
    expectedSha = findChecksum(checksumsText, tarballName);
    if (!expectedSha) {
      console.warn(`[fetch-officecli] WARNING: checksums.txt does not contain ${tarballName}; integrity check skipped`);
    }
  }

  const tarballPath = path.join(work, tarballName);
  await fetchToFile(tarballUrl, tarballPath);

  const actualSha = await sha256File(tarballPath);
  if (expectedSha) {
    if (actualSha !== expectedSha) {
      fail(`SHA256 mismatch for ${tarballName}\n  expected: ${expectedSha}\n  actual:   ${actualSha}`);
    }
    console.log(`[fetch-officecli] sha256 ok (${actualSha.slice(0, 12)}…) for ${archKey}`);
  } else {
    console.warn(`[fetch-officecli] no expected sha256 for ${archKey}; downloaded sha256=${actualSha.slice(0, 12)}…`);
  }

  const extractDir = path.join(work, `extracted-${archKey}`);
  await mkdir(extractDir, { recursive: true });
  runTar(tarballPath, extractDir);

  const extractedBinary = path.join(extractDir, BINARY_NAME);
  await stat(extractedBinary); // ensure tarball contained the binary at the top level

  return {
    arch: archKey,
    binaryPath: extractedBinary,
    tarball: tarballName,
    sha256: expectedSha ?? actualSha,
    verified: Boolean(expectedSha),
  };
}

// moveInto renames a file, falling back to copy+delete across volumes (EXDEV),
// which Windows hits when the temp dir is on C: and the workspace on D:.
async function moveInto(src, dest) {
  try {
    await rename(src, dest);
  } catch (err) {
    if (err && err.code === "EXDEV") {
      await copyFile(src, dest);
      await rm(src, { force: true });
    } else {
      throw err;
    }
  }
}

// lipoCreate merges per-arch Mach-O binaries into a single universal2 binary.
function lipoCreate(inputs, output) {
  const result = spawnSync("lipo", ["-create", ...inputs, "-output", output], { stdio: "inherit" });
  if (result.error) {
    fail(`lipo failed to run (${result.error.message}); is the Xcode command line tools installed?`);
  }
  if (result.status !== 0) {
    fail(`lipo -create exited with code ${result.status}`);
  }
}

// assertUniversal fails the build unless the staged binary carries both the
// x86_64 and arm64 slices — the exact invariant that prevents Intel users from
// hitting "bad CPU type in executable".
function assertUniversal(binary) {
  const result = spawnSync("lipo", ["-archs", binary], { encoding: "utf8" });
  if (result.status !== 0) {
    fail(`lipo -archs ${binary} exited with code ${result.status}`);
  }
  const archs = String(result.stdout || "").trim().split(/\s+/);
  for (const required of ["x86_64", "arm64"]) {
    if (!archs.includes(required)) {
      fail(`staged universal officecli is missing the ${required} slice (got: ${archs.join(", ")})`);
    }
  }
  console.log(`[fetch-officecli] universal2 verified: ${archs.join(", ")}`);
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
    return meta.version === version && meta.platform === OS_KEY && meta.arch === STAGE_ARCH;
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
    case "amd64": return "amd64";
    case "arm64": return "arm64";
    default: fail(`unsupported arch: ${a}`);
  }
}

function fail(message) {
  console.error(`[fetch-officecli] ${message}`);
  process.exit(1);
}
