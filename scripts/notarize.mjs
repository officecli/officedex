#!/usr/bin/env node
// Signs, notarizes, and staples a macOS .app bundle for distribution outside
// the App Store. Expects a Developer ID Application certificate in the
// Keychain and notarytool credentials stored under a keychain profile.
//
// Usage:
//   node scripts/notarize.mjs <path/to/App.app>
//
// Environment overrides:
//   CODESIGN_IDENTITY  — signing identity (default: team cert below)
//   NOTARIZE_PROFILE   — notarytool keychain profile (default: OfficeDex-Notarize)
//   SKIP_NOTARIZE=1    — sign only, skip notarization + staple

import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";

const IDENTITY =
  process.env.CODESIGN_IDENTITY ||
  "Developer ID Application: ChuXin Tec Co., Ltd. (Z35T9799TW)";
const PROFILE = process.env.NOTARIZE_PROFILE || "OfficeDex-Notarize";
const SKIP_NOTARIZE = process.env.SKIP_NOTARIZE === "1";

function run(cmd, args, opts) {
  console.log(`  > ${cmd} ${args.join(" ")}`);
  return execFileSync(cmd, args, { stdio: "inherit", ...opts });
}

function runCapture(cmd, args) {
  return execFileSync(cmd, args, { encoding: "utf8" }).trim();
}

function findMachOBinaries(appPath) {
  const output = runCapture("find", [appPath, "-type", "f", "-perm", "+111"]);
  if (!output) return [];
  const candidates = output.split("\n").filter(Boolean);
  const binaries = [];
  for (const f of candidates) {
    try {
      const info = runCapture("file", [f]);
      if (info.includes("Mach-O")) binaries.push(f);
    } catch {
      // skip non-binary executables
    }
  }
  return binaries;
}

function signBinary(filePath) {
  console.log(`[sign] ${path.relative(process.cwd(), filePath)}`);
  run("codesign", [
    "--force",
    "--sign", IDENTITY,
    "--options", "runtime",
    "--timestamp",
    filePath,
  ]);
}

function main() {
  const appPath = process.argv[2];
  if (!appPath || !appPath.endsWith(".app")) {
    console.error("Usage: node scripts/notarize.mjs <path/to/App.app>");
    process.exit(2);
  }

  if (process.platform !== "darwin") {
    console.log("[notarize] not on macOS, skipping");
    return;
  }

  // --- Step 1: Sign all Mach-O binaries inside-out ---
  console.log("\n=== Code Signing ===");
  const binaries = findMachOBinaries(appPath);
  const mainExe = binaries.find((b) => b.includes("/MacOS/"));
  const innerBinaries = binaries.filter((b) => !b.includes("/MacOS/"));

  for (const bin of innerBinaries) {
    signBinary(bin);
  }
  if (mainExe) {
    signBinary(mainExe);
  }

  console.log(`[sign] ${appPath}`);
  run("codesign", [
    "--force",
    "--sign", IDENTITY,
    "--options", "runtime",
    "--timestamp",
    appPath,
  ]);

  console.log("[sign] verifying...");
  run("codesign", ["--verify", "--strict", appPath]);
  console.log("[sign] OK\n");

  if (SKIP_NOTARIZE) {
    console.log("[notarize] SKIP_NOTARIZE=1, skipping notarization");
    return;
  }

  // --- Step 2: Zip for notarization ---
  console.log("=== Notarization ===");
  const tmpDir = mkdtempSync(path.join(tmpdir(), "notarize-"));
  const zipPath = path.join(tmpDir, "app.zip");

  console.log("[notarize] creating zip...");
  run("ditto", ["-c", "-k", "--keepParent", appPath, zipPath]);

  // --- Step 3: Submit ---
  console.log("[notarize] submitting to Apple...");
  run("xcrun", [
    "notarytool", "submit", zipPath,
    "--keychain-profile", PROFILE,
    "--wait",
  ]);

  // --- Step 4: Staple ---
  console.log("\n=== Stapling ===");
  run("xcrun", ["stapler", "staple", appPath]);

  // --- Step 5: Final verification ---
  // spctl writes assessment to stderr; use spawnSync to capture it
  console.log("\n=== Verification ===");
  const spctlResult = spawnSync("spctl", [
    "--assess", "--type", "execute", "--verbose", appPath,
  ], { encoding: "utf8" });
  const output = (spctlResult.stdout || "") + (spctlResult.stderr || "");
  console.log(output.trim());

  if (output.includes("accepted")) {
    console.log("\n[notarize] Done — app is signed, notarized, and stapled.");
  } else {
    console.error("\n[notarize] WARNING: Gatekeeper did not accept the app.");
    process.exit(1);
  }
}

main();
