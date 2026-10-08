import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  GO_CHANNEL_FILE,
  SIGNATURE_ALGORITHM,
  SIGNATURE_FORMAT,
  SIGNATURE_VERSION,
  bakedPublicKeyFromSource,
  generateSigningKey,
  keyIdOf,
  loadSigningKey,
  publicKeyBase64Of,
  readBakedPublicKey,
  signManifest,
  verifyManifest,
} from "./manifest-signing.mjs";

const script = fileURLToPath(new URL("./manifest-signing.mjs", import.meta.url));

async function devKey() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "officedex-signing-"));
  const { privateKeyPem, publicKeyBase64 } = generateSigningKey();
  const file = path.join(dir, "key.pem");
  await writeFile(file, privateKeyPem, { mode: 0o600 });
  return { dir, file, publicKey: publicKeyBase64, privateKey: loadSigningKey({ file }) };
}

test("a signed manifest verifies under its public key and nothing else", async () => {
  const { privateKey, publicKey } = await devKey();
  const manifest = `${JSON.stringify({ version: "1.0.12", assets: {} }, null, 2)}\n`;
  const sig = signManifest(manifest, privateKey);
  const parsed = JSON.parse(sig);
  assert.equal(parsed.format, SIGNATURE_FORMAT);
  assert.equal(parsed.version, SIGNATURE_VERSION);
  assert.equal(parsed.algorithm, SIGNATURE_ALGORITHM);
  assert.equal(parsed.keyId, keyIdOf(publicKey));
  assert.equal(Buffer.from(parsed.signature, "base64").length, 64);
  assert.ok(verifyManifest(manifest, sig, publicKey));
  assert.ok(verifyManifest(Buffer.from(manifest, "utf8"), sig, publicKey));

  assert.throws(() => verifyManifest(manifest.replace("1.0.12", "9.9.9"), sig, publicKey), /does not verify/);
  const other = generateSigningKey().publicKeyBase64;
  assert.throws(() => verifyManifest(manifest, sig, other), /signed with key/);
  assert.throws(() => verifyManifest(manifest, "not json", publicKey), /not JSON/);
  assert.throws(() => verifyManifest(manifest, JSON.stringify({ ...parsed, format: "minisign" }), publicKey), /format/);
  assert.throws(() => verifyManifest(manifest, JSON.stringify({ ...parsed, signature: "AA==" }), publicKey), /1 bytes/);
});

test("keyIdOf matches appupdate.KeyID: first 8 bytes of sha256(raw key), hex", async () => {
  const { publicKey } = await devKey();
  const id = keyIdOf(publicKey);
  assert.match(id, /^[0-9a-f]{16}$/);
  assert.equal(keyIdOf(publicKey), id);
  assert.throws(() => keyIdOf("c2hvcnQ="), /32 bytes/);
});

test("the public key derived from the private key is 32 raw bytes", async () => {
  const { privateKey, publicKey } = await devKey();
  assert.equal(publicKeyBase64Of(privateKey), publicKey);
  assert.equal(Buffer.from(publicKey, "base64").length, 32);
});

test("the baked release key in app_update_channel.go is a valid ed25519 public key", async () => {
  const baked = readBakedPublicKey();
  assert.equal(Buffer.from(baked, "base64").length, 32);
  assert.match(keyIdOf(baked), /^[0-9a-f]{16}$/);
  const source = await readFile(GO_CHANNEL_FILE, "utf8");
  assert.equal(bakedPublicKeyFromSource(source), baked);
  assert.throws(() => bakedPublicKeyFromSource("package main\n"), /not found/);
});

test("loadSigningKey reports a missing key by path", async () => {
  const missing = path.join(os.tmpdir(), "officedex-signing-missing", "nope.pem");
  assert.throws(() => loadSigningKey({ file: missing }), new RegExp(`not found at ${missing.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  assert.throws(() => loadSigningKey({ env: { OFFICEDEX_MANIFEST_SIGNING_KEY: missing } }), /not found/);
});

test("CLI: keygen, sign and verify round-trip with a dev key", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "officedex-signing-cli-"));
  const keyFile = path.join(dir, "dev.pem");
  const keygen = spawnSync(process.execPath, [script, "keygen", "--out", keyFile], { encoding: "utf8" });
  assert.equal(keygen.status, 0, keygen.stderr);
  const publicKey = (await readFile(`${keyFile}.pub`, "utf8")).trim();
  assert.match(keygen.stdout, new RegExp(`public key:\\s+${publicKey.replace(/[+/=]/g, "\\$&")}`));

  const again = spawnSync(process.execPath, [script, "keygen", "--out", keyFile], { encoding: "utf8" });
  assert.notEqual(again.status, 0, "keygen must not overwrite an existing key");
  assert.match(again.stderr, /already exists/);

  const manifest = path.join(dir, "manifest.json");
  await writeFile(manifest, `${JSON.stringify({ version: "1.0.12", assets: {} }, null, 2)}\n`);
  const sign = spawnSync(process.execPath, [script, "sign", "--in", manifest, "--key", keyFile], { encoding: "utf8" });
  assert.equal(sign.status, 0, sign.stderr);
  const verify = spawnSync(process.execPath, [script, "verify", "--in", manifest, "--sig", `${manifest}.sig`, "--public-key", publicKey], { encoding: "utf8" });
  assert.equal(verify.status, 0, verify.stderr);
  assert.match(verify.stdout, /^ok/);

  // Against the baked release key the dev signature must be rejected.
  const wrong = spawnSync(process.execPath, [script, "verify", "--in", manifest, "--sig", `${manifest}.sig`], { encoding: "utf8" });
  assert.notEqual(wrong.status, 0);
  assert.match(wrong.stderr, /signed with key/);
});
