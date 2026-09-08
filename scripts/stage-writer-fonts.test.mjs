import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { WRITER_FONT_DIRECTORY } from "./sync-writer-component.mjs";
import { stageWriterFonts, WRITER_FONT_ROOTS } from "./stage-writer-fonts.mjs";

async function fixtureDist({ roots = WRITER_FONT_ROOTS } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "officedex-writer-fonts-"));
  const distDir = path.join(root, "dist");
  await mkdir(path.join(distDir, "assets"), { recursive: true });
  await writeFile(path.join(distDir, "assets", "app.js"), "export {};\n");
  for (const name of roots) {
    const dir = path.join(distDir, WRITER_FONT_DIRECTORY, name);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "payload.json"), "{}\n");
  }
  return { root, distDir, dest: path.join(root, "build", "writer-fonts") };
}

test("stages the three delivery roots with a manifest", async () => {
  const { distDir, dest } = await fixtureDist();

  const result = await stageWriterFonts({ distDir, dest });

  assert.deepEqual((await readdir(dest)).sort(), [...WRITER_FONT_ROOTS].sort().concat("writer-fonts.json").sort());
  for (const name of WRITER_FONT_ROOTS) {
    assert.equal(await readFile(path.join(dest, name, "payload.json"), "utf8"), "{}\n");
  }
  const manifest = JSON.parse(await readFile(path.join(dest, "writer-fonts.json"), "utf8"));
  assert.equal(manifest.name, "writer-next-default-fonts");
  assert.equal(manifest.files, WRITER_FONT_ROOTS.length);
  assert.equal(result.files, WRITER_FONT_ROOTS.length);
});

test("leaves the application bundle behind: only the font roots are staged", async () => {
  const { distDir, dest } = await fixtureDist();

  await stageWriterFonts({ distDir, dest });

  assert.equal(existsSync(path.join(dest, "assets")), false);
});

test("fails when the closure is missing rather than shipping a fontless app", async () => {
  const { distDir, dest } = await fixtureDist({ roots: [] });

  await assert.rejects(stageWriterFonts({ distDir, dest }), /closure not found/);
});

test("fails when the closure is incomplete", async () => {
  const { distDir, dest } = await fixtureDist({ roots: ["prebuilt"] });

  await assert.rejects(stageWriterFonts({ distDir, dest }), /incomplete .*missing files, draw/s);
});
