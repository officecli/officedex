#!/usr/bin/env node
// Copies the officecli Go binary and extrender binary from build/ into the
// Wails-packaged .app bundle's Contents/Resources/ so that the binresolver
// can discover them at runtime (bundled path takes priority).

import { chmod, copyFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..");
const APP_PATH = path.join(REPO_ROOT, "build", "bin", "OfficeDex.app");
const RESOURCES = path.join(APP_PATH, "Contents", "Resources");

const IS_WINDOWS = process.platform === "win32";
const BINARY_NAME = IS_WINDOWS ? "officecli.exe" : "officecli";

async function copy(src, destDir, destName) {
  if (!existsSync(src)) {
    console.warn(`[bundle-runtime] source not found: ${src}`);
    return;
  }
  await mkdir(destDir, { recursive: true });
  const dest = path.join(destDir, destName);
  await copyFile(src, dest);
  if (!IS_WINDOWS) {
    await chmod(dest, 0o755);
  }
  console.log(`[bundle-runtime] ${src} → ${dest}`);
}

async function main() {
  if (!existsSync(APP_PATH)) {
    console.log("[bundle-runtime] no .app found, skipping");
    return;
  }

  // officecli
  const officecliSrc = path.join(REPO_ROOT, "build", "officecli", BINARY_NAME);
  const officecliDest = path.join(RESOURCES, "officecli");
  await copy(officecliSrc, officecliDest, BINARY_NAME);

  // extrender (platform-specific)
  const platformDir = resolveExtrenderPlatformDir();
  const extrenderSrc = path.join(REPO_ROOT, "build", "extrender", platformDir, "extrender");
  const extrenderDest = path.join(RESOURCES, "extrender");
  await copy(extrenderSrc, extrenderDest, "extrender");
}

function resolveExtrenderPlatformDir() {
  const goos = process.platform;
  const goarch = process.arch;
  if (goos === "darwin" && goarch === "arm64") return "mac-arm64";
  if (goos === "win32" && goarch === "x64") return "win-x64";
  return `${goos}-${goarch}`;
}

main().catch((err) => {
  console.error(`[bundle-runtime] error: ${err.message}`);
  process.exit(1);
});
