import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { verifyReleaseBoundary } from "./verify-release-boundary.mjs";

async function createFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "officedex-release-boundary-"));
  await mkdir(path.join(root, "src"), { recursive: true });
  await writeFile(path.join(root, "package.json"), `${JSON.stringify({ dependencies: { antd: "6.4.2" } })}\n`);
  await writeFile(path.join(root, "package-lock.json"), `${JSON.stringify({ packages: {} })}\n`);
  await writeFile(path.join(root, "vite.config.ts"), "export default {};\n");
  await writeFile(path.join(root, "src", "App.tsx"), "export function App() { return null; }\n");
  return root;
}

test("accepts the current release source boundary", async () => {
  const result = await verifyReleaseBoundary({ root: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..") });
  assert.ok(result.sourceFiles > 0);
});

test("rejects a forbidden scoped dependency", async () => {
  const root = await createFixture();
  const vendorName = ["shi", "mo"].join("");
  await writeFile(path.join(root, "package.json"), `${JSON.stringify({ dependencies: { [`@${vendorName}/sdk`]: "1.0.0" } })}\n`);
  await assert.rejects(verifyReleaseBoundary({ root }), /release boundary violation/i);
});

test("rejects a forbidden runtime module in dist", async () => {
  const root = await createFixture();
  await mkdir(path.join(root, "dist"), { recursive: true });
  await writeFile(path.join(root, "dist", "index.js"), `import ${JSON.stringify(["sdk", "sheet"].join("-"))};\n`);
  await assert.rejects(verifyReleaseBoundary({ root, distPath: "dist" }), /release boundary violation/i);
});
