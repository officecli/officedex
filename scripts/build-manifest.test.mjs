import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("./build-manifest.mjs", import.meta.url));

async function dummyZip() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "officedex-manifest-"));
  const zip = path.join(dir, "OfficeDex-v1.0.1-darwin-universal.zip");
  await writeFile(zip, "not-a-real-zip");
  return { dir, zip };
}

function run(args) {
  return spawnSync(process.execPath, [script, ...args], { encoding: "utf8" });
}

test("rejects 1.0.x when --channel stable", async () => {
  const { zip } = await dummyZip();
  const result = run(["--version", "1.0.1", "--channel", "stable", "--darwin", zip, "--out", path.join(os.tmpdir(), "nope.json")]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /channel stable requires version 0\.x\.y/);
});

test("rejects 0.5.x when --channel 1.0", async () => {
  const { zip } = await dummyZip();
  const result = run(["--version", "0.5.43", "--channel", "1.0", "--darwin", zip, "--out", path.join(os.tmpdir(), "nope.json")]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /channel 1\.0 requires version 1\.0\.N/);
});

test("writes a 1.0 manifest when channel and version match", async () => {
  const { dir, zip } = await dummyZip();
  const out = path.join(dir, "channels", "1.0", "manifest.json");
  const result = run(["--version", "1.0.1", "--channel", "1.0", "--darwin", zip, "--out", out]);
  assert.equal(result.status, 0, result.stderr);
  const body = JSON.parse(await readFile(out, "utf8"));
  assert.equal(body.version, "1.0.1");
  assert.ok(body.assets["darwin-arm64"]);
});

test("single-arch --darwin-arm64 does not alias Intel", async () => {
  const { dir, zip } = await dummyZip();
  const out = path.join(dir, "manifest.json");
  const result = run(["--version", "1.0.1", "--channel", "1.0", "--darwin-arm64", zip, "--out", out]);
  assert.equal(result.status, 0, result.stderr);
  const body = JSON.parse(await readFile(out, "utf8"));
  assert.ok(body.assets["darwin-arm64"]);
  assert.equal(body.assets["darwin-amd64"], undefined);
});
