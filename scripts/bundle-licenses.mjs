import { cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export async function bundleLicenses({ rootDir, target }) {
  if (!rootDir || !target) throw new Error("rootDir and target are required");
  const destination = target.endsWith(".app")
    ? path.join(target, "Contents", "Resources", "licenses")
    : path.join(target, "licenses");

  await rm(destination, { force: true, recursive: true });
  await mkdir(destination, { recursive: true });

  const files = [
    ["LICENSE", "OfficeDex-GPL-3.0.txt"],
    ["NOTICE", "OfficeDex-NOTICE.txt"],
    ["THIRD_PARTY_NOTICES.md", "THIRD_PARTY_NOTICES.md"],
    [path.join("third_party", "officecli", "LICENSE"), "OfficeCLI-MIT.txt"],
  ];
  for (const [source, name] of files) {
    await cp(path.join(rootDir, source), path.join(destination, name));
  }

  return destination;
}

function parseTarget(argv) {
  const index = argv.indexOf("--target");
  if (index === -1 || !argv[index + 1]) throw new Error("Usage: bundle-licenses.mjs --target <path>");
  return argv[index + 1];
}

const scriptPath = fileURLToPath(import.meta.url);
const isMain = process.argv[1] && path.resolve(process.argv[1]) === scriptPath;
if (isMain) {
  const rootDir = path.resolve(path.dirname(scriptPath), "..");
  bundleLicenses({ rootDir, target: path.resolve(parseTarget(process.argv.slice(2))) })
    .then((destination) => console.log(`Bundled release licenses into ${destination}`))
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
