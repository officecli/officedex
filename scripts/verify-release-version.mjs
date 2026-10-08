import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

function plistValue(plist, key) {
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = plist.match(new RegExp(`<key>\\s*${escapedKey}\\s*</key>\\s*<string>([^<]+)</string>`));
  return match?.[1]?.trim();
}

export async function verifyReleaseVersion({ expected, packagePath, wailsPath, appPath, tag }) {
  if (!expected || !packagePath || !wailsPath) {
    throw new Error("expected, packagePath, and wailsPath are required");
  }
  const packageJson = JSON.parse(await readFile(packagePath, "utf8"));
  const wailsJson = JSON.parse(await readFile(wailsPath, "utf8"));
  const carriers = [
    ["package.json version", packageJson.version],
    ["wails.json info.productVersion", wailsJson.info?.productVersion],
  ];

  if (tag) carriers.push(["release tag", tag]);
  if (appPath) {
    const plist = await readFile(path.join(appPath, "Contents", "Info.plist"), "utf8");
    carriers.push(["CFBundleShortVersionString", plistValue(plist, "CFBundleShortVersionString")]);
    carriers.push(["CFBundleVersion", plistValue(plist, "CFBundleVersion")]);
  }

  const mismatches = carriers.filter(([name, value]) => {
    const normalized = name === "release tag" && typeof value === "string" ? value.replace(/^v/, "") : value;
    return normalized !== expected;
  });
  if (mismatches.length > 0) {
    throw new Error(`Release version mismatch; expected ${expected}: ${mismatches.map(([name, value]) => `${name}=${value ?? "<missing>"}`).join(", ")}`);
  }
  return { expected, carriers: Object.fromEntries(carriers) };
}

function parseArgs(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || !value) throw new Error(`Invalid argument near ${key ?? "<end>"}`);
    values.set(key.slice(2), value);
  }
  return {
    expected: values.get("expected"),
    packagePath: values.get("package"),
    wailsPath: values.get("wails"),
    appPath: values.get("app"),
    tag: values.get("tag"),
  };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  verifyReleaseVersion(parseArgs(process.argv.slice(2)))
    .then(({ expected }) => console.log(`Verified OfficeDex release version ${expected}.`))
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
