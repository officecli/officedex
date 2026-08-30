import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { bundleOffice2modoc, bundleWindowsOffice2modoc, sha256File } from "./bundle-office2modoc.mjs";

test("bundles the office2modoc FFI into macOS app resources", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "officedex-office2modoc-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const app = path.join(root, "OfficeDex.app");
  const source = path.join(root, "liboffice2modoc_ffi.dylib");
  await mkdir(path.join(app, "Contents", "Resources"), { recursive: true });
  await writeFile(source, "test ffi");
  const expectedSha256 = await sha256File(source);

  const result = await bundleOffice2modoc({ app, source, sign: false, expectedSha256, validateUniversal: false });

  assert.equal(result.sha256, expectedSha256);
  assert.equal(await readFile(result.target, "utf8"), "test ffi");
});

test("rejects an unexpected office2modoc binary", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "officedex-office2modoc-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = path.join(root, "liboffice2modoc_ffi.dylib");
  await writeFile(source, "unexpected");
  await assert.rejects(
    bundleOffice2modoc({ app: path.join(root, "OfficeDex.app"), source, sign: false, expectedSha256: "0".repeat(64), validateUniversal: false }),
    /checksum mismatch/,
  );
});

test("bundles and validates the Windows DLL at the executable-relative path", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "officedex-office2modoc-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const app = path.join(root, "OfficeDex");
  const source = path.join(root, "office2modoc_ffi.dll");
  await writeFile(source, Buffer.from([0x4d, 0x5a, 0x00, 0x01, 0x02]));
  const expectedSha256 = await sha256File(source);

  const result = await bundleWindowsOffice2modoc({ app, source, expectedSha256 });
  assert.equal(result.target, path.join(app, "office2modoc", "office2modoc_ffi.dll"));
  assert.equal(result.sha256, expectedSha256);
  assert.deepEqual(await readFile(result.target), await readFile(source));
});

test("rejects a non-PE Windows FFI file", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "officedex-office2modoc-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = path.join(root, "office2modoc_ffi.dll");
  await writeFile(source, "not a dll");
  await assert.rejects(
    bundleWindowsOffice2modoc({ app: path.join(root, "OfficeDex"), source }),
    /not a PE DLL/,
  );
});
