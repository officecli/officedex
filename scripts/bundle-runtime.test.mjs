import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";

import { resolveBundleTarget, stageDesktopSkills } from "./bundle-runtime.mjs";

const BIN = path.join("/repo", "build", "bin");
const APP = path.join(BIN, "OfficeDex.app");

function existsAmong(...present) {
  const set = new Set(present);
  return (candidate) => set.has(candidate);
}

test("macOS stages into the .app bundle's Resources", () => {
  const target = resolveBundleTarget({
    platform: "darwin",
    bin: BIN,
    exists: existsAmong(APP),
  });
  assert.equal(target.kind, "macos-app");
  assert.equal(target.root, path.join(APP, "Contents", "Resources"));
});

test("Windows stages beside the executable, which is what Archive zips", () => {
  const target = resolveBundleTarget({
    platform: "win32",
    bin: BIN,
    exists: existsAmong(path.join(BIN, "officedex.exe")),
  });
  assert.equal(target.kind, "windows-dir");
  // `Archive (Windows)` compresses build\bin\*, so resources written to the bin
  // directory ship; app_writer.go then finds them next to the executable.
  assert.equal(target.root, BIN);
});

test("an .app wins even when a bare executable sits beside it", () => {
  // Cross-compiling for Windows on a Mac leaves the host .app in build/bin.
  // Choosing the loose layout there would scatter resources around the bundle.
  const target = resolveBundleTarget({
    platform: "win32",
    bin: BIN,
    exists: existsAmong(APP, path.join(BIN, "officedex.exe")),
  });
  assert.equal(target.kind, "macos-app");
});

test("no package means nothing to stage, rather than a guessed directory", () => {
  assert.equal(resolveBundleTarget({ platform: "win32", bin: BIN, exists: () => false }), null);
});

test("staging removes stale PPT authors and carries source evidence in the portable Skill", async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "skill-bundle-"));
  t.after(() => fs.rm(root, {recursive:true, force:true}));
  await fs.mkdir(path.join(root, "skills/presentation-pptx-quality"), {recursive:true});
  await fs.writeFile(path.join(root, "skills/presentation-pptx-quality/SKILL.md"), "old");
  await stageDesktopSkills(root);
  assert.deepEqual((await fs.readdir(path.join(root,"skills"))).sort(), ["aippt-jssdk-animation", "aippt-jssdk-design", "aippt-jssdk-video"]);
  const skill = path.join(root,"skills/aippt-jssdk-design");
  const snapshot = JSON.parse(await fs.readFile(path.join(skill,"snapshot.json")));
  assert.equal(snapshot.contract, "jssdk-progressive/v2");
  assert.ok(snapshot.files.some(f => f.path.endsWith(".verification.json")));
  assert.ok(snapshot.files.some(f => f.path.includes("/evidence/") && f.path.endsWith(".mjs")));
});
