import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { verifyReleaseVersion } from "./verify-release-version.mjs";

async function createFixture({ packageVersion = "0.6.0", wailsVersion = "0.6.0", appVersion = "0.6.0" } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "officedex-version-"));
  const packagePath = path.join(root, "package.json");
  const wailsPath = path.join(root, "wails.json");
  const appPath = path.join(root, "OfficeDex.app");
  await mkdir(path.join(appPath, "Contents"), { recursive: true });
  await writeFile(packagePath, `${JSON.stringify({ version: packageVersion })}\n`);
  await writeFile(wailsPath, `${JSON.stringify({ info: { productVersion: wailsVersion } })}\n`);
  await writeFile(path.join(appPath, "Contents", "Info.plist"), `<?xml version="1.0"?>
<plist><dict>
<key>CFBundleVersion</key><string>${appVersion}</string>
<key>CFBundleShortVersionString</key><string>${appVersion}</string>
</dict></plist>
`);
  return { packagePath, wailsPath, appPath };
}

test("accepts matching package, Wails, tag, and macOS bundle versions", async () => {
  const fixture = await createFixture();
  const result = await verifyReleaseVersion({
    expected: "0.6.0",
    packagePath: fixture.packagePath,
    wailsPath: fixture.wailsPath,
    appPath: fixture.appPath,
    tag: "v0.6.0",
  });
  assert.equal(result.expected, "0.6.0");
});

test("names every mismatched version carrier", async () => {
  const fixture = await createFixture({ packageVersion: "0.5.43", wailsVersion: "0.5.43", appVersion: "0.5.43" });
  await assert.rejects(
    verifyReleaseVersion({
      expected: "0.6.0",
      packagePath: fixture.packagePath,
      wailsPath: fixture.wailsPath,
      appPath: fixture.appPath,
      tag: "v0.5.43",
    }),
    (error) => {
      assert.match(error.message, /package\.json.*0\.5\.43/i);
      assert.match(error.message, /wails\.json.*0\.5\.43/i);
      assert.match(error.message, /CFBundleShortVersionString.*0\.5\.43/i);
      assert.match(error.message, /CFBundleVersion.*0\.5\.43/i);
      assert.match(error.message, /tag.*v0\.5\.43/i);
      return true;
    },
  );
});
