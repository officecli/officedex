import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { buildCodesignTargets, buildNotarizationSigningPlan } from "./codesign-bundled-officecli.mjs";

test("signs bundled OfficeCLI before the outer app", () => {
  const app = path.join("build", "bin", "OfficeDex.app");
  const officecli = path.join(app, "Contents", "Resources", "officecli", "officecli");
  const mainExecutable = path.join(app, "Contents", "MacOS", "officedex");
  assert.deepEqual(buildNotarizationSigningPlan({ app, binaries: [officecli, mainExecutable] }), [
    { target: officecli, entitlements: null, bundle: false },
    { target: mainExecutable, entitlements: null, bundle: false },
    { target: app, entitlements: null, refreshRuntimeManifest: false, bundle: true },
  ]);
});

test("builds the OfficeCLI and app signing targets", () => {
  const app = path.join("build", "bin", "OfficeDex.app");
  assert.deepEqual(buildCodesignTargets({ app, binaryName: "officecli" }), [
    path.join(app, "Contents", "Resources", "officecli", "officecli"),
    app,
  ]);
});

test("local ad-hoc app signing disables library validation for bundled FFI", async () => {
  const plist = await readFile(path.join(process.cwd(), "build", "darwin", "local-entitlements.plist"), "utf8");
  assert.match(plist, /com\.apple\.security\.cs\.disable-library-validation/);
  assert.match(plist, /<true\s*\/>/);
});
