#!/usr/bin/env node
// Notarizes a .dmg or .zip through a relay host instead of uploading to Apple
// from this Mac. The Mac talks to the Notary REST API (JWT signed here with the
// App Store Connect .p8, which never leaves this machine), ships the file to
// the relay over ssh, and the relay streams it into the submission's S3 object
// with the temporary credentials Apple issued. Status polling and stapling
// still happen here. No dependencies beyond Node >= 20, ssh and python3 on the
// relay.
//
// Why: from Beijing, notarytool's upload to Apple's S3 bucket crawls at
// ~0.4 MB/s; a US host with a fast path to us-west-2 does it in seconds, and
// the Mac -> relay hop runs several times faster than the Mac -> Apple one.
//
// Usage:
//   node scripts/notarize-relay.mjs submit <file.dmg|file.zip> [--staple <path>] [--no-wait] [--direct]
//   node scripts/notarize-relay.mjs status <submission-id>
//   node scripts/notarize-relay.mjs log <submission-id>
//   node scripts/notarize-relay.mjs probe-local <file> --mb 64 [--proxy host:port]
//   node scripts/notarize-relay.mjs probe-remote <file-on-relay> --mb 64
//   node scripts/notarize-relay.mjs jwt                      # print a 15-minute token
//
// Environment:
//   NOTARIZE_API_KEY_PATH / NOTARIZE_API_KEY_ID / NOTARIZE_API_ISSUER  (required)
//   NOTARIZE_RELAY_HOST       ssh destination of the relay (e.g. officedex-us);
//                             unset (or --direct) uploads straight from this Mac
//                             with the same multipart uploader, bypassing notarytool
//   NOTARIZE_RELAY_DIR        remote scratch dir (default: notarize-relay, in $HOME)
//   NOTARIZE_RELAY_PARALLEL   parallel S3 streams on the relay (default 8)
//   NOTARIZE_RELAY_PART_MB    multipart part size (default 16)
//   NOTARIZE_RELAY_TRANSFER   rsync | scp (default: rsync if installed)
//   NOTARIZE_RELAY_VIA        ssh (default: rsync/scp straight to the relay) or obs
//                             (Mac -> Huawei OBS -> relay pulls it with a presigned URL)
//   NOTARIZE_RELAY_OBS_BUCKET / NOTARIZE_RELAY_OBS_REGION   for VIA=obs
//                             (credentials: OBS_* env or ~/.officedex-signing/huawei-obs.env)
//   NOTARIZE_RELAY_KEEP=1     leave the file on the relay afterwards
//   NOTARIZE_RELAY_TIMEOUT    minutes to wait for Apple's verdict (default 60)

import { createHash, createPrivateKey, sign as cryptoSign } from "node:crypto";
import { OBS_BUCKET, OBS_REGION } from "./update-channel.mjs";
import { execFileSync, spawnSync } from "node:child_process";
import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const API = "https://appstoreconnect.apple.com/notary/v2";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const UPLOADER = path.join(HERE, "notarize-relay-upload.py");

export function relayConfig(env = process.env) {
  return {
    keyPath: env.NOTARIZE_API_KEY_PATH || "",
    keyId: env.NOTARIZE_API_KEY_ID || "",
    issuer: env.NOTARIZE_API_ISSUER || "",
    host: env.NOTARIZE_RELAY_HOST || "",
    dir: env.NOTARIZE_RELAY_DIR || "notarize-relay",
    parallel: Number(env.NOTARIZE_RELAY_PARALLEL || 8),
    partMb: Number(env.NOTARIZE_RELAY_PART_MB || 16),
    transfer: env.NOTARIZE_RELAY_TRANSFER || "",
    keep: env.NOTARIZE_RELAY_KEEP === "1",
    timeoutMin: Number(env.NOTARIZE_RELAY_TIMEOUT || 60),
    via: env.NOTARIZE_RELAY_VIA || "ssh",
    obsBucket: env.NOTARIZE_RELAY_OBS_BUCKET || OBS_BUCKET,
    obsRegion: env.NOTARIZE_RELAY_OBS_REGION || OBS_REGION,
  };
}

function log(msg) {
  console.log(`[relay] ${msg}`);
}

function fmtRate(bytes, seconds) {
  const mb = bytes / 1048576;
  return `${mb.toFixed(1)} MB in ${seconds.toFixed(1)}s = ${(mb / seconds).toFixed(2)} MB/s`;
}

// --- Notary API -------------------------------------------------------------

function base64url(buf) {
  return Buffer.from(buf).toString("base64").replace(/=+$/u, "").replace(/\+/gu, "-").replace(/\//gu, "_");
}

export function signJwt(cfg, ttlSeconds = 15 * 60) {
  const key = createPrivateKey(readFileSync(cfg.keyPath, "utf8"));
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "ES256", kid: cfg.keyId, typ: "JWT" }));
  const payload = base64url(
    JSON.stringify({ iss: cfg.issuer, iat: now, exp: now + ttlSeconds, aud: "appstoreconnect-v1" }),
  );
  const sig = cryptoSign("sha256", Buffer.from(`${header}.${payload}`), { key, dsaEncoding: "ieee-p1363" });
  return `${header}.${payload}.${base64url(sig)}`;
}

class NotaryApi {
  constructor(cfg) {
    this.cfg = cfg;
    this.token = null;
    this.tokenAt = 0;
  }

  bearer() {
    // Apple caps tokens at 20 minutes; re-sign well before that.
    if (!this.token || Date.now() - this.tokenAt > 10 * 60 * 1000) {
      this.token = signJwt(this.cfg);
      this.tokenAt = Date.now();
    }
    return this.token;
  }

  async request(method, route, body) {
    const response = await fetch(`${API}${route}`, {
      method,
      headers: {
        authorization: `Bearer ${this.bearer()}`,
        accept: "application/json",
        ...(body ? { "content-type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`${method} ${route} -> HTTP ${response.status}: ${text.slice(0, 500)}`);
    }
    return JSON.parse(text);
  }

  async createSubmission(name, sha256) {
    const { data } = await this.request("POST", "/submissions", { submissionName: name, sha256 });
    const a = data.attributes;
    return {
      id: data.id,
      creds: {
        awsAccessKeyId: a.awsAccessKeyId,
        awsSecretAccessKey: a.awsSecretAccessKey,
        awsSessionToken: a.awsSessionToken,
        bucket: a.bucket,
        object: a.object,
        region: "us-west-2",
      },
    };
  }

  async status(id) {
    const { data } = await this.request("GET", `/submissions/${id}`);
    return data.attributes;
  }

  async logUrl(id) {
    const { data } = await this.request("GET", `/submissions/${id}/logs`);
    return data.attributes.developerLogUrl;
  }

  async waitForVerdict(id, timeoutMin) {
    const deadline = Date.now() + timeoutMin * 60 * 1000;
    let last = "";
    while (Date.now() < deadline) {
      const { status } = await this.status(id);
      if (status !== last) {
        log(`submission ${id}: ${status}`);
        last = status;
      }
      if (status !== "In Progress") return status;
      await new Promise((r) => setTimeout(r, 15_000));
    }
    throw new Error(`submission ${id} still In Progress after ${timeoutMin} minutes`);
  }
}

// --- helpers ----------------------------------------------------------------

function sha256File(file) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    createReadStream(file).on("data", (c) => hash.update(c)).on("end", () => resolve(hash.digest("hex"))).on("error", reject);
  });
}

function fileSize(file) {
  return statSync(file).size;
}

function has(cmd) {
  return spawnSync("which", [cmd]).status === 0;
}

function runUploader({ cfg, creds, remote, file, probeMb = 0, proxy = "" }) {
  const args = [
    "--file", file,
    "--parallel", String(cfg.parallel),
    "--part-mb", String(cfg.partMb),
    "--json",
  ];
  if (probeMb) args.push("--probe-mb", String(probeMb));
  if (proxy) args.push("--proxy", proxy);
  const cmd = remote
    ? ["ssh", [cfg.host, "python3", `${cfg.dir}/notarize-relay-upload.py`, ...args]]
    : ["python3", ["-I", UPLOADER, ...args]];
  // Credentials go over stdin: never in argv, never in a file on the relay.
  const result = spawnSync(cmd[0], cmd[1], {
    input: JSON.stringify(creds),
    stdio: ["pipe", "pipe", "inherit"],
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(`uploader exited ${result.status}${result.stdout ? `: ${result.stdout}` : ""}`);
  }
  const line = result.stdout.trim().split("\n").pop();
  return JSON.parse(line);
}

function stageUploader(cfg) {
  execFileSync("ssh", [cfg.host, "mkdir", "-p", cfg.dir], { stdio: "inherit" });
  execFileSync("scp", ["-q", UPLOADER, `${cfg.host}:${cfg.dir}/notarize-relay-upload.py`], { stdio: "inherit" });
}

function transferToRelay(cfg, file, remoteName) {
  const dest = `${cfg.host}:${cfg.dir}/${remoteName}`;
  const mode = cfg.transfer || (has("rsync") ? "rsync" : "scp");
  const t0 = Date.now();
  if (mode === "rsync") {
    // --partial --inplace: a retry after a dropped connection resumes instead
    // of starting over. No -z: the payload is already compressed.
    execFileSync("rsync", ["--partial", "--inplace", "--info=progress2", "-e", "ssh -o Compression=no", file, dest], { stdio: "inherit" });
  } else {
    execFileSync("scp", ["-o", "Compression=no", file, dest], { stdio: "inherit" });
  }
  return (Date.now() - t0) / 1000;
}

/**
 * Route via Huawei OBS: the Mac pushes to OBS (cn-north-4 is a domestic hop
 * and fast), the relay pulls with a presigned URL that lives 30 minutes, and
 * the object is deleted afterwards. OBS credentials never leave this machine;
 * the relay only ever sees the one-off URL, handed over on stdin.
 */
async function transferViaObs(cfg, file, remoteName) {
  const obs = await import("./obs-client.mjs");
  const creds = obs.loadObsCredentials();
  const key = `notarize-relay/${Date.now()}-${remoteName}`;
  const target = { bucket: cfg.obsBucket, region: cfg.obsRegion, key };
  const timings = {};
  let t0 = Date.now();
  await obs.putObject(creds, { ...target, body: readFileSync(file), publicRead: false });
  timings.obsPutSec = (Date.now() - t0) / 1000;
  log(`Mac -> OBS: ${fmtRate(fileSize(file), timings.obsPutSec)}`);
  try {
    const url = obs.presignGetUrl(creds, { ...target, expiresSeconds: 1800 });
    t0 = Date.now();
    const result = spawnSync(
      "ssh",
      [cfg.host, "sh", "-c", `'IFS= read -r u; curl -sSf --retry 3 -o "${cfg.dir}/${remoteName}" "$u"'`],
      { input: `${url}\n`, stdio: ["pipe", "inherit", "inherit"] },
    );
    if (result.status !== 0) throw new Error(`relay could not fetch from OBS (exit ${result.status})`);
    timings.obsGetSec = (Date.now() - t0) / 1000;
    log(`OBS -> ${cfg.host}: ${fmtRate(fileSize(file), timings.obsGetSec)}`);
  } finally {
    await obs.deleteObject(creds, target).catch((error) => log(`WARNING: could not delete OBS object ${key}: ${error.message}`));
  }
  return timings;
}

function requireApiKey(cfg) {
  if (!cfg.keyPath || !cfg.keyId || !cfg.issuer) {
    throw new Error("NOTARIZE_API_KEY_PATH, NOTARIZE_API_KEY_ID and NOTARIZE_API_ISSUER are required");
  }
  if (!existsSync(cfg.keyPath)) throw new Error(`API key not found: ${cfg.keyPath}`);
}

function requireHost(cfg) {
  if (!cfg.host) throw new Error("NOTARIZE_RELAY_HOST is required (ssh destination of the relay)");
}

// --- commands ---------------------------------------------------------------

/**
 * Full relay: Mac -> relay -> Apple S3, then poll until Apple has a verdict.
 * Returns { id, status, timings }. Throws if the verdict is not Accepted.
 */
export async function relayNotarize(file, { cfg = relayConfig(), wait = true, direct = !cfg.host } = {}) {
  requireApiKey(cfg);
  if (!direct) requireHost(cfg);
  if (!existsSync(file)) throw new Error(`no such file: ${file}`);
  const api = new NotaryApi(cfg);
  const name = path.basename(file);
  const size = fileSize(file);
  const timings = { mode: direct ? "direct" : "relay" };

  log(`hashing ${name} (${(size / 1048576).toFixed(1)} MB)`);
  let t0 = Date.now();
  const sha256 = await sha256File(file);
  timings.hashSec = (Date.now() - t0) / 1000;

  if (!direct) {
    log(`staging uploader on ${cfg.host}`);
    stageUploader(cfg);
    const t1 = Date.now();
    if (cfg.via === "obs") {
      Object.assign(timings, await transferViaObs(cfg, file, name));
    } else {
      log(`transferring to ${cfg.host}:${cfg.dir}/${name}`);
      transferToRelay(cfg, file, name);
    }
    timings.transferSec = (Date.now() - t1) / 1000;
    log(`Mac -> relay (${cfg.via}): ${fmtRate(size, timings.transferSec)}`);
  }

  // Create the submission only now so the temporary S3 credentials are fresh.
  log("creating submission");
  const { id, creds } = await api.createSubmission(name, sha256);
  log(`submission ${id} -> s3://${creds.bucket}/${creds.object}`);

  const from = direct ? "this machine" : cfg.host;
  log(`uploading from ${from} (${cfg.parallel} streams)`);
  t0 = Date.now();
  const up = runUploader({ cfg, creds, remote: !direct, file: direct ? file : `${cfg.dir}/${name}` });
  timings.uploadSec = (Date.now() - t0) / 1000;
  timings.uploadMbps = up.mb_per_s;
  log(`${from} -> Apple S3: ${fmtRate(up.bytes, up.seconds)} (wall incl. ssh: ${timings.uploadSec.toFixed(1)}s)`);

  if (!direct && !cfg.keep) {
    execFileSync("ssh", [cfg.host, "rm", "-f", `${cfg.dir}/${name}`]);
  }

  let status = "In Progress";
  if (wait) {
    t0 = Date.now();
    status = await api.waitForVerdict(id, cfg.timeoutMin);
    timings.verdictSec = (Date.now() - t0) / 1000;
    if (status !== "Accepted") {
      let why = "";
      try {
        const url = await api.logUrl(id);
        why = await (await fetch(url)).text();
      } catch (error) {
        why = `(could not fetch log: ${error.message})`;
      }
      console.error(why);
      const error = new Error(`submission ${id} ended as ${status}`);
      error.verdict = status; // Apple's answer, not a transport problem: do not retry elsewhere
      throw error;
    }
  }
  log(`timings: ${JSON.stringify(timings)}`);
  return { id, status, timings };
}

async function main(argv) {
  const [command, target, ...rest] = argv;
  const opt = (flag) => {
    const i = rest.indexOf(flag);
    return i >= 0 ? rest[i + 1] : undefined;
  };
  const cfg = relayConfig();

  switch (command) {
    case "jwt": {
      requireApiKey(cfg);
      process.stdout.write(signJwt(cfg) + "\n");
      return;
    }
    case "status": {
      requireApiKey(cfg);
      console.log(JSON.stringify(await new NotaryApi(cfg).status(target), null, 2));
      return;
    }
    case "log": {
      requireApiKey(cfg);
      const url = await new NotaryApi(cfg).logUrl(target);
      process.stdout.write(await (await fetch(url)).text());
      return;
    }
    case "submit": {
      const { id, status } = await relayNotarize(target, {
        cfg,
        wait: !rest.includes("--no-wait"),
        direct: rest.includes("--direct") || !cfg.host,
      });
      const staple = opt("--staple");
      if (staple && status === "Accepted") {
        execFileSync("xcrun", ["stapler", "staple", staple], { stdio: "inherit" });
      }
      console.log(JSON.stringify({ id, status }));
      return;
    }
    case "probe-local":
    case "probe-remote": {
      // Bandwidth probes: a real submission, a partial multipart upload,
      // then abort. Apple never receives an object for it.
      requireApiKey(cfg);
      const remote = command === "probe-remote";
      if (remote) requireHost(cfg);
      const mb = Number(opt("--mb") || 64);
      const api = new NotaryApi(cfg);
      const name = `probe-${path.basename(target)}`;
      const { id, creds } = await api.createSubmission(name, "0".repeat(64));
      log(`probe submission ${id} -> s3://${creds.bucket}/${creds.object}`);
      if (remote) stageUploader(cfg);
      const res = runUploader({ cfg, creds, remote, file: target, probeMb: mb, proxy: opt("--proxy") || "" });
      console.log(JSON.stringify({ id, ...res }));
      return;
    }
    default:
      console.error("usage: notarize-relay.mjs <submit|status|log|probe-local|probe-remote|jwt> ...");
      process.exit(2);
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.stack : String(error));
    process.exitCode = 1;
  });
}
