import assert from "node:assert/strict";
import { access, mkdtemp, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const viteBin = path.join(repoRoot, "node_modules", "vite", "bin", "vite.js");

test("production build includes Sheet SDK chunks and Chinese locale resources", async (t) => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), "officedex-sdk-sheet-build-"));
  t.after(async () => {
    await rm(outputDir, { recursive: true, force: true });
  });

  const result = spawnSync(
    process.execPath,
    [viteBin, "build", "--outDir", outputDir, "--emptyOutDir"],
    { cwd: repoRoot, encoding: "utf8", env: process.env },
  );
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);

  const requiredAssets = [
    "sdk-sheet/p2.chunk.js",
    "sdk-sheet-locales/fe-common/zh-CN.js",
    "sdk-sheet-locales/lizard-service-sheet-sdk/zh-CN.js",
  ];
  for (const relativePath of requiredAssets) {
    const assetPath = path.join(outputDir, relativePath);
    await access(assetPath);
    assert.equal((await stat(assetPath)).isFile(), true, `${relativePath} must be a file`);
  }
});
