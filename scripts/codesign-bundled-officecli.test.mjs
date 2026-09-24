import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {
  DEFAULT_NODE_ENTITLEMENTS,
  buildCodesignTargets,
  buildNotarizationSigningPlan,
} from "./codesign-bundled-officecli.mjs";

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

test("assigns node JIT entitlements only under mop-runtime", () => {
  const app = path.join("build", "bin", "OfficeDex.app");
  const node = path.join(app, "Contents", "Resources", "mop-runtime", "bin", "node");
  const mopConvert = path.join(app, "Contents", "Resources", "presentation", "tools", "bin", "mop-convert");
  const officecli = path.join(app, "Contents", "Resources", "officecli", "officecli");
  const mainExecutable = path.join(app, "Contents", "MacOS", "officedex");
  const plan = buildNotarizationSigningPlan({
    app,
    binaries: [node, mopConvert, officecli, mainExecutable],
  });
  const byTarget = Object.fromEntries(plan.map((item) => [item.target, item.entitlements]));
  assert.equal(byTarget[node], DEFAULT_NODE_ENTITLEMENTS);
  assert.equal(byTarget[mopConvert], null);
  assert.equal(byTarget[officecli], null);
  assert.equal(byTarget[mainExecutable], null);
  assert.equal(byTarget[app], null);
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
