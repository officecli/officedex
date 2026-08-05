import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { bundleOffice2modoc, sha256File } from "./bundle-office2modoc.mjs";

test("bundles the office2modoc FFI into macOS app resources", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "officedex-office2modoc-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const app = path.join(root, "OfficeDex.app");
  const source = path.join(root, "liboffice2modoc_ffi.dylib");
  await mkdir(path.join(app, "Contents", "Resources"), { recursive: true });
  await writeFile(source, "test ffi");
  const expectedSha256 = await sha256File(source);

  const result = await bundleOffice2modoc({ app, source, sign: false, expectedSha256 });

  assert.equal(result.sha256, expectedSha256);
  assert.equal(await readFile(result.target, "utf8"), "test ffi");
});

test("rejects an unexpected office2modoc binary", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "officedex-office2modoc-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = path.join(root, "liboffice2modoc_ffi.dylib");
  await writeFile(source, "unexpected");
  await assert.rejects(
    bundleOffice2modoc({ app: path.join(root, "OfficeDex.app"), source, sign: false, expectedSha256: "0".repeat(64) }),
    /checksum mismatch/,
  );
});
