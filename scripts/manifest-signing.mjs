#!/usr/bin/env node
// Ed25519 signing of OfficeDex auto-update manifests.
//
// The desktop updater (internal/appupdate/signature.go) only accepts a
// manifest whose detached signature at <manifest>.sig verifies under the
// public key baked into the binary (app_update_channel.go). This module is
// the writing half: it signs the exact bytes that get uploaded and checks the
// result against the baked key before anything is published.
//
// The private key never enters the repository. It lives in
// ~/.officedex-signing/manifest-signing-key.pem (PKCS#8 PEM) or wherever
// OFFICEDEX_MANIFEST_SIGNING_KEY points.
//
// CLI:
//   node scripts/manifest-signing.mjs keygen [--out <pem>] [--force]
//   node scripts/manifest-signing.mjs pubkey [--key <pem>]
//   node scripts/manifest-signing.mjs sign --in manifest.json [--key <pem>] [--out manifest.json.sig]
//   node scripts/manifest-signing.mjs verify --in manifest.json --sig manifest.json.sig [--public-key <base64>]
//
// Signature file (JSON, mirrored by appupdate.SignatureFile):
//   { "format": "officedex-manifest-signature", "version": 1,
//     "algorithm": "ed25519", "keyId": "<16 hex>", "signature": "<base64>" }

import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign as cryptoSign, verify as cryptoVerify } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const SIGNATURE_FORMAT = "officedex-manifest-signature";
export const SIGNATURE_VERSION = 1;
export const SIGNATURE_ALGORITHM = "ed25519";
export const SIGNATURE_SUFFIX = ".sig";
export const SIGNING_KEY_ENV = "OFFICEDEX_MANIFEST_SIGNING_KEY";
export const DEFAULT_SIGNING_KEY_PATH = path.join(os.homedir(), ".officedex-signing", "manifest-signing-key.pem");

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const GO_CHANNEL_FILE = path.resolve(HERE, "..", "app_update_channel.go");
const GO_PUBLIC_KEY_RE = /releaseManifestPublicKey\s*=\s*"([^"]*)"/u;

// DER prefix of a SubjectPublicKeyInfo for an Ed25519 key; the raw 32-byte
// key follows it. Lets us round-trip between Node KeyObjects and the bare
// base64 key Go embeds.
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

export function generateSigningKey() {
  const { privateKey } = generateKeyPairSync("ed25519");
  return {
    privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }),
    publicKeyBase64: publicKeyBase64Of(privateKey),
  };
}

/** Raw 32-byte public key (base64) of a private or public KeyObject. */
export function publicKeyBase64Of(key) {
  const pub = key.type === "private" ? createPublicKey(key) : key;
  if (pub.asymmetricKeyType !== "ed25519") throw new Error(`expected an ed25519 key, got ${pub.asymmetricKeyType}`);
  const der = pub.export({ type: "spki", format: "der" });
  return der.subarray(der.length - 32).toString("base64");
}

export function publicKeyFromBase64(encoded) {
  const raw = Buffer.from(String(encoded ?? "").trim(), "base64");
  if (raw.length !== 32) throw new Error(`manifest public key must be 32 bytes, got ${raw.length}`);
  return createPublicKey({ key: Buffer.concat([ED25519_SPKI_PREFIX, raw]), format: "der", type: "spki" });
}

/** First 8 bytes of SHA-256(raw public key), hex; same as appupdate.KeyID. */
export function keyIdOf(publicKeyBase64) {
  const raw = Buffer.from(String(publicKeyBase64).trim(), "base64");
  if (raw.length !== 32) throw new Error(`manifest public key must be 32 bytes, got ${raw.length}`);
  return createHash("sha256").update(raw).digest("hex").slice(0, 16);
}

export function signingKeyPath(env = process.env) {
  return env[SIGNING_KEY_ENV]?.trim() || DEFAULT_SIGNING_KEY_PATH;
}

export function loadSigningKey({ env = process.env, file } = {}) {
  const keyPath = file || signingKeyPath(env);
  let pem;
  try {
    pem = readFileSync(keyPath, "utf8");
  } catch {
    throw new Error(`manifest signing key not found at ${keyPath}; run \`node scripts/manifest-signing.mjs keygen\` or set ${SIGNING_KEY_ENV}`);
  }
  const key = createPrivateKey(pem);
  if (key.asymmetricKeyType !== "ed25519") throw new Error(`${keyPath} is not an ed25519 key`);
  return key;
}

export function signManifest(manifestBytes, privateKey) {
  const bytes = typeof manifestBytes === "string" ? Buffer.from(manifestBytes, "utf8") : manifestBytes;
  const signature = cryptoSign(null, bytes, privateKey);
  const file = {
    format: SIGNATURE_FORMAT,
    version: SIGNATURE_VERSION,
    algorithm: SIGNATURE_ALGORITHM,
    keyId: keyIdOf(publicKeyBase64Of(privateKey)),
    signature: signature.toString("base64"),
  };
  return `${JSON.stringify(file, null, 2)}\n`;
}

/** Throws unless sigFileText is a valid signature of manifestBytes under publicKeyBase64. */
export function verifyManifest(manifestBytes, sigFileText, publicKeyBase64) {
  const bytes = typeof manifestBytes === "string" ? Buffer.from(manifestBytes, "utf8") : manifestBytes;
  let parsed;
  try {
    parsed = JSON.parse(String(sigFileText));
  } catch (error) {
    throw new Error(`signature file is not JSON: ${error.message}`);
  }
  if (parsed.format !== SIGNATURE_FORMAT) throw new Error(`signature format ${JSON.stringify(parsed.format)} is not ${SIGNATURE_FORMAT}`);
  if (parsed.version !== SIGNATURE_VERSION) throw new Error(`signature version ${parsed.version} is not ${SIGNATURE_VERSION}`);
  if (String(parsed.algorithm).toLowerCase() !== SIGNATURE_ALGORITHM) throw new Error(`signature algorithm ${parsed.algorithm} is not ${SIGNATURE_ALGORITHM}`);
  const expectedKeyId = keyIdOf(publicKeyBase64);
  if (parsed.keyId && parsed.keyId !== expectedKeyId) {
    throw new Error(`manifest is signed with key ${parsed.keyId}, but the client trusts ${expectedKeyId}`);
  }
  const signature = Buffer.from(String(parsed.signature ?? ""), "base64");
  if (signature.length !== 64) throw new Error(`signature is ${signature.length} bytes, want 64`);
  if (!cryptoVerify(null, bytes, publicKeyFromBase64(publicKeyBase64), signature)) {
    throw new Error("manifest signature does not verify");
  }
  return true;
}

/** The public key baked into app_update_channel.go, from its source text. */
export function bakedPublicKeyFromSource(goSource) {
  const match = GO_PUBLIC_KEY_RE.exec(goSource);
  if (!match) throw new Error("releaseManifestPublicKey not found in app_update_channel.go");
  const key = match[1].trim();
  keyIdOf(key); // validates length
  return key;
}

export function readBakedPublicKey(file = GO_CHANNEL_FILE) {
  return bakedPublicKeyFromSource(readFileSync(file, "utf8"));
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) {
      args._.push(a);
      continue;
    }
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) {
      args[key] = true;
    } else {
      args[key] = next;
      i++;
    }
  }
  return args;
}

function main(argv) {
  const args = parseArgs(argv);
  const [command] = args._;
  if (command === "keygen") {
    const out = args.out ? path.resolve(String(args.out)) : DEFAULT_SIGNING_KEY_PATH;
    if (existsSync(out) && !args.force) {
      throw new Error(`${out} already exists; pass --force to overwrite (clients trusting the old key will stop updating)`);
    }
    const { privateKeyPem, publicKeyBase64 } = generateSigningKey();
    mkdirSync(path.dirname(out), { recursive: true, mode: 0o700 });
    writeFileSync(out, privateKeyPem, { mode: 0o600 });
    writeFileSync(`${out}.pub`, `${publicKeyBase64}\n`, { mode: 0o644 });
    console.log(`private key: ${out}`);
    console.log(`public key:  ${publicKeyBase64}`);
    console.log(`key id:      ${keyIdOf(publicKeyBase64)}`);
    console.log("Bake the public key into releaseManifestPublicKey in app_update_channel.go.");
    return;
  }
  if (command === "pubkey") {
    const key = loadSigningKey({ file: args.key ? String(args.key) : undefined });
    const pub = publicKeyBase64Of(key);
    console.log(pub);
    console.error(`key id: ${keyIdOf(pub)}`);
    return;
  }
  if (command === "sign") {
    if (!args.in) throw new Error("sign needs --in <manifest.json>");
    const input = path.resolve(String(args.in));
    const key = loadSigningKey({ file: args.key ? String(args.key) : undefined });
    const sig = signManifest(readFileSync(input), key);
    const out = args.out ? path.resolve(String(args.out)) : `${input}${SIGNATURE_SUFFIX}`;
    writeFileSync(out, sig);
    console.log(`wrote ${out} (key id ${keyIdOf(publicKeyBase64Of(key))})`);
    return;
  }
  if (command === "verify") {
    if (!args.in || !args.sig) throw new Error("verify needs --in <manifest.json> --sig <manifest.json.sig>");
    const publicKey = args["public-key"] ? String(args["public-key"]) : readBakedPublicKey();
    verifyManifest(readFileSync(path.resolve(String(args.in))), readFileSync(path.resolve(String(args.sig)), "utf8"), publicKey);
    console.log(`ok (key id ${keyIdOf(publicKey)})`);
    return;
  }
  console.error("usage: manifest-signing.mjs keygen [--out pem] [--force] | pubkey [--key pem] | sign --in manifest.json [--key pem] [--out sig] | verify --in manifest.json --sig file [--public-key b64]");
  process.exitCode = 2;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
