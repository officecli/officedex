import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { syncWriterComponent, WRITER_FONT_DIRECTORY } from "./sync-writer-component.mjs";

async function buildFixtureDist() {
  const root = await mkdtemp(path.join(os.tmpdir(), "officedex-writer-sync-"));
  const distDir = path.join(root, "dist");
  await mkdir(path.join(distDir, "assets"), { recursive: true });
  await writeFile(
    path.join(distDir, "index.html"),
    '<!doctype html><script type="module" src="./assets/app.js"></script>',
  );
  await writeFile(path.join(distDir, "assets", "app.js"), "export {};\n");
  await mkdir(path.join(distDir, WRITER_FONT_DIRECTORY, "prebuilt"), { recursive: true });
  await writeFile(
    path.join(distDir, WRITER_FONT_DIRECTORY, "prebuilt", "a.json"),
    "{}\n",
  );
  return { root, distDir, publicDir: path.join(root, "public", "writer") };
}

test("syncWriterComponent copies the build and writes the host manifest", async () => {
  const { distDir, publicDir } = await buildFixtureDist();

  await syncWriterComponent({ distDir, publicDir, sourceRevision: "18bf54a" });

  const manifest = JSON.parse(
    await readFile(path.join(publicDir, "officedex-component.json"), "utf8"),
  );
  assert.deepEqual(manifest, {
    name: "writer",
    sourceRepository: "shimo/writer",
    protocolVersion: 1,
    sourceRevision: "18bf54a",
  });
  assert.match(await readFile(path.join(publicDir, "index.html"), "utf8"), /type="module"/);
  assert.equal(await readFile(path.join(publicDir, "assets", "app.js"), "utf8"), "export {};\n");
});

test("syncWriterComponent leaves the default-font closure out of public/", async () => {
  const { distDir, publicDir } = await buildFixtureDist();

  await syncWriterComponent({ distDir, publicDir, sourceRevision: "18bf54a" });

  assert.equal(existsSync(path.join(publicDir, WRITER_FONT_DIRECTORY)), false);
  assert.deepEqual((await readdir(publicDir)).sort(), [
    "assets",
    "index.html",
    "officedex-component.json",
  ]);
});

test("syncWriterComponent refuses a build without a module entry", async () => {
  const { distDir, publicDir } = await buildFixtureDist();
  await writeFile(path.join(distDir, "index.html"), "<!doctype html><body></body>");

  await assert.rejects(
    syncWriterComponent({ distDir, publicDir, sourceRevision: "18bf54a" }),
    /no module entry/,
  );
});
