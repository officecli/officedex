#!/usr/bin/env node
/**
 * Fail when the MOP schema OfficeDex stamps on packages is not the one the
 * presentation runtime it ships with reports.
 *
 * The editor's `assertPackageCapabilities` requires the two to be equal, and
 * the stamp is ours — two constants, one per path:
 *
 *   internal/mophttp/capabilities.go            DefaultSchemaVersion (packaged app)
 *   presentation-component/src/officedex-host-bridge.ts  MOP_SCHEMA_VERSION (dev)
 *
 * When presentation upgrades mop-wasm and these are not bumped, every
 * presentation fails to open with "MOP schema mismatch: package=A, runtime=B".
 * That happened at 975→1081 and again at 1081→1097, the second time pulled in
 * silently by start:desktop's auto-sync and caught only after a release build
 * had already staged it. The Go and TS pin tests would have caught it; nothing
 * ran them. This runs where the runtime changes hands: after staging a release
 * tree (build-mac-dmg.sh) and after syncing the dev checkout (dev-deps.sh).
 *
 * Usage: node scripts/verify-mop-schema.mjs [--root <presentation root>]
 * Default root: PRESENTATION_SOURCE_DIR, else ../presentation.
 */

import { existsSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const OFFICEDEX_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const STAMP_SOURCES = [
  {
    file: "internal/mophttp/capabilities.go",
    pattern: /DefaultSchemaVersion\s*=\s*(\d+)/,
  },
  {
    file: "presentation-component/src/officedex-host-bridge.ts",
    pattern: /const\s+MOP_SCHEMA_VERSION\s*=\s*(\d+)\s*;/,
  },
];

/**
 * The engine the runtime actually loads, in the MOP worker's own order
 * (officecli-internal/internal/runtime/pptx_mop_skill_worker.mjs): the
 * wrapper's package, then pnpm's copy under the engine, and only then the
 * bos snapshot — which in current checkouts is a stale 975 build kept as the
 * root-presence marker, so checking it first would report the wrong runtime.
 */
export function wasmCandidates(root) {
  return [
    path.join(root, "packages", "mop-wasm"),
    path.join(root, "packages", "presentation-engine", "node_modules", "mop-wasm"),
    path.join(root, "bos", "dist", "mop-wasm", "pkg"),
  ];
}

export function resolveWasmPackage(root) {
  for (const candidate of wasmCandidates(root)) {
    if (existsSync(path.join(candidate, "mop_wasm.js")) && existsSync(path.join(candidate, "mop_wasm_bg.wasm"))) {
      return realpathSync(candidate);
    }
  }
  return null;
}

export function readStamps(officedexDir = OFFICEDEX_DIR) {
  return STAMP_SOURCES.map(({ file, pattern }) => {
    const source = readFileSync(path.join(officedexDir, file), "utf8");
    const match = pattern.exec(source);
    if (!match) throw new Error(`verify-mop-schema: no schema constant found in ${file}`);
    return { file, schemaVersion: Number(match[1]) };
  });
}

export async function runtimeSchemaVersion(wasmPackage) {
  const module = await import(pathToFileURL(path.join(wasmPackage, "mop_wasm.js")).href);
  module.initSync({ module: readFileSync(path.join(wasmPackage, "mop_wasm_bg.wasm")) });
  const engine = new module.MopEngine();
  try {
    return engine.capabilities.schemaVersion;
  } finally {
    engine.free();
  }
}

/** The stamps that disagree with the runtime, as sentences. Empty when all match. */
export function schemaMismatches(stamps, runtime) {
  return stamps
    .filter((stamp) => stamp.schemaVersion !== runtime)
    .map((stamp) => `${stamp.file} stamps schema ${stamp.schemaVersion}, runtime reports ${runtime}`);
}

async function main() {
  const args = process.argv.slice(2);
  const rootFlag = args.indexOf("--root");
  const root = path.resolve(
    rootFlag >= 0 && args[rootFlag + 1]
      ? args[rootFlag + 1]
      : process.env.PRESENTATION_SOURCE_DIR || path.join(OFFICEDEX_DIR, "..", "presentation"),
  );
  const wasmPackage = resolveWasmPackage(root);
  if (!wasmPackage) {
    console.error(`[verify-mop-schema] no mop-wasm package under ${root}`);
    process.exit(1);
  }
  const runtime = await runtimeSchemaVersion(wasmPackage);
  const problems = schemaMismatches(readStamps(), runtime);
  if (problems.length > 0) {
    console.error(`[verify-mop-schema] MOP schema mismatch against ${wasmPackage}:`);
    for (const problem of problems) console.error(`  - ${problem}`);
    console.error(
      `[verify-mop-schema] every presentation would fail to open. Set both constants to ${runtime} ` +
        "(internal/mophttp/capabilities.go and presentation-component/src/officedex-host-bridge.ts).",
    );
    process.exit(1);
  }
  console.log(`[verify-mop-schema] schema ${runtime} matches (${wasmPackage})`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
