// Re-signs the bundled officecli binary inside a Wails-packaged .app so macOS
// notarization and Gatekeeper accept it. The Go binary ships unsigned from
// officecli-dist, and any executable inside an .app must carry a signature
// matching the outer app's identity (or be ad-hoc signed if the outer app is
// itself ad-hoc).
//
// Usage:
//   node scripts/codesign-bundled-officecli.mjs --app build/bin/OfficeDex.app [--identity "Developer ID Application: ..."]
//
// Identity defaults to "-" (ad-hoc) which matches what `wails build` self-signs
// the outer app with when no signing identity is configured.

import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { access, copyFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";


function parseArgs(argv) {
  const out = { app: "", identity: "-", entitlements: null, sourceBinary: "", binaryName: "officecli" };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--app") out.app = argv[++i];
    else if (arg === "--identity") out.identity = argv[++i];
    else if (arg === "--entitlements") out.entitlements = argv[++i];
    else if (arg === "--source") out.sourceBinary = argv[++i];
    else if (arg === "--binary-name") out.binaryName = argv[++i];
  }
  return out;
}

export function buildCodesignTargets({ app, binaryName = "officecli" }) {
  return [
    path.join(app, "Contents", "Resources", "officecli", binaryName),
    app,
  ];
}

export function buildNotarizationSigningPlan({
  app,
  binaries,
  defaultEntitlements = null,
}) {
  const macOSDir = path.join(app, "Contents", "MacOS");
  const mainExecutable = binaries.find((target) => target.startsWith(`${macOSDir}${path.sep}`));
  const innerBinaries = binaries.filter((target) => target !== mainExecutable);
  const executablePlan = [...innerBinaries, ...(mainExecutable ? [mainExecutable] : [])].map((target) => ({
    target,
    entitlements: defaultEntitlements,
    bundle: false,
  }));
  return [
    ...executablePlan,
    { target: app, entitlements: defaultEntitlements, refreshRuntimeManifest: false, bundle: true },
  ];
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (process.platform !== "darwin") {
    console.log("[codesign] not on darwin, skipping");
    return;
  }
  if (!args.app) {
    console.error("[codesign] --app <path/to/X.app> is required");
    process.exit(2);
  }

  const resourcesDir = path.join(args.app, "Contents", "Resources", "officecli");
  const targetBinary = path.join(resourcesDir, args.binaryName);

  // Wails does not copy extra resources automatically; stage the bundled
  // officecli into Resources/officecli/ if a source path was provided.
  if (args.sourceBinary) {
    try {
      await access(args.sourceBinary);
    } catch {
      console.error(`[codesign] source binary not found at ${args.sourceBinary}`);
      process.exit(2);
    }
    await mkdir(resourcesDir, { recursive: true });
    await copyFile(args.sourceBinary, targetBinary);
    console.log(`[codesign] staged ${args.sourceBinary} -> ${targetBinary}`);
  }

  const [, officecliBinary] = buildCodesignTargets({ app: args.app, binaryName: args.binaryName });
  for (const target of [officecliBinary]) {
    try {
      await access(target);
    } catch {
      throw new Error(`[codesign] required bundled executable not found at ${target}`);
    }
    const targetEntitlements = args.entitlements;
    const codesignArgs = ["--force", "--sign", args.identity, "--timestamp=none", "--options", "runtime"];
    if (targetEntitlements) {
      await access(targetEntitlements);
      codesignArgs.push("--entitlements", targetEntitlements);
    }
    codesignArgs.push(target);
    console.log(`[codesign] ${args.identity === "-" ? "(ad-hoc) " : ""}${target}`);
    await run("codesign", codesignArgs);
  }

  // Embedding a new file under Resources/ invalidates the outer .app seal that
  // Wails wrote during self-signing, so re-sign the bundle itself once the
  // inner binary is signed. --deep is intentionally omitted because the inner
  // executables already carry their own signatures.
  const outerArgs = ["--force", "--sign", args.identity, "--options", "runtime"];
  if (args.entitlements) {
    outerArgs.push("--entitlements", args.entitlements);
  }
  outerArgs.push(args.app);
  console.log(`[codesign] re-sealing outer ${args.app}`);
  await run("codesign", outerArgs);
}

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} ${args.join(" ")} exited with code ${code}`));
    });
  });
}

const scriptPath = fileURLToPath(import.meta.url);
const isMain = process.argv[1] && path.resolve(process.argv[1]) === scriptPath;
if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
