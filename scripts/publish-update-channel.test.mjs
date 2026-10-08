import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { generateSigningKey, keyIdOf, readBakedPublicKey, verifyManifest } from "./manifest-signing.mjs";

const script = fileURLToPath(new URL("./publish-update-channel.mjs", import.meta.url));

// Every test signs with a throwaway dev key and tells the script to trust it
// (--public-key), the way a dev build made with
// `-X main.appUpdateManifestPublicKey=...` would. The release key never
// leaves ~/.officedex-signing and is not needed here.
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
  const { privateKeyPem, publicKeyBase64 } = generateSigningKey();
  const keyFile = path.join(root, "dev-manifest-key.pem");
  await writeFile(keyFile, privateKeyPem, { mode: 0o600 });
  const keyArgs = ["--signing-key", keyFile, "--public-key", publicKeyBase64];
  return { root, zip, dist, keyFile, publicKey: publicKeyBase64, keyArgs };
}

function run(args, env = process.env) {
  // A developer's real signing key must never leak into these tests.
  const isolated = { ...env, OFFICEDEX_MANIFEST_SIGNING_KEY: path.join(os.tmpdir(), "officedex-publish-test-no-such-key.pem") };
  return spawnSync(process.execPath, [script, ...args], { encoding: "utf8", env: isolated });
}

async function readSigned(dir, publicKey) {
  const manifestText = await readFile(path.join(dir, "manifest.json"), "utf8");
  const sigText = await readFile(path.join(dir, "manifest.json.sig"), "utf8");
  verifyManifest(manifestText, sigText, publicKey);
  return { manifest: JSON.parse(manifestText), signature: JSON.parse(sigText) };
}

test("the legacy 1.0 channel writes channels/1.0 with a signature and leaves the root manifest alone", async () => {
  const { zip, dist, publicKey, keyArgs } = await setup();
  const result = run([
    "--channel", "1.0",
    "--version", "1.0.1",
    "--darwin-arm64", zip,
    "--dist", dist,
    "--target", "dist",
    ...keyArgs,
  ]);
  assert.equal(result.status, 0, result.stderr);
  const { manifest: channel, signature } = await readSigned(path.join(dist, "channels/1.0"), publicKey);
  assert.equal(channel.version, "1.0.1");
  assert.ok(channel.assets["darwin-arm64"]);
  assert.equal(channel.assets["darwin-amd64"], undefined);
  assert.equal(signature.keyId, keyIdOf(publicKey));
  // The archived copy carries its signature too.
  const archived = await readFile(path.join(dist, "channels/1.0/archive/manifest-v1.0.1.json"), "utf8");
  verifyManifest(archived, await readFile(path.join(dist, "channels/1.0/archive/manifest-v1.0.1.json.sig"), "utf8"), publicKey);
  const production = JSON.parse(await readFile(path.join(dist, "manifest.json"), "utf8"));
  assert.equal(production.version, "0.5.43");
  await assert.rejects(readFile(path.join(dist, "manifest.json.sig")), "stable manifest must stay untouched");
});

test("same version merges a second arch into the 1.0 manifest and re-signs it", async () => {
  const { root, zip, dist, publicKey, keyArgs } = await setup();
  const intel = path.join(root, "OfficeDex-v1.0.1-darwin-amd64.zip");
  await writeFile(intel, "intel-zip");
  const first = run(["--channel", "1.0", "--version", "1.0.1", "--darwin-arm64", zip, "--dist", dist, "--target", "dist", ...keyArgs]);
  assert.equal(first.status, 0, first.stderr);
  const second = run(["--channel", "1.0", "--version", "1.0.1", "--darwin-amd64", intel, "--dist", dist, "--target", "dist", ...keyArgs]);
  assert.equal(second.status, 0, second.stderr);
  const { manifest: channel } = await readSigned(path.join(dist, "channels/1.0"), publicKey);
  assert.ok(channel.assets["darwin-arm64"]);
  assert.ok(channel.assets["darwin-amd64"]);
});

test("--dry-run signs the manifest locally and uploads nothing", async () => {
  const { root, zip, dist, publicKey, keyArgs } = await setup();
  const outDir = path.join(root, "dry-run");
  const env = { ...process.env, OBS_ACCESS_KEY_ID: "", OBS_SECRET_ACCESS_KEY: "", OBS_CREDENTIALS_FILE: path.join(root, "missing.env") };
  const result = run(["--channel", "1.0", "--version", "1.0.1", "--darwin-arm64", zip, "--dist", dist, "--dry-run", "--out-dir", outDir, ...keyArgs], env);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Dry run: wrote .*manifest\.json and .*manifest\.json\.sig/);
  const { manifest, signature } = await readSigned(outDir, publicKey);
  assert.equal(manifest.version, "1.0.1");
  assert.match(manifest.assets["darwin-arm64"].url, /^https:\/\/aichatoffice-test\.obs\.cn-north-4\.myhuaweicloud\.com\/officedex\/releases\/download\/v1\.0\.1\//);
  assert.equal(manifest.assets["darwin-arm64"].sha256.length, 64);
  assert.equal(signature.format, "officedex-manifest-signature");
  assert.equal(signature.algorithm, "ed25519");
  // No credentials were needed and officedex-dist was not touched.
  await assert.rejects(readFile(path.join(dist, "channels/1.0/manifest.json"), "utf8"));
});

test("refuses to publish without a signing key, before writing anything", async () => {
  const { zip, dist, publicKey } = await setup();
  const result = run(["--channel", "1.0", "--version", "1.0.1", "--darwin-arm64", zip, "--dist", dist, "--target", "dist", "--public-key", publicKey]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /manifest signing key not found/);
  await assert.rejects(readFile(path.join(dist, "channels/1.0/manifest.json"), "utf8"));
});

test("refuses a signing key that clients do not trust", async () => {
  const { zip, dist, keyFile } = await setup();
  const other = generateSigningKey().publicKeyBase64;
  const result = run(["--channel", "1.0", "--version", "1.0.1", "--darwin-arm64", zip, "--dist", dist, "--target", "dist", "--signing-key", keyFile, "--public-key", other]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /does not match the key clients trust/);
  await assert.rejects(readFile(path.join(dist, "channels/1.0/manifest.json"), "utf8"));
});

test("without --public-key the trusted key is the one baked into app_update_channel.go", async () => {
  const { zip, dist, keyFile } = await setup();
  const baked = readBakedPublicKey();
  const result = run(["--channel", "1.0", "--version", "1.0.1", "--darwin-arm64", zip, "--dist", dist, "--target", "dist", "--signing-key", keyFile]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, new RegExp(`\\(${keyIdOf(baked)} from app_update_channel\\.go\\)`));
});

test("stable publishes a signed root manifest with GitHub Release asset URLs", async () => {
  const { zip, dist, publicKey, keyArgs } = await setup();
  const result = run(["--channel", "stable", "--version", "1.0.1", "--darwin-arm64", zip, "--dist", dist, ...keyArgs]);
  assert.equal(result.status, 0, result.stderr);
  const { manifest, signature } = await readSigned(dist, publicKey);
  assert.equal(manifest.version, "1.0.1");
  assert.equal(
    manifest.assets["darwin-arm64"].url,
    "https://github.com/officecli/officedex/releases/download/v1.0.1/OfficeDex-v1.0.1-darwin-arm64.zip",
  );
  assert.equal(signature.keyId, keyIdOf(publicKey));
  const archived = await readFile(path.join(dist, "archive/manifest-v1.0.1.json"), "utf8");
  verifyManifest(archived, await readFile(path.join(dist, "archive/manifest-v1.0.1.json.sig"), "utf8"), publicKey);
  // The legacy channel directory is never touched by a stable publish.
  await assert.rejects(readFile(path.join(dist, "channels/1.0/manifest.json"), "utf8"));
});

test("stable rejects a pre-release suffix", () => {
  const result = run(["--channel", "stable", "--version", "1.0.0-beta.1", "--darwin-arm64", "missing.zip"]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /channel stable requires a plain version x\.y\.z/);
});

test("1.0 publishes to OBS by default and stops before uploading without credentials", async () => {
  const { root, zip, dist, keyArgs } = await setup();
  const env = { ...process.env, OBS_ACCESS_KEY_ID: "", OBS_SECRET_ACCESS_KEY: "", OBS_CREDENTIALS_FILE: path.join(root, "missing.env") };
  const result = run(["--channel", "1.0", "--version", "1.0.1", "--darwin-arm64", zip, "--dist", dist, "--bridge-dist", ...keyArgs], env);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /OBS credentials not found/);
  // Nothing reached officedex-dist either: the bridge is written only after OBS succeeds.
  await assert.rejects(readFile(path.join(dist, "channels/1.0/manifest.json"), "utf8"));
});

test("--bridge-dist only applies to an OBS publish", async () => {
  const { zip, dist, keyArgs } = await setup();
  const result = run(["--channel", "1.0", "--version", "1.0.1", "--darwin-arm64", zip, "--dist", dist, "--target", "dist", "--bridge-dist", ...keyArgs]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /--bridge-dist only applies to --target obs/);
});

test("the stable channel is never published to OBS", async () => {
  const { zip, keyArgs } = await setup();
  const result = run(["--channel", "stable", "--version", "0.6.10", "--darwin-arm64", zip, "--target", "obs", ...keyArgs]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /not published to OBS/);
});
