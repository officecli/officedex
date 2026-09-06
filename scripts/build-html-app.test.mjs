import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { cwd, execPath } from "node:process";
import { spawn } from "node:child_process";

test("generated HTML App project builds with the direct Node/Vite path", async () => {
  const root = await mkdtemp(join(cwd(), ".officedex-html-build-"));
  try {
    await mkdir(join(root, "src"));
    await writeFile(join(root, "index.html"), '<main id="app">Smoke</main><script type="module" src="/src/main.ts"></script>');
    await writeFile(join(root, "src", "main.ts"), "document.querySelector('#app').dataset.ready = 'true';");
    const child = spawn(execPath, [join(cwd(), "scripts", "build-html-app.mjs"), root], { cwd: cwd(), stdio: "pipe" });
    const exitCode = await new Promise((resolve) => child.on("close", resolve));
    assert.equal(exitCode, 0);
    assert.match(await readFile(join(root, "dist", "index.html"), "utf8"), /Smoke/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
