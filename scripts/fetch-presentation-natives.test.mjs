import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { nativesCacheDir, requiredNativeVersions } from "./fetch-presentation-natives.mjs";

test("the versions to fetch come from the checkout's host packages, for the target slice", async () => {
  // A pnpm-shaped checkout: esbuild hoisted, rolldown and lightningcss only in
  // the store, rollup absent (Vite 8).
  const root = await mkdtemp(path.join(os.tmpdir(), "natives-"));
  const write = async (relative, body) => {
    const file = path.join(root, relative);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify(body));
  };
  await write("node_modules/.pnpm/esbuild@0.28.2/node_modules/esbuild/package.json", {
    name: "esbuild", version: "0.28.2", optionalDependencies: { "@esbuild/win32-x64": "0.28.2", "@esbuild/darwin-arm64": "0.28.2" },
  });
  await symlink(path.join(root, "node_modules/.pnpm/esbuild@0.28.2/node_modules/esbuild"), path.join(root, "node_modules", "esbuild"));
  await write("node_modules/.pnpm/rolldown@1.2.6/node_modules/rolldown/package.json", {
    name: "rolldown", version: "1.2.6", optionalDependencies: { "@rolldown/binding-win32-x64-msvc": "1.2.6" },
  });
  await write("node_modules/.pnpm/lightningcss@1.33.0/node_modules/lightningcss/package.json", {
    name: "lightningcss", version: "1.33.0", optionalDependencies: { "lightningcss-win32-x64-msvc": "1.33.0" },
  });

  const required = await requiredNativeVersions(root, "win32", "x64");
  assert.deepEqual(
    required.map((native) => `${native.name}@${native.version}`),
    ["@esbuild/win32-x64@0.28.2", "@rolldown/binding-win32-x64-msvc@1.2.6", "lightningcss-win32-x64-msvc@1.33.0"],
  );
  await rm(root, { recursive: true, force: true });
});

test("the cache directory is per target slice under build/cache", () => {
  assert.equal(nativesCacheDir("win32", "x64", "/repo"), path.join("/repo", "build", "cache", "presentation-natives", "win32-x64"));
});
