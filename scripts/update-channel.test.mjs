import assert from "node:assert/strict";
import test from "node:test";

import {
  CHANNEL_10,
  CHANNEL_STABLE,
  assertVersionMatchesChannel,
  distArchiveDir,
  distManifestPath,
  forbiddenGitPaths,
  gitAddPaths,
  isPrereleaseChannel,
} from "./update-channel.mjs";

test("1.0 channel accepts 1.0.N and rejects everything else", () => {
  assert.deepEqual(assertVersionMatchesChannel(CHANNEL_10, "v1.0.1"), {
    channel: CHANNEL_10,
    version: "1.0.1",
  });
  assert.throws(() => assertVersionMatchesChannel(CHANNEL_10, "1.0.0-beta.1"), /1\.0\.N/);
  assert.throws(() => assertVersionMatchesChannel(CHANNEL_10, "0.5.43"), /1\.0\.N/);
  assert.throws(() => assertVersionMatchesChannel(CHANNEL_10, "1.1.0"), /1\.0\.N/);
});

test("stable channel accepts any plain x.y.z and rejects pre-release suffixes", () => {
  assert.deepEqual(assertVersionMatchesChannel(CHANNEL_STABLE, "0.5.43"), {
    channel: CHANNEL_STABLE,
    version: "0.5.43",
  });
  assert.deepEqual(assertVersionMatchesChannel(CHANNEL_STABLE, "v1.0.13"), {
    channel: CHANNEL_STABLE,
    version: "1.0.13",
  });
  assert.throws(() => assertVersionMatchesChannel(CHANNEL_STABLE, "1.0.0-beta.1"), /x\.y\.z/);
  assert.throws(() => assertVersionMatchesChannel("nightly", "0.5.43"), /unknown update channel/);
});

test("dist paths keep the legacy 1.0 channel under channels/1.0", () => {
  assert.equal(distManifestPath(CHANNEL_STABLE), "manifest.json");
  assert.equal(distManifestPath(CHANNEL_10), "channels/1.0/manifest.json");
  assert.equal(distArchiveDir(CHANNEL_10), "channels/1.0/archive");
  assert.deepEqual(gitAddPaths(CHANNEL_10), ["channels/1.0/"]);
  assert.deepEqual(forbiddenGitPaths(CHANNEL_10), ["manifest.json"]);
  assert.deepEqual(forbiddenGitPaths(CHANNEL_STABLE), ["channels/"]);
  assert.equal(isPrereleaseChannel(CHANNEL_10), true);
  assert.equal(isPrereleaseChannel(CHANNEL_STABLE), false);
});

test("the desktop app and this script agree on both manifest URLs", async () => {
  const { readFile } = await import("node:fs/promises");
  const { MANIFEST_URLS, obsManifestKey, OBS_ORIGIN } = await import("./update-channel.mjs");
  const go = await readFile(new URL("../app_update_channel.go", import.meta.url), "utf8");
  const baked = /channel10UpdateManifestURL\s*=\s*"([^"]+)"/.exec(go)?.[1];
  assert.equal(baked, MANIFEST_URLS[CHANNEL_10]);
  const bakedStable = /stableUpdateManifestURL\s*=\s*"([^"]+)"/.exec(go)?.[1];
  assert.equal(bakedStable, MANIFEST_URLS[CHANNEL_STABLE]);
  assert.equal(MANIFEST_URLS[CHANNEL_10], `${OBS_ORIGIN}/${obsManifestKey(CHANNEL_10)}`);
});
