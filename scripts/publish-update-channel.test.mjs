import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("./publish-update-channel.mjs", import.meta.url));

async function setup() {
  const root = await mkdtemp(path.join(os.tmpdir(), "officedex-publish-"));
  const zip = path.join(root, "OfficeDex-v1.0.1-darwin-arm64.zip");
  await writeFile(zip, "zip-bytes");
  const dist = path.join(root, "officedex-dist");
  await mkdir(dist, { recursive: true });
  await writeFile(path.join(dist, "manifest.json"), `${JSON.stringify({
    version: "0.5.43",
    assets: {},
  }, null, 2)}\n`);
  return { root, zip, dist };
}

function run(args) {
  return spawnSync(process.execPath, [script, ...args], { encoding: "utf8" });
}

test("writes channels/1.0 and leaves production manifest at 0.5.x", async () => {
  const { zip, dist } = await setup();
  const result = run([
    "--channel", "1.0",
    "--version", "1.0.1",
    "--darwin-arm64", zip,
    "--dist", dist,
  ]);
  assert.equal(result.status, 0, result.stderr);
  const channel = JSON.parse(await readFile(path.join(dist, "channels/1.0/manifest.json"), "utf8"));
  assert.equal(channel.version, "1.0.1");
  assert.ok(channel.assets["darwin-arm64"]);
  assert.equal(channel.assets["darwin-amd64"], undefined);
  const production = JSON.parse(await readFile(path.join(dist, "manifest.json"), "utf8"));
  assert.equal(production.version, "0.5.43");
});

test("same version merges a second arch into the 1.0 manifest", async () => {
  const { root, zip, dist } = await setup();
  const intel = path.join(root, "OfficeDex-v1.0.1-darwin-amd64.zip");
  await writeFile(intel, "intel-zip");
  const first = run(["--channel", "1.0", "--version", "1.0.1", "--darwin-arm64", zip, "--dist", dist]);
  assert.equal(first.status, 0, first.stderr);
  const second = run(["--channel", "1.0", "--version", "1.0.1", "--darwin-amd64", intel, "--dist", dist]);
  assert.equal(second.status, 0, second.stderr);
  const channel = JSON.parse(await readFile(path.join(dist, "channels/1.0/manifest.json"), "utf8"));
  assert.ok(channel.assets["darwin-arm64"]);
  assert.ok(channel.assets["darwin-amd64"]);
});

test("refuses to publish 1.0.x onto the stable channel", () => {
  const result = run(["--channel", "stable", "--version", "1.0.1", "--darwin-arm64", "missing.zip"]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /channel stable requires version 0\.x\.y/);
});
