import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildCodesignTargets,
  buildNotarizationSigningPlan,
  codesignEntitlementsForTarget,
  refreshRuntimeManifestNodeChecksum,
} from "./codesign-bundled-officecli.mjs";

const LOCAL_ENTITLEMENTS = path.join(process.cwd(), "build", "darwin", "local-entitlements.plist");

test("notarization preserves Node JIT entitlements and refreshes its checksum before sealing the app", () => {
  const app = path.join("build", "bin", "OfficeDex.app");
  const runtimeNode = path.join(app, "Contents", "Resources", "pptxgenjs-runtime", "bin", "node");
  const officecli = path.join(app, "Contents", "Resources", "officecli", "officecli");
  const mainExecutable = path.join(app, "Contents", "MacOS", "officedex");

  assert.deepEqual(buildNotarizationSigningPlan({
    app,
    binaries: [officecli, runtimeNode, mainExecutable],
    nodeEntitlements: "node-entitlements.plist",
  }), [
    { target: officecli, entitlements: null, refreshRuntimeManifest: false, bundle: false },
    { target: runtimeNode, entitlements: "node-entitlements.plist", refreshRuntimeManifest: true, bundle: false },
    { target: mainExecutable, entitlements: null, refreshRuntimeManifest: false, bundle: false },
    { target: app, entitlements: null, refreshRuntimeManifest: false, bundle: true },
  ]);
});

test("release rechecks the runtime and Canvas render after app notarization", async () => {
  const workflow = await readFile(new URL("../.github/workflows/release.yml", import.meta.url), "utf8");
  const notarize = workflow.indexOf("- name: Notarize .app (macOS)");
  const verifyRuntime = workflow.indexOf("- name: Verify notarized bundled PptxGenJS runtime (macOS)");
  const renderCanvas = workflow.indexOf("- name: Complete Canvas render from notarized package contents (macOS)");
  const archive = workflow.indexOf("- name: Archive (macOS)");

  assert.ok(notarize >= 0);
  assert.ok(verifyRuntime > notarize);
  assert.ok(renderCanvas > verifyRuntime);
  assert.ok(archive > renderCanvas);
});

test("signs bundled Node before OfficeCLI and the outer app", () => {
  const app = path.join("build", "bin", "OfficeDex.app");
  assert.deepEqual(buildCodesignTargets({ app, binaryName: "officecli" }), [
    path.join(app, "Contents", "Resources", "pptxgenjs-runtime", "bin", "node"),
    path.join(app, "Contents", "Resources", "officecli", "officecli"),
    app,
  ]);
});

test("uses Node-specific JIT entitlements only for the bundled Node target", () => {
  assert.equal(codesignEntitlementsForTarget({
    target: "/app/runtime/bin/node",
    runtimeNode: "/app/runtime/bin/node",
    defaultEntitlements: "/app/default.plist",
    nodeEntitlements: "/app/node.plist",
  }), "/app/node.plist");
  assert.equal(codesignEntitlementsForTarget({
    target: "/app/officecli",
    runtimeNode: "/app/runtime/bin/node",
    defaultEntitlements: "/app/default.plist",
    nodeEntitlements: "/app/node.plist",
  }), "/app/default.plist");
});

test("refreshes runtime.json after codesign changes the Node binary", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "pptxgenjs-signed-manifest-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const node = path.join(root, "bin", "node");
  await mkdir(path.dirname(node), { recursive: true });
  await writeFile(node, "signed node bytes");
  await writeFile(path.join(root, "runtime.json"), JSON.stringify({ nodeSha256: "before", nodeSigned: false }));

  const manifest = await refreshRuntimeManifestNodeChecksum(node);

  assert.notEqual(manifest.nodeSha256, "before");
  assert.equal(manifest.nodeSigned, true);
  assert.deepEqual(JSON.parse(await readFile(path.join(root, "runtime.json"), "utf8")), manifest);
});

test("local ad-hoc app signing disables library validation for bundled FFI", async () => {
  const plist = await readFile(LOCAL_ENTITLEMENTS, "utf8");
  assert.match(plist, /com\.apple\.security\.cs\.disable-library-validation/);
  assert.match(plist, /<true\s*\/>/);
});
