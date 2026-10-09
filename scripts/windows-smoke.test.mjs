import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { extraScrubPatterns, fatalVerifyRuntimeLines, scrubManifest, scrubSensitive, smokeEnvironment, smokePath } from "./windows-smoke.mjs";

// Hosts and ids are assembled from parts so that this file does not itself
// carry what the scrubber exists to keep out of the public tree.
const host = (...parts) => parts.join(".");
const ticket = (key, n) => `${key}-${n}`;

test("scrubSensitive removes internal hosts, tokens, tickets, private IPs and user names from paths", () => {
  const input = [
    `registry https://${host("registry", "npm", "example", "shimo", "run")}/ and ${host("git", "shimo", "im")} and build-box-07`,
    "clone https://x-access-token:ghp_abcdefghijklmnopqrstuvwxyz0123@github.com/org/repo.git",
    "Authorization: Bearer abcdefghijklmnopqrstuvwxyz",
    `fix(deps): ${ticket("TRACKERKEY", 3300)} restore lock`,
    "proxy 10.1.2.3 and 192.168.0.9 and 172.16.5.5, public 8.8.8.8 stays",
    "/Users/testuser/Workspace/x and /home/qa/src and C:\\Users\\testuser\\AppData\\Roaming\\officedex",
  ].join("\n");
  const out = scrubSensitive(input, { extra: [/\bbuild-box-\d+/g] });
  assert.doesNotMatch(out, /shimo/);
  assert.doesNotMatch(out, /build-box/);
  assert.doesNotMatch(out, /ghp_/);
  assert.doesNotMatch(out, /x-access-token:/);
  assert.doesNotMatch(out, /abcdefghijklmnopqrstuvwxyz/);
  assert.doesNotMatch(out, /TRACKERKEY-/);
  assert.doesNotMatch(out, /10\.1\.2\.3|192\.168\.0\.9|172\.16\.5\.5/);
  assert.match(out, /8\.8\.8\.8 stays/);
  assert.doesNotMatch(out, /testuser|\bqa\b/);
  assert.match(out, /\/Users\/\[user\]\/Workspace\/x/);
  assert.match(out, /C:\\Users\\\[user\]\\AppData/);
});

test("extra patterns come from the environment, not from this tree", () => {
  const patterns = extraScrubPatterns({ OFFICEDEX_SCRUB_PATTERNS: "corp-vm-\\d+, \\bintranet\\b\n" });
  assert.equal(patterns.length, 2);
  assert.equal(scrubSensitive("corp-vm-12 on intranet", { extra: patterns }), "[redacted] on [redacted]");
  assert.deepEqual(extraScrubPatterns({}), []);
});

test("scrubManifest drops the presentation tree's source provenance and keeps what the tree is", () => {
  const scrubbed = scrubManifest("presentation", {
    name: "officedex-presentation-runtime",
    platform: "win32",
    arch: "x64",
    source: "/Users/testuser/Workspace/presentation",
    sourceRepository: `${host("git", "shimo", "im")}/x/presentation`,
    sourceRevision: "abc123",
    sourceDirty: false,
    converter: "tools/bin/mop-convert.exe",
  });
  assert.deepEqual(scrubbed, { name: "officedex-presentation-runtime", platform: "win32", arch: "x64", converter: "tools/bin/mop-convert.exe" });
  const runtime = scrubManifest("mop-runtime", { platform: "win32", relocationVerified: true, source: "pinned:v24.18.0" });
  assert.equal(runtime.source, "pinned:v24.18.0");
});

test("the smoke PATH puts the packaged node.exe and mop-convert.exe first", () => {
  const p = smokePath("/pkg", "/usr/bin", ":");
  assert.equal(p, [path.join("/pkg", "mop-runtime", "bin"), path.join("/pkg", "presentation", "tools", "bin"), "/usr/bin"].join(":"));
  const env = smokeEnvironment("/pkg", { PATH: "/usr/bin" });
  assert.equal(env.OFFICECLI_MOP_PRESENTATION_ROOT, path.join("/pkg", "presentation"));
  assert.equal(env.MOP_CONVERT_BIN, path.join("/pkg", "presentation", "tools", "bin", "mop-convert.exe"));
});

test("fatal verify-runtime lines are the MISSING/BROKEN ones for the payloads PPTX cannot run without", () => {
  const output = [
    "verify-runtime: presentation runtime     C:\\x\\presentation",
    "verify-runtime: mop-convert              MISSING -- every PPTX import and export will report the converter as unavailable",
    "verify-runtime: mop node runtime         BROKEN  -- C:\\x\\mop-runtime\\bin\\node.exe",
    "verify-runtime: word2mow convert         MISSING -- DOCX editing is unavailable (packaging stages it)",
  ].join("\n");
  assert.deepEqual(fatalVerifyRuntimeLines(output).map((line) => line.split(/\s+/)[1]), ["mop-convert", "mop"]);
});
