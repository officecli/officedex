#!/usr/bin/env node
// Stages the runtime payloads Wails does not place itself -- the officecli and
// word2mow binaries, the MOP Node runtime, the presentation SSR source root and
// Writer's default-font closure -- into the packaged application.
//
// The two platforms have different bundle shapes, and the Go side already knows
// both (see findBundledBinaryPath in app_bridge_lifecycle.go and
// writerResourceCandidates in app_writer.go):
//
//   macOS:   build/bin/OfficeDex.app/Contents/Resources/<resource>
//   Windows: build/bin/<resource>, sitting beside officedex.exe
//
// Everything below is expressed once against a resolved destination root so the
// two layouts cannot drift apart.

import { chmod, copyFile, cp, mkdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..");
const BIN = path.join(REPO_ROOT, "build", "bin");
const APP_PATH = path.join(BIN, "OfficeDex.app");

const IS_WINDOWS = process.platform === "win32";
const BINARY_NAME = IS_WINDOWS ? "officecli.exe" : "officecli";
const CONVERT_BINARY_NAME = IS_WINDOWS ? "convert.exe" : "convert";

/**
 * Where staged resources go, and whether there is a package to stage into.
 *
 * The .app is checked first on every platform: a cross-compiled Windows build
 * produced on a Mac still leaves the host's .app in build/bin, and picking the
 * loose-file layout there would scatter resources beside it.
 */
export function resolveBundleTarget({
  platform = process.platform,
  bin = BIN,
  exists = existsSync,
} = {}) {
  const app = path.join(bin, "OfficeDex.app");
  if (exists(app)) {
    return { kind: "macos-app", root: path.join(app, "Contents", "Resources"), package: app };
  }
  // Windows keeps resources beside officedex.exe; `Archive (Windows)` zips
  // build\bin\* wholesale, so anything written here ships.
  const executable = path.join(bin, platform === "win32" ? "officedex.exe" : "officedex");
  if (exists(executable)) {
    return { kind: "windows-dir", root: bin, package: executable };
  }
  return null;
}

// The desktop ships one PPT authoring Skill and the separate video workflow.
// Never copy the CLI's whole skills directory: it contains retired PPT authors.
export async function stageDesktopSkills(resources, source = path.join(REPO_ROOT, "skills")) {
  for (const name of ["aippt-jssdk-design/policy.json", "aippt-jssdk-design/registry.json", "aippt-jssdk-design/snapshot.json", "aippt-jssdk-video/SKILL.md", "aippt-jssdk-animation/SKILL.md", "aippt-jssdk-animation/registry.json", "aippt-jssdk-animation/snapshot.json", "aippt-jssdk-animation/scripts/validate-animation.mjs"]) {
    if (!existsSync(path.join(source, name))) throw new Error(`OfficeDex Skill is missing: ${name}`);
  }
  const destination = path.join(resources, "skills");
  await rm(destination, { recursive: true, force: true });
  for (const name of ["aippt-jssdk-design", "aippt-jssdk-video", "aippt-jssdk-animation"]) {
    await mkdir(destination, { recursive: true });
    await cp(path.join(source, name), path.join(destination, name), { recursive: true });
  }
}

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

async function copyTreeRequired(src, dest, label) {
  if (!existsSync(src)) {
    throw new Error(`${label} not found: ${src}`);
  }
  await rm(dest, { recursive: true, force: true });
  await mkdir(path.dirname(dest), { recursive: true });
  await cp(src, dest, { recursive: true, force: true, dereference: true });
  console.log(`[bundle-runtime] ${src} → ${dest}`);
}

async function main() {
  const target = resolveBundleTarget();
  if (target === null) {
    console.log("[bundle-runtime] no packaged application found in build/bin, skipping");
    return;
  }
  const resources = target.root;
  console.log(`[bundle-runtime] staging into ${resources} (${target.kind})`);

  // AI generation Skills used by the desktop Planner. Keep these as readable
  // resources so the packaged client and OfficeCLI can discover the same
  // authoring rules as the development checkout.
  await stageDesktopSkills(resources);

  // officecli
  const officecliSrc = path.join(REPO_ROOT, "build", "officecli", BINARY_NAME);
  await copy(officecliSrc, path.join(resources, "officecli"), BINARY_NAME);

  // MOP authoring uses both an embedded Node runtime and a Vite SSR source
  // root. Fail packaging when either is absent, otherwise generation would
  // work only on a developer machine that happens to have the source checkout.
  await copyTreeRequired(
    path.join(REPO_ROOT, "build", "mop-runtime"),
    path.join(resources, "mop-runtime"),
    "MOP runtime",
  );
  await copyTreeRequired(
    path.join(REPO_ROOT, "build", "presentation"),
    path.join(resources, "presentation"),
    "MOP presentation runtime",
  );

  // Writer's default-font closure. It stays out of dist/ (and therefore out of
  // `//go:embed all:dist`); internal/writerfonts serves it from here.
  await copyTreeRequired(
    path.join(REPO_ROOT, "build", "writer-fonts"),
    path.join(resources, "writer-fonts"),
    "Writer default-font closure",
  );

  // word2mow's DOCX <-> MOW converter, driven by internal/word2mowhttp.
  const convertSrc = path.join(REPO_ROOT, "build", "writer-convert", CONVERT_BINARY_NAME);
  if (!existsSync(convertSrc)) {
    throw new Error(`word2mow convert binary not found: ${convertSrc}`);
  }
  await copy(convertSrc, path.join(resources, "word2mow"), CONVERT_BINARY_NAME);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((err) => {
    console.error(`[bundle-runtime] error: ${err.message}`);
    process.exit(1);
  });
}
