import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { bundleLicenses } from "./bundle-licenses.mjs";

async function createSourceFixture() {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "officedex-license-source-"));
  await mkdir(path.join(rootDir, "third_party", "officecli"), { recursive: true });
  await writeFile(path.join(rootDir, "LICENSE"), "OfficeDex GPL\n");
  await writeFile(path.join(rootDir, "NOTICE"), "OfficeDex notice\n");
  await writeFile(path.join(rootDir, "THIRD_PARTY_NOTICES.md"), "Third-party notices\n");
  await writeFile(path.join(rootDir, "third_party", "officecli", "LICENSE"), "OfficeCLI MIT\n");
  return rootDir;
}

async function assertBundleContents(destination) {
  for (const relativePath of ["OfficeDex-GPL-3.0.txt", "OfficeDex-NOTICE.txt", "THIRD_PARTY_NOTICES.md", "OfficeCLI-MIT.txt"]) {
    assert.ok((await readFile(path.join(destination, relativePath), "utf8")).length > 0, relativePath);
  }
}

test("bundles license files into a macOS application Resources directory", async () => {
  const rootDir = await createSourceFixture();
  const target = path.join(await mkdtemp(path.join(os.tmpdir(), "officedex-license-mac-")), "OfficeDex.app");
  await bundleLicenses({ rootDir, target });
  await assertBundleContents(path.join(target, "Contents", "Resources", "licenses"));
});

test("bundles license files into a Windows/archive directory", async () => {
  const rootDir = await createSourceFixture();
  const target = await mkdtemp(path.join(os.tmpdir(), "officedex-license-win-"));
  await bundleLicenses({ rootDir, target });
  await assertBundleContents(path.join(target, "licenses"));
});
