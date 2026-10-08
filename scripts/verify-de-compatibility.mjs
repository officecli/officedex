#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const fixtureDir = await mkdtemp(path.join(os.tmpdir(), "officedex-compat-fixtures-"));

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    env: { ...process.env, ...options.env },
    stdio: "inherit",
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} exited with ${result.status ?? "signal"}`);
  }
}

try {
  run("node", ["scripts/test-fixtures/generate-compat-fixtures.mjs", fixtureDir, "--verify"]);
  // These are provider-free compatibility checks. Hosted real E2E remains
  // explicitly opt-in so running this verifier never spends Credits.
  run("go", ["test", "./internal/bridge", "./internal/localstore", "./internal/login", "./internal/xlsxeditor", "./internal/timeline", "-count=1"]);
  const compatibilitySpec = path.join(root, "e2e", "compatibility-real.spec.ts");
  if (!existsSync(compatibilitySpec)) throw new Error("missing e2e/compatibility-real.spec.ts");
  const source = readFileSync(compatibilitySpec, "utf8");
  if (!source.includes('test.describe("OfficeDex D/E compatibility canaries"')) {
    throw new Error("compatibility E2E spec is missing its canary suite");
  }
  console.log("Compatibility E2E spec is present and gated for managed runtime execution.");
  console.log("OfficeDex D/E compatibility checks passed. Set OFFICEDEX_E2E_COMPAT=1 and use npm run test:e2e to run managed runtime canaries.");
} finally {
  await rm(fixtureDir, { recursive: true, force: true });
}
