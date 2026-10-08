import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { zipSync } from "fflate";

import { fakePortableExecutable } from "./pe-executable.mjs";
import {
  PINNED_NODE_VERSION,
  archiveDownloadHint,
  archiveName,
  extractNodeArchive,
  stageMopRuntime,
} from "./stage-mop-runtime.mjs";

test("the archive name follows node.org: tar.gz for Unix, a win-<arch>.zip for Windows", () => {
  assert.equal(archiveName("darwin", "arm64"), `node-${PINNED_NODE_VERSION}-darwin-arm64.tar.gz`);
  assert.equal(archiveName("darwin", "x64"), `node-${PINNED_NODE_VERSION}-darwin-x64.tar.gz`);
  // There is no node-vX-win32-x64.tar.gz; that name was the whole Windows gap.
  assert.equal(archiveName("win32", "x64"), `node-${PINNED_NODE_VERSION}-win-x64.zip`);
  assert.match(archiveDownloadHint("win32", "x64"), /node-v[\d.]+-win-x64\.zip/);
  assert.match(archiveDownloadHint("win32", "x64"), /SHASUMS256/);
});

test("the Windows zip is unpacked to bin/node.exe, where the Go side looks", async () => {
  // node.org's zip has node.exe at the root of its top directory, not under
  // bin/. The staged layout is the same on every platform.
  const root = await mkdtemp(path.join(os.tmpdir(), "node-zip-"));
  const image = fakePortableExecutable();
  const zip = zipSync({
    [`node-${PINNED_NODE_VERSION}-win-x64/node.exe`]: new Uint8Array(image),
    [`node-${PINNED_NODE_VERSION}-win-x64/npm.cmd`]: new Uint8Array(Buffer.from("@echo off\r\n")),
    [`node-${PINNED_NODE_VERSION}-win-x64/node_modules/npm/package.json`]: new Uint8Array(Buffer.from("{}")),
  });
  const archive = path.join(root, archiveName("win32", "x64"));
  await writeFile(archive, zip);

  const dest = path.join(root, "extracted");
  const executable = await extractNodeArchive(archive, dest, { platform: "win32" });
  assert.equal(executable, path.join(dest, "bin", "node.exe"));
  assert.deepEqual(await readFile(executable), image);
  // Only the runtime travels; npm and its tree stay out of the bundle.
  assert.equal(existsSync(path.join(dest, "npm.cmd")), false);
  assert.equal(existsSync(path.join(dest, "node_modules")), false);
  await rm(root, { recursive: true, force: true });
});

test("a zip without a top-level node.exe is refused by name", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "node-zip-"));
  const archive = path.join(root, "not-node.zip");
  await writeFile(archive, zipSync({ "something/else.exe": new Uint8Array(fakePortableExecutable()) }));
  await assert.rejects(extractNodeArchive(archive, path.join(root, "x"), { platform: "win32" }), /no <top>\/node\.exe entry/);
  await rm(root, { recursive: true, force: true });
});

test("a cross-built runtime stages with relocationVerified:false and the reason recorded", async () => {
  // The old runtime.json wrote `relocationVerified: true` unconditionally,
  // right after a probe that cannot run on this host. The record must say
  // what happened, so a Windows machine can tell what is left to prove.
  const root = await mkdtemp(path.join(os.tmpdir(), "stage-runtime-"));
  const source = path.join(root, "source");
  await mkdir(path.join(source, "bin"), { recursive: true });
  await writeFile(path.join(source, "bin", "node.exe"), fakePortableExecutable());
  const dest = path.join(root, "mop-runtime");

  const result = await stageMopRuntime({ platform: "win32", arch: "x64", source, dest, probe: false });
  assert.equal(result.probed, false);
  assert.equal(result.dest, dest);
  const manifest = JSON.parse(await readFile(path.join(dest, "runtime.json"), "utf8"));
  assert.equal(manifest.platform, "win32");
  assert.equal(manifest.arch, "x64");
  assert.equal(manifest.relocationVerified, false);
  assert.equal("verifiedAt" in manifest, false, "no verification date for a verification that did not happen");
  assert.match(manifest.relocationUnverifiedReason, /cross-build/);
  assert.deepEqual(manifest.fileChecks, { symlink: false, regularFile: true, format: "PE32+", machine: "x86-64" });
  assert.equal(manifest.nodeVersion, PINNED_NODE_VERSION);
  assert.ok(existsSync(path.join(dest, "bin", "node.exe")));
  await rm(root, { recursive: true, force: true });
});

test("a runtime that is proven to run records relocationVerified:true with a date", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "stage-runtime-"));
  const source = path.join(root, "source");
  await mkdir(path.join(source, "bin"), { recursive: true });
  await writeFile(path.join(source, "bin", "node"), "#!/bin/sh\necho v24.18.0\n", { mode: 0o755 });
  const dest = path.join(root, "mop-runtime");
  const verify = async () => ({ version: "v24.18.0", provenFrom: "/elsewhere", probed: true });

  const result = await stageMopRuntime({ platform: "darwin", arch: "arm64", source, dest, verify });
  assert.equal(result.probed, true);
  const manifest = JSON.parse(await readFile(path.join(dest, "runtime.json"), "utf8"));
  assert.equal(manifest.relocationVerified, true);
  assert.ok(manifest.verifiedAt);
  assert.equal("relocationUnverifiedReason" in manifest, false);
  await rm(root, { recursive: true, force: true });
});
