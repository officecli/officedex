import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  PINNED_CONVERTER_BUILDS,
  STEPS,
  artifactNames,
  auditPortableExecutables,
  inputPaths,
  parseArgs,
  planSteps,
  MAX_RELATIVE_PATH,
  findOverlongPaths,
  resolveMakensis,
  resolveOffice2modocWindows,
} from "./dist-win.mjs";
import { KNOWN_CONVERT_BUILDS } from "./prefetch-word2mow-convert.mjs";
import { fakePortableExecutable } from "./pe-executable.mjs";

test("the default plan stages every payload, builds, bundles and verifies, and ships nothing", () => {
  const steps = planSteps(parseArgs([]));
  assert.deepEqual(steps, [
    "officecli", "mop-runtime", "presentation-natives", "presentation", "writer-fonts", "word2mow",
    "frontend", "wails", "bundle", "office2modoc", "licenses", "verify",
  ]);
  // Staging precedes the build; bundling follows it; verification is last.
  assert.ok(steps.indexOf("wails") > steps.indexOf("word2mow"));
  assert.ok(steps.indexOf("bundle") > steps.indexOf("wails"));
  assert.equal(steps.at(-1), "verify");
});

test("--installer and --zip append the artifact steps after verify", () => {
  const steps = planSteps(parseArgs(["--installer", "--zip"]));
  assert.deepEqual(steps.slice(-3), ["verify", "installer", "zip"]);
});

test("prepared inputs replace the steps that need the private checkouts", () => {
  const steps = planSteps(parseArgs(["--inputs", "/tmp/inputs"]));
  // The natives arrive inside the staged presentation tree.
  assert.equal(steps.includes("presentation-natives"), false);
  // presentation, writer-fonts and frontend stay, as copies from the inputs.
  for (const kept of ["presentation", "writer-fonts", "frontend", "wails", "bundle", "verify"]) assert.ok(steps.includes(kept), kept);
});

test("--from resumes at a step and --only narrows to named steps", () => {
  assert.deepEqual(planSteps(parseArgs(["--from", "bundle"])), ["bundle", "office2modoc", "licenses", "verify"]);
  assert.deepEqual(planSteps(parseArgs(["--only", "verify,wails"])), ["wails", "verify"]);
  assert.throws(() => parseArgs(["--from", "nope"]), /unknown step nope/);
  assert.throws(() => parseArgs(["--arch", "arm64"]), /only win32-x64/);
  assert.throws(() => parseArgs(["--install-scope", "root"]), /machine or user/);
  assert.throws(() => parseArgs(["--bogus"]), /unknown flag/);
});

test("every step name in the plan is a known step", () => {
  for (const step of planSteps(parseArgs(["--installer", "--zip"]))) assert.ok(STEPS.includes(step), step);
});

test("artifact names follow the macOS convention, with -installer for the NSIS exe", () => {
  assert.deepEqual(artifactNames("1.0.14"), {
    installer: "OfficeDex-v1.0.14-windows-amd64-installer.exe",
    zip: "OfficeDex-v1.0.14-windows-amd64.zip",
    summary: "OfficeDex-v1.0.14-windows-amd64.build.json",
  });
});

test("inputs are read from a prepared archive or from build/cache", () => {
  const prepared = inputPaths({ inputs: "/in", root: "/repo" });
  assert.equal(prepared.mopConvert, path.join("/in", "mop-convert", "win32-x64", "mop-convert.exe"));
  assert.equal(prepared.word2mow, path.join("/in", "word2mow", "win32-x64", "convert.exe"));
  assert.equal(prepared.presentation, path.join("/in", "presentation"));
  assert.equal(prepared.dist, path.join("/in", "dist"));
  const local = inputPaths({ root: "/repo" });
  assert.equal(local.presentation, "");
  assert.ok(local.mopConvert.endsWith(path.join("build", "cache", "mop-convert", "win32-x64", "mop-convert.exe")) || process.env.MOP_CONVERT_BIN);
});

test("both win32-x64 converter digests are pinned: word2mow in the shared table, mop-convert here", () => {
  for (const build of [KNOWN_CONVERT_BUILDS["win32-x64"], PINNED_CONVERTER_BUILDS["mop-convert"]["win32-x64"]]) {
    assert.ok(build, "win32-x64 build must be registered");
    assert.match(build.sha256, /^[0-9a-f]{64}$/);
    assert.match(build.revision, /^[0-9a-f]{40}$/);
  }
});

test("the PE audit lists every image and names the ones that are not PE32+ x86-64", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "pe-audit-"));
  await mkdir(path.join(root, "nested"), { recursive: true });
  await writeFile(path.join(root, "good.exe"), fakePortableExecutable());
  await writeFile(path.join(root, "nested", "good.dll"), fakePortableExecutable());
  await writeFile(path.join(root, "nested", "arm.node"), fakePortableExecutable({ machine: 0xaa64 }));
  await writeFile(path.join(root, "nested", "macho.node"), Buffer.from([0xcf, 0xfa, 0xed, 0xfe, 0, 0, 0, 0]));
  await writeFile(path.join(root, "readme.txt"), "not an image");
  const { rows, wrong, wanted } = await auditPortableExecutables(root, { arch: "x64" });
  assert.deepEqual(wanted, { format: "PE32+", machine: "x86-64" });
  assert.deepEqual(rows.map((row) => [row.path, row.ok]), [
    ["good.exe", true],
    [path.join("nested", "arm.node"), false],
    [path.join("nested", "good.dll"), true],
    [path.join("nested", "macho.node"), false],
  ]);
  assert.equal(wrong.length, 2);
  assert.match(wrong[0], /arm\.node: PE32\+ arm64/);
  assert.match(wrong[1], /macho\.node: not PE/);
  await rm(root, { recursive: true, force: true });
});

test("the office2modoc DLL is found in build/cache and pinned by the manifest or the fallback table", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "o2m-"));
  const version = "0.1.34";
  const dll = path.join(root, "build", "cache", "office2modoc", version, "windows-amd64", "office2modoc_ffi.dll");
  await mkdir(path.dirname(dll), { recursive: true });
  await writeFile(dll, fakePortableExecutable());
  const resolved = await resolveOffice2modocWindows({ root, version, env: {} });
  assert.equal(resolved.source, dll);
  assert.equal(resolved.expectedSha256, "a5fca02c382bc78de198c00d60464d5370c149603fe2f0ce25feef236716a9d5");

  // An explicit DLL wins, and a sibling officecli-internal manifest supplies the digest.
  const thirdParty = path.join(root, "..", "officecli-internal", "third_party", "office2modoc-ffi", version);
  await mkdir(thirdParty, { recursive: true });
  await writeFile(path.join(thirdParty, "manifest.json"), JSON.stringify({ artifacts: { "x86_64-pc-windows-msvc": { sha256: "f".repeat(64) } } }));
  const explicit = path.join(root, "custom.dll");
  await writeFile(explicit, fakePortableExecutable());
  const fromEnv = await resolveOffice2modocWindows({ root, version, env: { OFFICE2MODOC_WINDOWS_DLL: explicit } });
  assert.equal(fromEnv.source, explicit);
  assert.equal(fromEnv.expectedSha256, "f".repeat(64));
  await rm(path.join(root, "..", "officecli-internal"), { recursive: true, force: true });

  await assert.rejects(resolveOffice2modocWindows({ root, version: "9.9.9", env: {} }), /not found/);
  await rm(root, { recursive: true, force: true });
});

test("makensis is found under Program Files on Windows, overridden by OFFICEDEX_MAKENSIS, PATH otherwise", () => {
  const nsis = path.join("C:\\Program Files (x86)", "NSIS", "makensis.exe");
  assert.equal(
    resolveMakensis({ platform: "win32", env: { "ProgramFiles(x86)": "C:\\Program Files (x86)" }, exists: (p) => p === nsis }),
    nsis,
  );
  assert.equal(resolveMakensis({ platform: "win32", env: {}, exists: () => false }), "makensis");
  assert.equal(resolveMakensis({ platform: "darwin", env: {}, exists: () => true }), "makensis");
  assert.equal(
    resolveMakensis({ platform: "darwin", env: { OFFICEDEX_MAKENSIS: "scripts/nsis/makensis-docker.sh" }, root: "/repo" }),
    path.resolve("/repo", "scripts/nsis/makensis-docker.sh"),
  );
});

test("files deeper than the MAX_PATH budget are reported, longest first", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "deep-"));
  const deep = path.join(root, ...Array.from({ length: 12 }, (_, i) => `segment-${i}-abcdefghij`));
  await mkdir(deep, { recursive: true });
  await writeFile(path.join(deep, "leaf.js"), "");
  await writeFile(path.join(root, "shallow.js"), "");
  const found = await findOverlongPaths(root);
  assert.equal(found.length, 1);
  assert.ok(found[0].length > MAX_RELATIVE_PATH);
  assert.ok(found[0].path.endsWith("leaf.js"));
  assert.deepEqual(await findOverlongPaths(root, 10_000), []);
  await rm(root, { recursive: true, force: true });
});
