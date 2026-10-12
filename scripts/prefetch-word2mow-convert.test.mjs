import assert from "node:assert/strict";
import { mkdtemp, mkdir, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  KNOWN_CONVERT_BUILDS,
  convertBinaryName,
  defaultConvertSource,
  prefetchWord2MowConvert,
  sha256File,
} from "./prefetch-word2mow-convert.mjs";

async function fixture(body = "mach-o convert\n") {
  const root = await mkdtemp(path.join(os.tmpdir(), "officedex-word2mow-"));
  const source = path.join(root, "bin", "convert");
  await mkdir(path.dirname(source), { recursive: true });
  await writeFile(source, body);
  return { root, source, dest: path.join(root, "build", "writer-convert") };
}

test("stages the pinned build and makes it executable", async () => {
  const { source, dest } = await fixture();
  const sha256 = await sha256File(source);

  const result = await prefetchWord2MowConvert({
    platform: "darwin",
    arch: "arm64",
    source,
    dest,
    builds: { "darwin-arm64": { sha256, revision: "18bf54a" } },
  });

  assert.equal(result.dest, path.join(dest, "convert"));
  assert.equal(result.revision, "18bf54a");
  const mode = (await stat(result.dest)).mode & 0o777;
  assert.equal(mode & 0o111, 0o111, "the converter must stay executable inside the bundle");
});

test("refuses a target word2mow has no build for", async () => {
  const { source, dest } = await fixture();
  const sha256 = await sha256File(source);

  await assert.rejects(
    prefetchWord2MowConvert({
      platform: "win32",
      arch: "x64",
      source,
      dest,
      builds: { "darwin-arm64": { sha256, revision: "18bf54a" } },
    }),
    /no word2mow convert build for win32-x64/,
  );
});

test("refuses a binary whose digest does not match the pin", async () => {
  const { source, dest } = await fixture("something else\n");

  await assert.rejects(
    prefetchWord2MowConvert({
      platform: "darwin",
      arch: "arm64",
      source,
      dest,
      builds: { "darwin-arm64": { sha256: "0".repeat(64), revision: "18bf54a" } },
    }),
    /digest mismatch/,
  );
});

test("names the Windows binary convert.exe", () => {
  assert.equal(convertBinaryName("win32"), "convert.exe");
  assert.equal(convertBinaryName("darwin"), "convert");
});

test("knows a darwin-x64 build at the same word2mow revision as darwin-arm64", () => {
  const x64 = KNOWN_CONVERT_BUILDS["darwin-x64"];
  assert.ok(x64, "darwin-x64 must be registered: build-mac-dmg.sh TARGET_ARCH=x64 stages it");
  assert.match(x64.sha256, /^[0-9a-f]{64}$/);
  assert.equal(x64.revision, KNOWN_CONVERT_BUILDS["darwin-arm64"].revision);
  assert.notEqual(x64.sha256, KNOWN_CONVERT_BUILDS["darwin-arm64"].sha256);
});

test("stages a cross-arch build from the per-target cache when no source is given", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "officedex-word2mow-cache-"));
  const cacheRoot = path.join(root, "build", "cache", "word2mow");
  const cached = path.join(cacheRoot, "darwin-x64", "convert");
  await mkdir(path.dirname(cached), { recursive: true });
  await writeFile(cached, "mach-o x86_64 convert\n");
  const sha256 = await sha256File(cached);

  const result = await prefetchWord2MowConvert({
    platform: "darwin",
    arch: "x64",
    dest: path.join(root, "build", "writer-convert"),
    cacheRoot,
    builds: { "darwin-x64": { sha256, revision: "289bdf45" } },
  });

  assert.equal(result.source, cached);
  assert.equal(result.target, "darwin-x64");
});

test("defaultConvertSource prefers the per-target cache over the writer checkout", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "officedex-word2mow-source-"));
  const cacheRoot = path.join(root, "cache");
  const writerSource = path.join(root, "writer");
  const checkedIn = path.join(writerSource, "apps", "docx-demo", "bin", "convert");

  assert.equal(
    defaultConvertSource({ platform: "darwin", arch: "x64", writerSource, cacheRoot }),
    checkedIn,
    "without a cached build the writer checkout's own binary is the only candidate",
  );

  const cached = path.join(cacheRoot, "darwin-x64", "convert");
  await mkdir(path.dirname(cached), { recursive: true });
  await writeFile(cached, "mach-o x86_64 convert\n");
  assert.equal(defaultConvertSource({ platform: "darwin", arch: "x64", writerSource, cacheRoot }), cached);
  assert.equal(
    defaultConvertSource({ platform: "darwin", arch: "arm64", writerSource, cacheRoot }),
    checkedIn,
    "the cache is per target; another arch still falls back to the checkout",
  );
});

test("reports the host-arch binary as a cross-arch mismatch, not just a bad digest", async () => {
  const { source, dest } = await fixture("arm64 convert\n");
  await assert.rejects(
    prefetchWord2MowConvert({
      platform: "darwin",
      arch: "x64",
      source,
      dest,
      builds: { "darwin-x64": { sha256: "0".repeat(64), revision: "289bdf45" } },
    }),
    /digest mismatch for darwin-x64[\s\S]*cross-arch build needs the darwin-x64 binary/,
  );
});
