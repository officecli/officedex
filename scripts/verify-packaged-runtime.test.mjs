import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { resolveResourceRoot, verifyPackagedRuntime } from "./verify-packaged-runtime.mjs";

/** Builds a package tree; `omit` drops payloads to reproduce a broken build. */
async function packageTree({ platform = "win32", omit = [] } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "pkg-"));
  const bin = path.join(root, "bin");
  await mkdir(bin, { recursive: true });
  const resources = platform === "darwin" ? path.join(bin, "OfficeDex.app", "Contents", "Resources") : bin;
  await mkdir(resources, { recursive: true });
  await writeFile(path.join(bin, platform === "win32" ? "officedex.exe" : "officedex"), "");
  if (platform === "darwin") {
    await mkdir(path.join(bin, "OfficeDex.app", "Contents", "MacOS"), { recursive: true });
  }

  const skip = new Set(omit);
  if (!skip.has("skills")) {
    const skill = path.join(resources, "skills/aippt-jssdk-design");
    await mkdir(skill, {recursive: true});
    for (const file of ["SKILL.md", "policy.json", "registry.json", "snapshot.json", "availability.json"]) await writeFile(path.join(skill, file), "{}");
  }
  if (!skip.has("animation-skill")) {
    const skill=path.join(resources,"skills/aippt-jssdk-animation");
    await mkdir(path.join(skill,"scripts"),{recursive:true});
    for(const file of ["SKILL.md","registry.json","snapshot.json","scripts/validate-animation.mjs"]) await writeFile(path.join(skill,file),"{}");
  }
  if (!skip.has("writer-fonts")) {
    await mkdir(path.join(resources, "writer-fonts", "prebuilt"), { recursive: true });
    await mkdir(path.join(resources, "writer-fonts", "files"), { recursive: true });
    await writeFile(path.join(resources, "writer-fonts", "files", "SourceHanSansCN-Regular.woff"), "");
    await writeFile(path.join(resources, "writer-fonts", "prebuilt", "a.json"), "{}");
  }
  if (!skip.has("mop-runtime")) {
    await mkdir(path.join(resources, "mop-runtime", "bin"), { recursive: true });
    await writeFile(path.join(resources, "mop-runtime", "bin", "node"), "");
  }
  if (!skip.has("presentation")) {
    await mkdir(path.join(resources, "presentation"), { recursive: true });
    await writeFile(path.join(resources, "presentation", "package.json"), "{}");
  }
  if (!skip.has("mop-convert")) {
    const bin_ = path.join(resources, "presentation", "tools", "bin");
    await mkdir(bin_, { recursive: true });
    await writeFile(path.join(bin_, platform === "win32" ? "mop-convert.exe" : "mop-convert"), "");
  }
  if (!skip.has("officecli")) {
    await mkdir(path.join(resources, "officecli"), { recursive: true });
    await writeFile(path.join(resources, "officecli", platform === "win32" ? "officecli.exe" : "officecli"), "");
  }
  if (!skip.has("word2mow")) {
    await mkdir(path.join(resources, "word2mow"), { recursive: true });
    await writeFile(path.join(resources, "word2mow", platform === "win32" ? "convert.exe" : "convert"), "");
  }
  return { root, bin };
}

/**
 * These tests are about which payloads a package carries. Whether a runtime
 * actually starts is relocatable-runtime.test.mjs's subject, so it is stubbed
 * here -- a fixture cannot ship a real 120MB Node, and a fixture that could
 * would be testing Node rather than this gate.
 */
const runtimeStarts = async () => ({ version: "v24.18.0" });

test("the Windows package that was shipping silently broken now fails", async () => {
  // Nothing copied the staged resources beside officedex.exe, so writer-fonts,
  // mop-runtime and presentation were all absent -- and the licence gate went
  // green because it found no fonts to object to.
  const { root, bin } = await packageTree({ omit: ["writer-fonts", "mop-runtime", "presentation", "word2mow"] });
  await assert.rejects(verifyPackagedRuntime(bin, { platform: "win32", verifyRuntime: runtimeStarts }), (error) => {
    assert.match(error.message, /incomplete/);
    assert.match(error.message, /Writer default-font closure/);
    assert.match(error.message, /MOP Node runtime/);
    assert.match(error.message, /MOP presentation runtime/);
    return true;
  });
  await rm(root, { recursive: true, force: true });
});

test("a complete Windows package passes", async () => {
  const { root, bin } = await packageTree();
  const result = await verifyPackagedRuntime(bin, { platform: "win32", verifyRuntime: runtimeStarts });
  assert.equal(result.kind, "windows-dir");
  assert.equal(result.degraded.length, 0);
  await rm(root, { recursive: true, force: true });
});

test("a Windows package without the converter ships, but says so", async () => {
  // No Windows build of word2mow exists yet. That is a declared gap: the
  // package is still usable, just without DOCX editing.
  const { root, bin } = await packageTree({ omit: ["word2mow"] });
  const result = await verifyPackagedRuntime(bin, { platform: "win32", verifyRuntime: runtimeStarts });
  assert.equal(result.degraded.length, 1);
  assert.match(result.degraded[0], /word2mow converter/);
  await rm(root, { recursive: true, force: true });
});

test("a presentation runtime without mop-convert is rejected", async () => {
  // The runtime tree can be complete while the converter is absent -- the
  // staged bundle that shipped this way looked fine to every gate, and the
  // first sign of trouble was a dialog when a user opened a deck.
  const { root, bin } = await packageTree({ omit: ["mop-convert"] });
  await assert.rejects(verifyPackagedRuntime(bin, { platform: "win32", verifyRuntime: runtimeStarts }), (error) => {
    assert.match(error.message, /mop-convert/);
    return true;
  });
  await rm(root, { recursive: true, force: true });
});

test("an empty resource directory is as broken as a missing one", async () => {
  const { root, bin } = await packageTree();
  await rm(path.join(bin, "writer-fonts", "files"), { recursive: true, force: true });
  await rm(path.join(bin, "writer-fonts", "prebuilt"), { recursive: true, force: true });
  await assert.rejects(verifyPackagedRuntime(bin, { platform: "win32", verifyRuntime: runtimeStarts }), /empty directory|missing prebuilt/);
  await rm(root, { recursive: true, force: true });
});

test("a font closure without its metrics is rejected", async () => {
  const { root, bin } = await packageTree();
  await rm(path.join(bin, "writer-fonts", "prebuilt"), { recursive: true, force: true });
  await assert.rejects(verifyPackagedRuntime(bin, { platform: "win32", verifyRuntime: runtimeStarts }), /missing prebuilt/);
  await rm(root, { recursive: true, force: true });
});

test("the macOS bundle layout is resolved and verified too", async () => {
  const { root, bin } = await packageTree({ platform: "darwin" });
  const target = await resolveResourceRoot(bin);
  assert.equal(target.kind, "macos-app");
  const result = await verifyPackagedRuntime(bin, { platform: "darwin", verifyRuntime: runtimeStarts });
  assert.equal(result.degraded.length, 0);
  await rm(root, { recursive: true, force: true });
});

test("a directory with no package at all is an error, not a pass", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "pkg-empty-"));
  await assert.rejects(verifyPackagedRuntime(root), /no packaged application/);
  await rm(root, { recursive: true, force: true });
});


test("missing animation Skill fails packaged runtime validation", async()=>{
  const {root,bin}=await packageTree({omit:["animation-skill"]});
  try { await assert.rejects(verifyPackagedRuntime(bin,{platform:"win32"}), /Native animation PPT Skill/); }
  finally {await rm(root,{recursive:true,force:true});}
});

test("a runtime that is present but cannot start fails the package", async () => {
  // The shape of the four-day failure: the directory was there, so the gate
  // said the payload was present, and the abort surfaced instead inside a
  // user's generation.
  const { root, bin } = await packageTree({ platform: "darwin" });
  const runtimeAborts = async () => {
    throw new Error("Library not loaded: @rpath/libnode.147.dylib");
  };
  await assert.rejects(
    verifyPackagedRuntime(bin, { platform: "darwin", verifyRuntime: runtimeAborts }),
    (error) => {
      assert.match(error.message, /MOP Node runtime/);
      assert.match(error.message, /libnode/);
      return true;
    },
  );
  await rm(root, { recursive: true, force: true });
});

test("a local build may ship without the runtime, and says so", async () => {
  // A local build stages no Node; the app falls back to the developer's own.
  const { root, bin } = await packageTree({ platform: "darwin", omit: ["mop-runtime"] });
  const result = await verifyPackagedRuntime(bin, {
    platform: "darwin",
    mayBeAbsent: ["mop-runtime"],
    verifyRuntime: runtimeStarts,
  });
  assert.equal(result.degraded.length, 1);
  assert.match(result.degraded[0], /MOP Node runtime: absent/);
  await rm(root, { recursive: true, force: true });
});

test("a local build may ship without the presentation tree, converter included", async () => {
  // A local build runs against the presentation checkout, so it stages no
  // runtime at all. mop-convert lives inside that tree: tolerating the tree
  // without tolerating what it contains would fail every local build on a
  // converter that was never supposed to be there.
  const { root, bin } = await packageTree({
    platform: "darwin",
    omit: ["presentation", "mop-convert"],
  });
  const result = await verifyPackagedRuntime(bin, {
    platform: "darwin",
    mayBeAbsent: ["presentation"],
    verifyRuntime: runtimeStarts,
  });
  assert.deepEqual(result.degraded.map((entry) => entry.split(":")[0]).sort(), [
    "MOP presentation runtime",
    "mop-convert",
  ]);
  await rm(root, { recursive: true, force: true });
});

test("tolerating the presentation tree does not excuse one that is there and gutted", async () => {
  // The stale bundled copy that broke PPTX generation was present and passed
  // every marker check; only the payloads it never staged were missing.
  const { root, bin } = await packageTree({ platform: "darwin", omit: ["mop-convert"] });
  await assert.rejects(
    verifyPackagedRuntime(bin, {
      platform: "darwin",
      mayBeAbsent: ["presentation"],
      verifyRuntime: runtimeStarts,
    }),
    /mop-convert/,
  );
  await rm(root, { recursive: true, force: true });
});

test("being allowed to be absent does not excuse being broken", async () => {
  // The tolerance is for builds that ship no runtime, not for builds that ship
  // a dead one: the app prefers the runtime beside its executable over PATH,
  // so a broken copy is worse than none at all.
  const { root, bin } = await packageTree({ platform: "darwin" });
  const runtimeAborts = async () => {
    throw new Error("Library not loaded: @rpath/libnode.147.dylib");
  };
  await assert.rejects(
    verifyPackagedRuntime(bin, {
      platform: "darwin",
      mayBeAbsent: ["mop-runtime"],
      verifyRuntime: runtimeAborts,
    }),
    /MOP Node runtime/,
  );
  await rm(root, { recursive: true, force: true });
});
