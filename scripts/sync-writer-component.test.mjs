import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { HOST_RUNTIME_FILE, syncWriterComponent, WRITER_FONT_DIRECTORY } from "./sync-writer-component.mjs";

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
  // The writer checkout the dictionaries come from. Writer does not load its
  // own — `writer-i18n.ts` says "该模块不加载资源、不选择 locale ... 也不调用
  // setLocale" — so the sync reads them here and the host runtime carries them.
  const sourceDir = path.join(root, "writer");
  const writerLocales = path.join(sourceDir, "packages/writer-next-ui-react/locales");
  const kitLocales = path.join(
    sourceDir,
    "packages/writer-next-ui-react/node_modules/@shimo/suite-components-toolbar-kit/dist/locales",
  );
  await mkdir(writerLocales, { recursive: true });
  await mkdir(kitLocales, { recursive: true });
  await writeFile(path.join(writerLocales, "zh-CN.json"), JSON.stringify({ "toolbar.start": "开始" }));
  await writeFile(path.join(kitLocales, "en-US.json"), JSON.stringify({ undo: "Undo" }));
  return { root, distDir, sourceDir, publicDir: path.join(root, "public", "writer") };
}

test("syncWriterComponent copies the build and writes the host manifest", async () => {
  const { distDir, publicDir, sourceDir } = await buildFixtureDist();

  await syncWriterComponent({ distDir, publicDir, sourceDir, sourceRevision: "18bf54a" });

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

// Without them Writer starts and renders `toolbar.start` at the user. They are
// inlined rather than fetched: the runtime has to be a classic script that runs
// before the first module evaluates, and nothing asynchronous can be relied on
// to have finished by then.
test("syncWriterComponent carries the dictionaries in the host runtime", async () => {
  const { distDir, publicDir, sourceDir } = await buildFixtureDist();

  await syncWriterComponent({ distDir, publicDir, sourceDir, sourceRevision: "18bf54a" });

  const runtime = await readFile(path.join(publicDir, HOST_RUNTIME_FILE), "utf8");
  assert.match(runtime, /writer-sdk/);
  assert.match(runtime, /toolbar\.start/);
  assert.match(runtime, /suite-components-toolbar-kit/);
});

test("syncWriterComponent leaves the default-font closure out of public/", async () => {
  const { distDir, publicDir, sourceDir } = await buildFixtureDist();

  await syncWriterComponent({ distDir, publicDir, sourceDir, sourceRevision: "18bf54a" });

  assert.equal(existsSync(path.join(publicDir, WRITER_FONT_DIRECTORY)), false);
  // host-runtime.js is not part of the Writer build: it is the i18n runtime
  // Writer requires the host to install before its module evaluates, and
  // without it every .docx opens to an empty frame. See
  // sync-writer-component.hostRuntime.test.mjs.
  assert.deepEqual((await readdir(publicDir)).sort(), [
    "assets",
    HOST_RUNTIME_FILE,
    "index.html",
    "officedex-component.json",
  ].sort());
});

test("syncWriterComponent refuses a build without a module entry", async () => {
  const { distDir, publicDir, sourceDir } = await buildFixtureDist();
  await writeFile(path.join(distDir, "index.html"), "<!doctype html><body></body>");

  await assert.rejects(
    syncWriterComponent({ distDir, publicDir, sourceDir, sourceRevision: "18bf54a" }),
    /no module entry/,
  );
});

// A writer checkout whose locales moved would otherwise sync cleanly and ship
// the raw keys again — and leave the previous sync deleted on the way.
test("syncWriterComponent refuses a checkout with no dictionaries, without emptying public/", async () => {
  const { distDir, publicDir, sourceDir } = await buildFixtureDist();
  await syncWriterComponent({ distDir, publicDir, sourceDir, sourceRevision: "18bf54a" });
  const emptySource = path.join(sourceDir, "moved");

  await assert.rejects(
    syncWriterComponent({ distDir, publicDir, sourceDir: emptySource, sourceRevision: "18bf54a" }),    /locale directory is missing/,
  );
  assert.equal(existsSync(path.join(publicDir, "index.html")), true);
});
