import assert from "node:assert/strict";
import { mkdtemp, mkdir, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  convertBinaryName,
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
