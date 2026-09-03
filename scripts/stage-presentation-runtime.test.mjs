import assert from "node:assert/strict";
import { chmod, mkdtemp, mkdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  findNativeModules,
  nativePackages,
  resolvePresentationSource,
  stagePresentationRuntime,
} from "./stage-presentation-runtime.mjs";

// Build a presentation checkout with the same shape the real one has: the four
// markers officecli validates, a pnpm-style vite link, and the native packages
// esbuild/rollup load at runtime.
async function fakeCheckout(root, { hoistNatives = false, converterMode = 0o755 } = {}) {
  const write = async (rel, body) => {
    const target = path.join(root, rel);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, body);
  };
  await write("package.json", JSON.stringify({ name: "presentation" }));
  await write("tsconfig.json", "{}");
  await write("packages/presentation-engine/index.ts", "export const engine = 1;");
  await write("packages/presentation-office-js/index.ts", "export const host = 1;");
  await write("packages/deps/smartart/src/index.ts", "export const smartart = 1;");
  for (const kind of ["lo", "qs", "cs"]) {
    await write(
      `packages/presentation-app/public/presentation-assets/diagram/${kind}/sample.json`,
      JSON.stringify({ uniqueId: `${kind}-sample` }),
    );
  }
  await write(
    "quality/deps-golden/lib/node-presentation-host.mjs",
    "export const createDepsGoldenPresentationHost = () => ({});",
  );
  await write("packages/presentation-office-js/reference-cache/huge.bin", "dev only");
  await write("packages/presentation-office-js/differential/a.mjs", "dev only");
  await write("packages/presentation-office-js/scripts/b.mjs", "dev only");
  await write("packages/presentation-office-js/baseline/c.json", "{}");
  await write("mop/runtime/index.js", "module.exports = {};");
  await write("bos/dist/mop-wasm/pkg/mop_wasm_bg.wasm", "\0asm");
  await write("tools/fixtures/blank-presentation/content.json", "{}");
  await write("tools/bin/mop-convert", "#!/bin/sh\n");
  await chmod(path.join(root, "tools/bin/mop-convert"), converterMode);
  await write("node_modules/lodash-es/package.json", JSON.stringify({ name: "lodash-es" }));
  await write("packages/deps/ink/index.ts", "export const ink = 1;");
  await write("packages/deps/scientific-formula/index.ts", "export const formula = 1;");

  // pnpm store: vite lives beside its own dependency closure, and node_modules/
  // vite is a symlink into it.
  const store = path.join(root, "node_modules", ".pnpm", "vite@6.4.3", "node_modules");
  const natives = nativePackages();
  await write(
    path.join(path.relative(root, store), "vite/package.json"),
    JSON.stringify({ name: "vite", version: "6.4.3" }),
  );
  await write(path.join(path.relative(root, store), "vite/dist/node/index.js"), "export {};");
  for (const native of natives) {
    await write(
      path.join(path.relative(root, store), native.host, "package.json"),
      JSON.stringify({
        name: native.host,
        version: "1.0.0",
        optionalDependencies: { [native.name]: "1.0.0" },
      }),
    );
    // A native addon npm ships non-executable — exactly the case that must not
    // slip past notarize.mjs's `find -perm +111` discovery.
    const home = hoistNatives
      ? path.join("node_modules", native.name)
      : path.join("node_modules/.pnpm", `${native.name.replace("/", "+")}@1.0.0`, "node_modules", native.name);
    await write(path.join(home, "package.json"), JSON.stringify({ name: native.name, version: "1.0.0" }));
    await write(path.join(home, "binding.node"), "mach-o");
    await chmod(path.join(root, home, "binding.node"), 0o644);
  }
  await symlink(path.join(store, "vite"), path.join(root, "node_modules", "vite"));
}

async function stageInto(t, options) {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "officedex-presentation-"));
  t.after(() => rm(tmp, { recursive: true, force: true }));
  const source = path.join(tmp, "presentation");
  const dest = path.join(tmp, "build", "presentation");
  await mkdir(source, { recursive: true });
  await fakeCheckout(source, options);
  return { tmp, source, dest };
}

test("stages the sources, converter and vite closure the MOP worker needs", async (t) => {
  const { source, dest } = await stageInto(t);
  const result = await stagePresentationRuntime({ source, dest });

  assert.equal(result.root, source);
  const manifest = JSON.parse(await readFile(path.join(dest, "runtime.json"), "utf8"));
  assert.equal(manifest.converter, path.join("tools", "bin", "mop-convert"));
  assert.equal(manifest.source, source);
  assert.equal(manifest.sourceRepository, "fegit.shimo.im/presentation/presentation");
  assert.equal(typeof manifest.sourceRevision, "string");
  assert.equal(typeof manifest.sourceDirty, "boolean");

  // The four markers officecli's validMOPPresentationRoot() requires, so a
  // staged tree is a tree the packaged runtime will accept.
  for (const marker of [
    "package.json",
    path.join("node_modules", "vite", "dist", "node", "index.js"),
    path.join("bos", "dist", "mop-wasm", "pkg", "mop_wasm_bg.wasm"),
    path.join("tools", "fixtures", "blank-presentation", "content.json"),
    path.join("packages", "deps", "smartart", "src", "index.ts"),
    path.join(
      "packages",
      "presentation-app",
      "public",
      "presentation-assets",
      "diagram",
      "lo",
      "sample.json",
    ),
    path.join("quality", "deps-golden", "lib", "node-presentation-host.mjs"),
  ]) {
    await stat(path.join(dest, marker));
  }
  // vite's pnpm siblings come along; copying the link target alone would leave
  // vite unable to resolve rollup at runtime.
  for (const native of nativePackages()) {
    await stat(path.join(dest, "node_modules", native.host, "package.json"));
    await stat(path.join(dest, "node_modules", native.name, "binding.node"));
  }
  // An explicit source is honoured and validated against the same markers.
  assert.equal(resolvePresentationSource(source), source);
});

test("resolves natives from the pnpm store and from a hoisted node_modules", async (t) => {
  for (const hoistNatives of [false, true]) {
    const { source, dest } = await stageInto(t, { hoistNatives });
    await stagePresentationRuntime({ source, dest });
    for (const native of nativePackages()) {
      await stat(path.join(dest, "node_modules", native.name, "binding.node"));
    }
  }
});

test("makes every staged native module executable so notarize.mjs signs it", async (t) => {
  const { source, dest } = await stageInto(t);
  await stagePresentationRuntime({ source, dest });

  const natives = await findNativeModules(dest);
  assert.ok(natives.length > 0, "expected staged native modules");
  for (const native of natives) {
    const mode = (await stat(native)).mode & 0o777;
    assert.equal(mode & 0o111, 0o111, `${native} must be executable to be discovered for signing`);
  }
  const manifest = JSON.parse(await readFile(path.join(dest, "runtime.json"), "utf8"));
  assert.deepEqual(
    manifest.nativeModules,
    natives.map((native) => path.relative(dest, native)).sort(),
  );
});

test("prunes dev-only payloads that would otherwise ship", async (t) => {
  const { source, dest } = await stageInto(t);
  await stagePresentationRuntime({ source, dest });
  for (const pruned of ["reference-cache", "differential", "scripts", "baseline"]) {
    await assert.rejects(stat(path.join(dest, "packages", "presentation-office-js", pruned)));
  }
  await stat(path.join(dest, "packages", "presentation-office-js", "index.ts"));
});

test("stages no symlinks, which codesign rejects inside a bundle", async (t) => {
  const { source, dest } = await stageInto(t);
  await stagePresentationRuntime({ source, dest });

  const links = [];
  const walk = async (dir) => {
    const { readdir } = await import("node:fs/promises");
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) links.push(full);
      else if (entry.isDirectory()) await walk(full);
    }
  };
  await walk(dest);
  assert.deepEqual(links, []);
});

test("fails loudly when mop-convert is missing rather than shipping a broken app", async (t) => {
  const { source, dest } = await stageInto(t);
  await rm(path.join(source, "tools", "bin", "mop-convert"));
  await assert.rejects(stagePresentationRuntime({ source, dest }), /mop-convert not found or not executable/);
});

test("fails when mop-convert is present but not executable", async (t) => {
  const { source, dest } = await stageInto(t, { converterMode: 0o644 });
  await assert.rejects(stagePresentationRuntime({ source, dest }), /mop-convert not found or not executable/);
});

test("fails when a required presentation source is absent", async (t) => {
  const { source, dest } = await stageInto(t);
  await rm(path.join(source, "bos"), { recursive: true, force: true });
  await assert.rejects(
    stagePresentationRuntime({ source, dest }),
    /presentation source is missing bos\/dist\/mop-wasm\/pkg/,
  );
});

test("fails when the platform native package version does not match its host", async (t) => {
  const { source, dest } = await stageInto(t);
  const [native] = nativePackages();
  const home = path.join(
    source,
    "node_modules/.pnpm",
    `${native.name.replace("/", "+")}@1.0.0`,
    "node_modules",
    native.name,
  );
  await writeFile(path.join(home, "package.json"), JSON.stringify({ name: native.name, version: "9.9.9" }));
  await assert.rejects(stagePresentationRuntime({ source, dest }), new RegExp(`native package ${native.name.replace("/", "\\/")}`));
});

test("rejects a source directory that is not a valid presentation root", async (t) => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "officedex-presentation-bad-"));
  t.after(() => rm(tmp, { recursive: true, force: true }));
  assert.throws(() => resolvePresentationSource(tmp), /presentation checkout not found/);
});
