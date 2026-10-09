import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { fakePortableExecutable } from "./pe-executable.mjs";
import { INPUTS_FORMAT, buildManifest, inputEntries, isHostMetadataFile, packInputs, removeHostMetadataFiles, runTar, tarExecutable, unpackInputs, verifyManifest } from "./windows-inputs.mjs";

/** A repository with every input present and staged for win32-x64. */
async function fakeRepo() {
  const root = await mkdtemp(path.join(os.tmpdir(), "win-inputs-"));
  const write = async (relative, body) => {
    const file = path.join(root, relative);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, body);
  };
  await write("dist/index.html", "<!doctype html>");
  await write("dist/assets/app.js", "console.log(1)");
  await write("build/presentation/runtime.json", JSON.stringify({ platform: "win32", arch: "x64", sourceRevision: "abc123", sourceDirty: false }));
  await write("build/presentation/tools/bin/mop-convert.exe", fakePortableExecutable());
  await write("build/presentation/package.json", "{}");
  await write("build/writer-fonts/prebuilt/a.woff2", "font");
  await write("build/writer-fonts/files/b.ttf", "font");
  await write("build/cache/mop-convert/win32-x64/mop-convert.exe", fakePortableExecutable());
  await write("build/cache/word2mow/win32-x64/convert.exe", fakePortableExecutable());
  return root;
}

test("pack and unpack round-trip the inputs with a manifest that pins every file", async () => {
  const root = await fakeRepo();
  const archive = path.join(root, "out", "inputs.tar.gz");
  const packed = await packInputs({ root, out: archive });
  assert.equal(packed.archive, archive);
  assert.match(packed.sha256, /^[0-9a-f]{64}$/);
  assert.equal(packed.manifest.format, INPUTS_FORMAT);
  assert.equal(packed.manifest.target, "win32-x64");
  assert.deepEqual(packed.manifest.presentation, { platform: "win32", arch: "x64", sourceRevision: "abc123", sourceDirty: false });
  const paths = packed.manifest.files.map((file) => file.path);
  for (const expected of [
    "dist/index.html",
    "presentation/runtime.json",
    "presentation/tools/bin/mop-convert.exe",
    "writer-fonts/prebuilt/a.woff2",
    "mop-convert/win32-x64/mop-convert.exe",
    "word2mow/win32-x64/convert.exe",
  ]) assert.ok(paths.includes(expected), expected);
  assert.equal(paths.includes("manifest.json"), false);

  const dest = path.join(root, "unpacked");
  const unpacked = await unpackInputs({ archive, dest, expectedSha256: packed.sha256.toUpperCase() });
  assert.equal(unpacked.sha256, packed.sha256);
  assert.ok(existsSync(path.join(dest, "dist", "index.html")));
  assert.ok(existsSync(path.join(dest, "word2mow", "win32-x64", "convert.exe")));
  assert.equal(unpacked.manifest.files.length, packed.manifest.files.length);
  await rm(root, { recursive: true, force: true });
});

test("an archive whose sha256 does not match is refused before anything is extracted", async () => {
  const root = await fakeRepo();
  const archive = path.join(root, "inputs.tar.gz");
  await packInputs({ root, out: archive });
  const dest = path.join(root, "unpacked");
  await assert.rejects(unpackInputs({ archive, dest, expectedSha256: "0".repeat(64) }), /does not match/);
  assert.equal(existsSync(path.join(dest, "manifest.json")), false);
  await rm(root, { recursive: true, force: true });
});

test("a tampered file inside the archive fails the manifest check", async () => {
  const root = await fakeRepo();
  const staging = path.join(root, "staging");
  await mkdir(path.join(staging, "word2mow", "win32-x64"), { recursive: true });
  await writeFile(path.join(staging, "word2mow", "win32-x64", "convert.exe"), "original");
  const manifest = await buildManifest(staging, { root });
  await writeFile(path.join(staging, "word2mow", "win32-x64", "convert.exe"), "swapped");
  const problems = await verifyManifest(staging, manifest);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /convert\.exe: sha256/);
  await rm(root, { recursive: true, force: true });
});

test("packing refuses a presentation tree staged for another target, and missing inputs by name", async () => {
  const root = await fakeRepo();
  await writeFile(path.join(root, "build", "presentation", "runtime.json"), JSON.stringify({ platform: "darwin", arch: "arm64" }));
  await assert.rejects(packInputs({ root, out: path.join(root, "x.tar.gz") }), /staged for darwin-arm64, not win32-x64/);
  await rm(path.join(root, "build", "cache", "word2mow"), { recursive: true, force: true });
  await assert.rejects(packInputs({ root, out: path.join(root, "x.tar.gz") }), /word2mow.*does not exist/);
  await rm(root, { recursive: true, force: true });
});

test("the entry list names the five inputs a Windows runner cannot produce", () => {
  assert.deepEqual(inputEntries("/repo").map((entry) => entry.at), [
    "dist",
    "presentation",
    "writer-fonts",
    path.join("mop-convert", "win32-x64", "mop-convert.exe"),
    path.join("word2mow", "win32-x64", "convert.exe"),
  ]);
});

test("unpack rejects an archive that is not a windows-inputs archive", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "win-inputs-"));
  const stray = path.join(root, "stray");
  await mkdir(stray, { recursive: true });
  await writeFile(path.join(stray, "hello.txt"), "hi");
  const archive = path.join(root, "stray.tar.gz");
  runTar(["-czf", archive, "-C", stray, "."], archive);
  await assert.rejects(unpackInputs({ archive, dest: path.join(root, "out") }), /no manifest\.json/);
  await rm(root, { recursive: true, force: true });
});

test("tar is the system bsdtar on Windows and plain tar elsewhere", () => {
  assert.equal(tarExecutable("darwin"), "tar");
  assert.equal(tarExecutable("linux"), "tar");
  const onWindows = tarExecutable("win32", { SystemRoot: "C:\\Windows" });
  assert.ok(onWindows === "tar" || onWindows.endsWith(path.join("System32", "tar.exe")));
});

test("AppleDouble and Finder metadata never survive an unpack", async () => {
  // macOS tar writes `._name` entries for extended attributes unless
  // COPYFILE_DISABLE is set; on Windows they extract as real files and a
  // `._Amiri-Regular.woff` fails the font licence gate. pack sets the variable;
  // unpack also sweeps them, for archives made before it did.
  const root = await mkdtemp(path.join(os.tmpdir(), "win-inputs-"));
  const tree = path.join(root, "tree");
  await mkdir(path.join(tree, "writer-fonts", "files"), { recursive: true });
  await writeFile(path.join(tree, "writer-fonts", "files", "Amiri-Regular.woff"), "font");
  await writeFile(path.join(tree, "writer-fonts", "files", "._Amiri-Regular.woff"), "apple double");
  await writeFile(path.join(tree, ".DS_Store"), "finder");
  const manifest = await buildManifest(tree, { root });
  assert.deepEqual(manifest.files.map((file) => file.path), ["writer-fonts/files/Amiri-Regular.woff"]);
  const removed = await removeHostMetadataFiles(tree);
  assert.deepEqual(removed, [".DS_Store", path.join("writer-fonts", "files", "._Amiri-Regular.woff")]);
  assert.ok(existsSync(path.join(tree, "writer-fonts", "files", "Amiri-Regular.woff")));
  assert.equal(isHostMetadataFile("._x"), true);
  assert.equal(isHostMetadataFile("x.woff"), false);
  await rm(root, { recursive: true, force: true });
});
