#!/usr/bin/env node
/**
 * Minimal Huawei Cloud OBS client for the release scripts. No dependencies.
 *
 * OBS speaks the S3 protocol, and this uses its AWS-V2-compatible signature
 * (HMAC-SHA1 over the canonical request) because V2 needs no region, which is
 * what lets one credential list buckets before anyone knows where they live.
 *
 * Credentials come from the environment only: OBS_ACCESS_KEY_ID and
 * OBS_SECRET_ACCESS_KEY, or a file named by OBS_CREDENTIALS_FILE in KEY=VALUE
 * form (default ~/.officedex-signing/huawei-obs.env). Nothing here writes them
 * anywhere.
 *
 * CLI (for checking a bucket by hand):
 *   node scripts/obs-client.mjs buckets
 *   node scripts/obs-client.mjs probe <bucket> [region]
 */
import { createHash, createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const DEFAULT_OBS_REGION = "cn-north-4";

export function loadObsCredentials(env = process.env) {
  let accessKeyId = env.OBS_ACCESS_KEY_ID?.trim();
  let secretAccessKey = env.OBS_SECRET_ACCESS_KEY?.trim();
  if (!accessKeyId || !secretAccessKey) {
    const file = env.OBS_CREDENTIALS_FILE || path.join(os.homedir(), ".officedex-signing", "huawei-obs.env");
    let text = "";
    try {
      text = readFileSync(file, "utf8");
    } catch {
      throw new Error(`OBS credentials not found: set OBS_ACCESS_KEY_ID/OBS_SECRET_ACCESS_KEY or create ${file}`);
    }
    for (const line of text.split(/\r?\n/u)) {
      const match = /^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/u.exec(line);
      if (!match) continue;
      if (match[1] === "OBS_ACCESS_KEY_ID") accessKeyId ||= match[2];
      if (match[1] === "OBS_SECRET_ACCESS_KEY") secretAccessKey ||= match[2];
    }
  }
  if (!accessKeyId || !secretAccessKey) throw new Error("OBS credentials are incomplete");
  return { accessKeyId, secretAccessKey };
}

export function obsHost(region, bucket) {
  const base = `obs.${region}.myhuaweicloud.com`;
  return bucket ? `${bucket}.${base}` : base;
}

/** Public URL of an object, as an anonymous client would fetch it. */
export function obsObjectUrl({ bucket, region, key }) {
  return `https://${obsHost(region, bucket)}/${encodeKey(key)}`;
}

function encodeKey(key) {
  return key.split("/").map(encodeURIComponent).join("/");
}

/**
 * One signed request. `subresource` is a query such as "location" or "acl"
 * that takes part in the signature; `query` is anything else.
 */
export async function obsRequest(
  credentials,
  { method = "GET", region = DEFAULT_OBS_REGION, bucket, key = "", subresource = "", body, headers = {}, signal } = {},
) {
  const date = new Date().toUTCString();
  const all = { ...headers, Date: date };
  const lower = Object.fromEntries(Object.entries(all).map(([name, value]) => [name.toLowerCase(), String(value)]));
  const amz = Object.keys(lower)
    .filter((name) => name.startsWith("x-amz-"))
    .sort()
    .map((name) => `${name}:${lower[name].trim()}\n`)
    .join("");
  const resource = `/${bucket ? `${bucket}/` : ""}${bucket ? encodeKey(key) : ""}${subresource ? `?${subresource}` : ""}`;
  const stringToSign = [method, lower["content-md5"] ?? "", lower["content-type"] ?? "", date, `${amz}${resource}`].join("\n");
  const signature = createHmac("sha1", credentials.secretAccessKey).update(stringToSign, "utf8").digest("base64");
  const url = `https://${obsHost(region, bucket)}/${bucket ? encodeKey(key) : ""}${subresource ? `?${subresource}` : ""}`;
  const response = await fetch(url, {
    method,
    headers: { ...all, Authorization: `AWS ${credentials.accessKeyId}:${signature}` },
    body,
    signal,
    ...(body && typeof body !== "string" && !(body instanceof Uint8Array) ? { duplex: "half" } : {}),
  });
  return response;
}

async function expectOk(response, what) {
  if (response.ok) return response;
  const text = await response.text().catch(() => "");
  const code = /<Code>([^<]+)<\/Code>/u.exec(text)?.[1] ?? "";
  throw new Error(`${what} failed: HTTP ${response.status}${code ? ` ${code}` : ""}`);
}

export async function listBuckets(credentials, region = DEFAULT_OBS_REGION) {
  const response = await expectOk(await obsRequest(credentials, { region }), "list buckets");
  const xml = await response.text();
  return [...xml.matchAll(/<Bucket>([\s\S]*?)<\/Bucket>/gu)].map((match) => ({
    name: /<Name>([^<]+)<\/Name>/u.exec(match[1])?.[1] ?? "",
    location: /<(?:BucketLocation|Location)>([^<]*)<\//u.exec(match[1])?.[1] ?? "",
  }));
}

export async function bucketRegion(credentials, bucket, region = DEFAULT_OBS_REGION) {
  const response = await expectOk(await obsRequest(credentials, { region, bucket, subresource: "location" }), "get bucket location");
  const xml = await response.text();
  return /<Location[^>]*>([^<]*)<\/Location>/u.exec(xml)?.[1] || /<LocationConstraint[^>]*>([^<]*)</u.exec(xml)?.[1] || region;
}

/**
 * Uploads one object. `publicRead` sets the object ACL so anonymous clients —
 * the desktop updater sends no credentials — can download it. The bucket's own
 * listing stays private.
 */
export async function putObject(credentials, { bucket, region, key, body, contentType = "application/octet-stream", publicRead = true, cacheControl }) {
  const bytes = typeof body === "string" ? Buffer.from(body, "utf8") : body;
  const headers = {
    "Content-Type": contentType,
    "Content-MD5": createHash("md5").update(bytes).digest("base64"),
    "Content-Length": String(bytes.length),
    ...(publicRead ? { "x-amz-acl": "public-read" } : {}),
    ...(cacheControl ? { "Cache-Control": cacheControl } : {}),
  };
  await expectOk(await obsRequest(credentials, { method: "PUT", region, bucket, key, body: bytes, headers }), `put ${key}`);
}

export async function getObject(credentials, { bucket, region, key }) {
  const response = await expectOk(await obsRequest(credentials, { region, bucket, key }), `get ${key}`);
  return Buffer.from(await response.arrayBuffer());
}

export async function deleteObject(credentials, { bucket, region, key }) {
  await expectOk(await obsRequest(credentials, { method: "DELETE", region, bucket, key }), `delete ${key}`);
}

async function main(argv) {
  const [command, bucket, regionArg] = argv;
  const credentials = loadObsCredentials();
  if (command === "buckets") {
    for (const entry of await listBuckets(credentials)) console.log(`${entry.name}\t${entry.location}`);
    return;
  }
  if (command === "probe" && bucket) {
    const region = regionArg || (await bucketRegion(credentials, bucket));
    const key = `officedex-probe/${Date.now()}.txt`;
    const payload = `officedex obs probe ${new Date().toISOString()}\n`;
    await putObject(credentials, { bucket, region, key, body: payload, contentType: "text/plain" });
    console.log(`write:        ok (${key})`);
    const back = (await getObject(credentials, { bucket, region, key })).toString("utf8");
    console.log(`signed read:  ${back === payload ? "ok" : "MISMATCH"}`);
    const anonymous = await fetch(obsObjectUrl({ bucket, region, key }));
    const anonymousBody = anonymous.ok ? await anonymous.text() : "";
    console.log(`public read:  ${anonymous.ok && anonymousBody === payload ? "ok" : `HTTP ${anonymous.status}`} (${obsObjectUrl({ bucket, region, key })})`);
    const listing = await fetch(`https://${obsHost(region, bucket)}/`);
    console.log(`public list:  HTTP ${listing.status}${listing.ok ? " (bucket listing is PUBLIC)" : " (private, good)"}`);
    await deleteObject(credentials, { bucket, region, key });
    console.log("delete:       ok");
    return;
  }
  console.error("usage: obs-client.mjs buckets | probe <bucket> [region]");
  process.exitCode = 2;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
