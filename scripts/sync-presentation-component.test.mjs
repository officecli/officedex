import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { syncPresentationComponent } from "./sync-presentation-component.mjs";

test("syncPresentationComponent copies the build and writes the host manifest", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "officedex-presentation-sync-"));
  const distDir = path.join(root, "dist");
  const publicDir = path.join(root, "public", "presentation");
  await mkdir(distDir, { recursive: true });
  await writeFile(
    path.join(distDir, "index.html"),
    '<!doctype html><script type="module" src="./assets/app.js"></script>',
  );
  await mkdir(path.join(distDir, "assets"));
  await writeFile(path.join(distDir, "assets", "app.js"), "export {};\n");

  await syncPresentationComponent({
    distDir,
    publicDir,
    sourceRevision: "a10c147",
  });

  const manifest = JSON.parse(
    await readFile(path.join(publicDir, "officedex-component.json"), "utf8"),
  );
  assert.deepEqual(manifest, {
    name: "learnof/pptx",
    protocolVersion: 1,
    sourceRevision: "a10c147",
  });
  assert.match(await readFile(path.join(publicDir, "index.html"), "utf8"), /type="module"/);
});
