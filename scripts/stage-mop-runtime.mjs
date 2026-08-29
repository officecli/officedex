#!/usr/bin/env node
// Stage the Node executable used by the MOP authoring worker. The release
// pipeline should provide a pinned, audited runtime through MOP_RUNTIME_SOURCE;
// local macOS development may fall back to the installed Homebrew Node.
import { chmod, cp, mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const DEST = path.join(ROOT, "build", "mop-runtime");
const nodeName = process.platform === "win32" ? "node.exe" : "node";
const sourceRoot = process.env.MOP_RUNTIME_SOURCE?.trim();
const sourceNode = sourceRoot ? path.join(sourceRoot, "bin", nodeName) :
  (process.platform === "darwin" && existsSync("/opt/homebrew/bin/node") ? "/opt/homebrew/bin/node" : null);

if (!sourceNode || !existsSync(sourceNode)) {
  throw new Error("MOP runtime source is missing; set MOP_RUNTIME_SOURCE to a staged runtime directory");
}

await mkdir(path.join(DEST, "bin"), { recursive: true });
await cp(sourceNode, path.join(DEST, "bin", nodeName), { force: true });
if (process.platform !== "win32") await chmod(path.join(DEST, "bin", nodeName), 0o755);

let version = "unknown";
try {
  const { execFileSync } = await import("node:child_process");
  version = execFileSync(path.join(DEST, "bin", nodeName), ["--version"], { encoding: "utf8" }).trim();
} catch {}
await writeFile(path.join(DEST, "runtime.json"), JSON.stringify({
  name: "officedex-mop-runtime",
  nodeVersion: version,
  platform: process.platform,
  arch: os.arch(),
  source: sourceRoot || "system-node-development-fallback",
}, null, 2) + "\n", "utf8");
console.log(`[stage-mop-runtime] ${sourceNode} -> ${DEST}`);
