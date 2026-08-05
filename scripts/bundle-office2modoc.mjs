import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";
import process from "node:process";
import { access, chmod, copyFile, mkdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

export const OFFICE2MODOC_VERSION = "0.1.34";
export const OFFICE2MODOC_SHA256 = "f4fba6e545adbad11a70fc1b6dc14280f93c4f2a20e18d6f8db0a254df9eb1d9";
export const DEFAULT_OFFICE2MODOC_SOURCE = path.join(
  "build", "cache", "office2modoc", OFFICE2MODOC_VERSION, "darwin-arm64", "liboffice2modoc_ffi.dylib",
);

export async function sha256File(filePath) {
  return createHash("sha256").update(await readFile(filePath)).digest("hex");
}

export async function bundleOffice2modoc({ app, source = DEFAULT_OFFICE2MODOC_SOURCE, identity = "-", sign = true, expectedSha256 = OFFICE2MODOC_SHA256 }) {
  if (!app) throw new Error("--app <path/to/OfficeDex.app> is required");
  await access(source).catch(() => {
    throw new Error(`office2modoc FFI not found at ${source}; stage release ${OFFICE2MODOC_VERSION} before building`);
  });
  const actualSha256 = await sha256File(source);
  if (expectedSha256 && actualSha256 !== expectedSha256) {
    throw new Error(`office2modoc FFI checksum mismatch: got ${actualSha256}, want ${expectedSha256}`);
  }
  const targetDir = path.join(app, "Contents", "Resources", "office2modoc");
  const target = path.join(targetDir, "liboffice2modoc_ffi.dylib");
  await mkdir(targetDir, { recursive: true });
  await copyFile(source, target);
  await chmod(target, 0o755);
  if (sign && process.platform === "darwin") {
    await run("codesign", ["--force", "--sign", identity, "--timestamp=none", "--options", "runtime", target]);
  }
  return { target, sha256: actualSha256 };
}

function parseArgs(argv) {
  const args = { app: "", source: DEFAULT_OFFICE2MODOC_SOURCE, identity: "-" };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--app") args.app = argv[++index];
    else if (argv[index] === "--source") args.source = argv[++index];
    else if (argv[index] === "--identity") args.identity = argv[++index];
  }
  return args;
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`${command} exited with code ${code}`)));
  });
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  bundleOffice2modoc(parseArgs(process.argv.slice(2)))
    .then(({ target, sha256 }) => console.log(`[office2modoc] bundled ${target} (${sha256})`))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
