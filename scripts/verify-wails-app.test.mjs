import { describe, expect, it } from "vitest";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { chmodSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import os from "node:os";

const scriptPath = path.join(process.cwd(), "scripts", "verify-wails-app.mjs");

describe("verify-wails-app", () => {
  it("fails when CFBundleExecutable is missing from Contents/MacOS", async () => {
    const app = await createAppFixture({ withExecutable: false });
    const result = spawnSync("node", [scriptPath, app], { encoding: "utf8" });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/executable is missing/i);
    expect(result.stderr).toMatch(/Contents[\\/]MacOS[\\/]officedex/);
  });

  it("passes when CFBundleExecutable exists and is executable", async () => {
    const app = await createAppFixture({ withExecutable: true });
    const result = spawnSync("node", [scriptPath, app], { encoding: "utf8" });

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/verified executable/i);
  });
});

async function createAppFixture({ withExecutable }) {
  const root = await mkdtemp(path.join(os.tmpdir(), "verify-wails-app-"));
  const app = path.join(root, "OfficeDex.app");
  const contents = path.join(app, "Contents");
  const macOS = path.join(contents, "MacOS");
  await mkdir(macOS, { recursive: true });
  await writeFile(path.join(contents, "Info.plist"), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleExecutable</key>
  <string>officedex</string>
</dict>
</plist>
`);
  if (withExecutable) {
    const executable = path.join(macOS, "officedex");
    await writeFile(executable, "#!/bin/sh\nexit 0\n");
    chmodSync(executable, 0o755);
  }
  return app;
}
