#!/usr/bin/env node

import { existsSync } from "node:fs";
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
  if (existsSync(path.join(root, "node_modules", "@playwright", "test"))) {
    run("npm", ["exec", "--", "playwright", "test", "--list", "e2e/compatibility-real.spec.ts"]);
  } else {
    console.warn("Playwright dependencies are not installed; E2E listing is deferred to the managed runtime environment.");
  }
  console.log("OfficeDex D/E compatibility checks passed. Set OFFICEDEX_E2E_COMPAT=1 and use npm run test:e2e to run managed runtime canaries.");
} finally {
  await rm(fixtureDir, { recursive: true, force: true });
}
