import { access, readFile, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

const appPath = process.argv[2];

if (!appPath) {
  console.error("[verify-wails-app] usage: node scripts/verify-wails-app.mjs <path/to/App.app>");
  process.exit(2);
}

try {
  const executableName = await readBundleExecutable(appPath);
  const executablePath = path.join(appPath, "Contents", "MacOS", executableName);
  await access(executablePath, constants.X_OK);
  const executableStat = await stat(executablePath);
  if (!executableStat.isFile()) {
    throw new Error(`bundle executable is not a file: ${executablePath}`);
  }
  console.log(`[verify-wails-app] verified executable: ${executablePath}`);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[verify-wails-app] executable is missing or invalid: ${message}`);
  process.exit(1);
}

async function readBundleExecutable(appPath) {
  const plistPath = path.join(appPath, "Contents", "Info.plist");
  await access(plistPath, constants.R_OK);

  if (process.platform === "darwin") {
    const result = spawnSync("/usr/libexec/PlistBuddy", ["-c", "Print :CFBundleExecutable", plistPath], {
      encoding: "utf8",
    });
    if (result.status === 0) {
      const value = result.stdout.trim();
      if (value) return value;
    }
  }

  const plist = await readFile(plistPath, "utf8");
  const match = plist.match(/<key>CFBundleExecutable<\/key>\s*<string>([^<]+)<\/string>/);
  if (!match?.[1]) {
    throw new Error(`CFBundleExecutable not found in ${plistPath}`);
  }
  return match[1];
}
