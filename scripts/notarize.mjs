#!/usr/bin/env node
// Signs, notarizes, and staples a macOS .app or .dmg for distribution outside
// the App Store. Two credential modes:
//   - Local: notarytool keychain profile (default: OfficeDex-Notarize).
//   - CI: App Store Connect API key via NOTARIZE_API_KEY_PATH/ID/ISSUER.
// API-key mode auto-activates when all three env vars are set.
//
// Usage:
//   node scripts/notarize.mjs <path/to/App.app | App.dmg>
//
// Environment overrides:
//   CODESIGN_IDENTITY        — signing identity (default: team cert below)
//   NOTARIZE_PROFILE         — keychain profile name (local mode)
//   NOTARIZE_API_KEY_PATH    — path to .p8 file (CI mode)
//   NOTARIZE_API_KEY_ID      — App Store Connect key id (CI mode)
//   NOTARIZE_API_ISSUER      — App Store Connect issuer uuid (CI mode)
//   SKIP_NOTARIZE=1          — sign only, skip notarization + staple

import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";

const IDENTITY =
  process.env.CODESIGN_IDENTITY ||
  "Developer ID Application: ChuXin Tec Co., Ltd. (Z35T9799TW)";
const PROFILE = process.env.NOTARIZE_PROFILE || "OfficeDex-Notarize";
const API_KEY_PATH = process.env.NOTARIZE_API_KEY_PATH || "";
const API_KEY_ID = process.env.NOTARIZE_API_KEY_ID || "";
const API_ISSUER = process.env.NOTARIZE_API_ISSUER || "";
const USE_API_KEY = API_KEY_PATH && API_KEY_ID && API_ISSUER;
const SKIP_NOTARIZE = process.env.SKIP_NOTARIZE === "1";

function notarytoolCredArgs() {
  return USE_API_KEY
    ? ["--key", API_KEY_PATH, "--key-id", API_KEY_ID, "--issuer", API_ISSUER]
    : ["--keychain-profile", PROFILE];
}

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
  const targetPath = process.argv[2];
  if (!targetPath || !(targetPath.endsWith(".app") || targetPath.endsWith(".dmg"))) {
    console.error("Usage: node scripts/notarize.mjs <path/to/App.app | App.dmg>");
    process.exit(2);
  }
  const isDmg = targetPath.endsWith(".dmg");

  if (process.platform !== "darwin") {
    console.log("[notarize] not on macOS, skipping");
    return;
  }

  if (isDmg) {
    // --- DMG path: sign the dmg, notarize, staple ---
    console.log("\n=== DMG Signing ===");
    run("codesign", [
      "--force",
      "--sign", IDENTITY,
      "--timestamp",
      targetPath,
    ]);
  } else {
    // --- App path: sign all Mach-O binaries inside-out, then the app bundle ---
    console.log("\n=== Code Signing ===");
    const binaries = findMachOBinaries(targetPath);
    const mainExe = binaries.find((b) => b.includes("/MacOS/"));
    const innerBinaries = binaries.filter((b) => !b.includes("/MacOS/"));

    for (const bin of innerBinaries) {
      signBinary(bin);
    }
    if (mainExe) {
      signBinary(mainExe);
    }

    console.log(`[sign] ${targetPath}`);
    run("codesign", [
      "--force",
      "--sign", IDENTITY,
      "--options", "runtime",
      "--timestamp",
      targetPath,
    ]);

    console.log("[sign] verifying...");
    run("codesign", ["--verify", "--strict", targetPath]);
    console.log("[sign] OK\n");
  }

  if (SKIP_NOTARIZE) {
    console.log("[notarize] SKIP_NOTARIZE=1, skipping notarization");
    return;
  }

  // --- Notarization submission ---
  console.log("=== Notarization ===");
  console.log(
    USE_API_KEY
      ? `[notarize] using App Store Connect API key id=${API_KEY_ID}`
      : `[notarize] using keychain profile ${PROFILE}`
  );

  let submitTarget = targetPath;
  let tmpDir = null;
  if (!isDmg) {
    // .app must be zipped before submission; .dmg is submitted directly.
    tmpDir = mkdtempSync(path.join(tmpdir(), "notarize-"));
    submitTarget = path.join(tmpDir, "app.zip");
    console.log("[notarize] creating zip...");
    run("ditto", ["-c", "-k", "--keepParent", targetPath, submitTarget]);
  }

  console.log("[notarize] submitting to Apple...");
  run("xcrun", [
    "notarytool", "submit", submitTarget,
    ...notarytoolCredArgs(),
    "--wait",
  ]);

  console.log("\n=== Stapling ===");
  run("xcrun", ["stapler", "staple", targetPath]);

  // --- Final verification ---
  console.log("\n=== Verification ===");
  const spctlArgs = isDmg
    ? ["--assess", "--type", "open", "--context", "context:primary-signature", "--verbose", targetPath]
    : ["--assess", "--type", "execute", "--verbose", targetPath];
  const spctlResult = spawnSync("spctl", spctlArgs, { encoding: "utf8" });
  const output = (spctlResult.stdout || "") + (spctlResult.stderr || "");
  console.log(output.trim());

  if (output.includes("accepted")) {
    console.log("\n[notarize] Done — target is signed, notarized, and stapled.");
  } else {
    console.error("\n[notarize] WARNING: Gatekeeper did not accept the target.");
    process.exit(1);
  }
}

main();
