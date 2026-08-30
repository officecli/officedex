import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";
import process from "node:process";
import { access, chmod, copyFile, mkdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

export const OFFICE2MODOC_VERSION = "0.1.34";
export const DEFAULT_OFFICE2MODOC_SOURCE = path.join(
  "build", "cache", "office2modoc", OFFICE2MODOC_VERSION, "darwin-universal", "liboffice2modoc_ffi.dylib",
);

export async function sha256File(filePath) {
  return createHash("sha256").update(await readFile(filePath)).digest("hex");
}

/** Bundle the Windows DLL next to the executable in <app>/office2modoc/. */
export async function bundleWindowsOffice2modoc({ app, source, expectedSha256 = "", validatePE = true }) {
  if (!app) throw new Error("--app <path/to/OfficeDex> is required");
  if (!source) throw new Error("--source <path/to/office2modoc_ffi.dll> is required");
  await access(source).catch(() => { throw new Error(`office2modoc FFI not found at ${source}`); });
  const bytes = await readFile(source);
  if (validatePE && (bytes.length < 2 || bytes[0] !== 0x4d || bytes[1] !== 0x5a)) {
    throw new Error(`office2modoc Windows FFI is not a PE DLL: ${source}`);
  }
  const actualSha256 = createHash("sha256").update(bytes).digest("hex");
  if (expectedSha256 && actualSha256 !== expectedSha256) {
    throw new Error(`office2modoc FFI checksum mismatch: got ${actualSha256}, want ${expectedSha256}`);
  }
  const targetDir = path.join(app, "office2modoc");
  const target = path.join(targetDir, "office2modoc_ffi.dll");
  await mkdir(targetDir, { recursive: true });
  await copyFile(source, target);
  return { target, sha256: actualSha256 };
}

export async function bundleOffice2modoc({ app, source = DEFAULT_OFFICE2MODOC_SOURCE, identity = "-", sign = true, expectedSha256 = "", validateUniversal = process.platform === "darwin" }) {
  if (!app) throw new Error("--app <path/to/OfficeDex.app> is required");
  await access(source).catch(() => {
    throw new Error(`office2modoc FFI not found at ${source}; stage release ${OFFICE2MODOC_VERSION} before building`);
  });
  const actualSha256 = await sha256File(source);
  if (expectedSha256 && actualSha256 !== expectedSha256) {
    throw new Error(`office2modoc FFI checksum mismatch: got ${actualSha256}, want ${expectedSha256}`);
  }
  if (validateUniversal) {
    const archs = await output("lipo", ["-archs", source]);
    for (const required of ["arm64", "x86_64"]) {
      if (!archs.split(/\s+/).includes(required)) throw new Error(`office2modoc macOS FFI is not universal2: ${archs.trim()}`);
    }
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
  const args = { app: "", source: DEFAULT_OFFICE2MODOC_SOURCE, identity: "-", expectedSha256: "", platform: process.platform === "win32" ? "windows" : "macos" };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--app") args.app = argv[++index];
    else if (argv[index] === "--source") args.source = argv[++index];
    else if (argv[index] === "--identity") args.identity = argv[++index];
    else if (argv[index] === "--expected-sha256") args.expectedSha256 = argv[++index];
    else if (argv[index] === "--platform") args.platform = argv[++index];
  }
  return args;
}

function output(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "inherit"] });
    let stdout = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve(stdout.trim()) : reject(new Error(`${command} exited with code ${code}`)));
  });
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
  const args = parseArgs(process.argv.slice(2));
  const operation = args.platform === "windows"
    ? bundleWindowsOffice2modoc(args)
    : bundleOffice2modoc(args);
  operation
    .then(({ target, sha256 }) => console.log(`[office2modoc] bundled ${target} (${sha256})`))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
