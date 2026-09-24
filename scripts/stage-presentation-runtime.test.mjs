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
  // The minified authoring runtime the worker prefers over the sources.
  await write("dist-ssr/manifest.json", JSON.stringify({ schemaVersion: 1 }));
  // Obfuscated shape: staging refuses a plain build.
  await write("dist-ssr/engine.js", "const _0x1a2b=1;export const engine=_0x1a2b;");
  // Authored TypeScript is pruned once dist-ssr ships in its place.
  await write("packages/presentation-engine/src/index.ts", "export const authored = 1;");
  await write("packages/presentation-office-js/src/index.ts", "export const authored = 1;");
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
  await write("packages/presentation-office-js/README.md", "# ships publicly otherwise");
  await write("packages/presentation-office-js/reference-cache/huge.bin", "dev only");
  await write("packages/presentation-office-js/differential/a.mjs", "dev only");
  await write("packages/presentation-office-js/scripts/b.mjs", "dev only");
  await write("packages/presentation-office-js/baseline/c.json", "{}");
  await write("mop/runtime/index.js", "module.exports = {};");
  await write("packages/mop-wasm/mop_wasm_bg.wasm", "\0asm-current");
  await write("bos/dist/mop-wasm/pkg/mop_wasm_bg.wasm", "\0asm");
  await write("tools/fixtures/blank-presentation/content.json", "{}");
  await write("tools/bin/mop-convert", "#!/bin/sh\n");
  await chmod(path.join(root, "tools/bin/mop-convert"), converterMode);
  // The JSSDK Host runner officecli spawns, with the same import shape the real
  // one has: a sibling at the top level, two under lib/, one of them reaching
  // back up, and a bare specifier that is node_modules' business rather than
  // the closure walker's.
  await write(
    "tools/execute-jssdk.mjs",
    'import { createJssdkNativeRuntime } from "./lib/jssdk-native-runtime.mjs";\nexport const run = createJssdkNativeRuntime;\n',
  );
  await write("tools/batch-convert-pptx-to-mop.mjs", "export const sanitizeXmlForMop = (xml) => xml;\n");
  await write(
    "tools/lib/jssdk-native-runtime.mjs",
    'import { chromium } from "playwright";\n' +
      'import { wrapPowerPointHostWithVibeOps } from "./jssdk-vibe-ops.mjs";\n' +
      'import { createJssdkVideoRuntime } from "./jssdk-video-authoring.mjs";\n' +
      "export const createJssdkNativeRuntime = () => ({ chromium, wrapPowerPointHostWithVibeOps, createJssdkVideoRuntime });\n",
  );
  await write("tools/lib/jssdk-vibe-ops.mjs", "export const wrapPowerPointHostWithVibeOps = () => ({});\n");
  await write("tools/lib/jssdk-video-authoring.mjs", "export const createJssdkVideoRuntime = () => ({});\n");
  await write(
    "tools/lib/mop-converter-client.mjs",
    'import { sanitizeXmlForMop } from "../batch-convert-pptx-to-mop.mjs";\nexport { sanitizeXmlForMop };\n',
  );
  await write("tools/lib/jssdk-native-browser.ts", "export const browserRuntime = 1;");
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

  // The four markers officecli's validMOPPresentationRoot() requires. They get
  // the staged tree *selected* as the presentation root; what makes it usable
  // is the rest of this list, and the runner covered further down.
  for (const marker of [
    "package.json",
    path.join("node_modules", "vite", "dist", "node", "index.js"),
    path.join("packages", "mop-wasm", "mop_wasm_bg.wasm"),
    path.join("bos", "dist", "mop-wasm", "pkg", "mop_wasm_bg.wasm"),
    path.join("tools", "fixtures", "blank-presentation", "content.json"),
    // The minified runtime replaces the authored sources below.
    path.join("dist-ssr", "manifest.json"),
    path.join("dist-ssr", "engine.js"),
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
  // A plain (unobfuscated) runtime must not be packageable: the sources are
  // pruned, so dist-ssr is the only copy of the engine that ships.
  {
    const plain = await mkdtemp(path.join(os.tmpdir(), "officedex-plain-"));
    t.after(() => rm(plain, { recursive: true, force: true }));
    await fakeCheckout(plain);
    await writeFile(
      path.join(plain, "dist-ssr", "engine.js"),
      "export const engine = 1;",
    );
    await assert.rejects(
      stagePresentationRuntime({ source: plain, dest: path.join(plain, "out") }),
      /is not obfuscated/u,
    );
  }

  // Authored TypeScript must not ship: the installer is public and the worker
  // loads dist-ssr instead.
  for (const pruned of [
    path.join("packages", "presentation-engine", "src"),
    path.join("packages", "presentation-office-js", "src"),
    path.join("packages", "deps", "smartart", "src"),
    path.join("packages", "presentation-office-js", "README.md"),
  ]) {
    await assert.rejects(stat(path.join(dest, pruned)), { code: "ENOENT" }, pruned);
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

test("copies nested rolldown deps such as @rolldown/pluginutils", async (t) => {
  const { source, dest } = await stageInto(t);
  const viteStore = path.join(source, "node_modules", ".pnpm", "vite@6.4.3", "node_modules");
  const rolldownStore = path.join(source, "node_modules", ".pnpm", "rolldown@1.0.0", "node_modules");
  const write = async (rel, body) => {
    const target = path.join(source, rel);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, body);
  };
  await rm(path.join(viteStore, "rolldown"), { recursive: true, force: true });
  await write(
    path.join(path.relative(source, rolldownStore), "rolldown/package.json"),
    JSON.stringify({
      name: "rolldown",
      version: "1.0.0",
      optionalDependencies: { "@rolldown/binding-darwin-arm64": "1.0.0" },
    }),
  );
  await write(
    path.join(path.relative(source, rolldownStore), "@rolldown/pluginutils/package.json"),
    JSON.stringify({ name: "@rolldown/pluginutils", version: "1.0.0" }),
  );
  await symlink(path.join(rolldownStore, "rolldown"), path.join(viteStore, "rolldown"));
  await stagePresentationRuntime({ source, dest });
  await stat(path.join(dest, "node_modules", "@rolldown", "pluginutils", "package.json"));
});

test("stages rolldown natives when the vite closure has no rollup", async (t) => {
  const { source, dest } = await stageInto(t);
  const rollup = nativePackages().find((native) => native.host === "rollup");
  assert.ok(rollup, "expected rollup in nativePackages()");
  await rm(path.join(source, "node_modules", ".pnpm", "vite@6.4.3", "node_modules", "rollup"), {
    recursive: true,
    force: true,
  });
  await rm(
    path.join(
      source,
      "node_modules/.pnpm",
      `${rollup.name.replace("/", "+")}@1.0.0`,
    ),
    { recursive: true, force: true },
  );
  await stagePresentationRuntime({ source, dest });
  await assert.rejects(stat(path.join(dest, "node_modules", "rollup")), { code: "ENOENT" });
  await stat(path.join(dest, "node_modules", "rolldown", "package.json"));
  const rolldown = nativePackages().find((native) => native.host === "rolldown");
  await stat(path.join(dest, "node_modules", rolldown.name, "binding.node"));
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

/**
 * The JSSDK Host runner.
 *
 * It was absent from the staged tree for as long as PRESENTATION_SOURCES has
 * existed, and no gate noticed: the four markers a root is validated by do not
 * mention it, so `build/presentation` looked healthy, won the resolution race
 * against a complete checkout, and failed only when a user asked for a deck —
 * "JSSDK Host runner unavailable", minutes into a generation.
 */
test("stages the JSSDK Host runner and everything it imports", async (t) => {
  const { source, dest } = await stageInto(t);
  await stagePresentationRuntime({ source, dest });

  for (const relative of [
    "tools/execute-jssdk.mjs",
    "tools/batch-convert-pptx-to-mop.mjs",
    "tools/lib/jssdk-native-runtime.mjs",
    "tools/lib/jssdk-vibe-ops.mjs",
    "tools/lib/jssdk-video-authoring.mjs",
    "tools/lib/mop-converter-client.mjs",
    // Reached through an absolute Vite SSR URL, so no import graph shows it.
    "tools/lib/jssdk-native-browser.ts",
  ]) {
    await stat(path.join(dest, relative));
  }
});

test("refuses to stage a runner whose imports were left behind", async (t) => {
  const { source, dest } = await stageInto(t);
  // A transitive dependency, two hops from the entry point: the shape a
  // hand-maintained file list gets wrong.
  await rm(path.join(source, "tools/lib/jssdk-vibe-ops.mjs"), { force: true });
  await assert.rejects(
    stagePresentationRuntime({ source, dest }),
    /presentation source is missing tools\/lib\/jssdk-vibe-ops\.mjs/,
  );
});

test("walks the runner's imports rather than trusting the list", async (t) => {
  const { source, dest } = await stageInto(t);
  // Add an import the manifest does not know about, the way an upstream change
  // would. Staging must fail here, not in the user's app.
  await writeFile(
    path.join(source, "tools/execute-jssdk.mjs"),
    'import { createJssdkNativeRuntime } from "./lib/jssdk-native-runtime.mjs";\n' +
      'import { newThing } from "./lib/added-upstream.mjs";\n' +
      "export const run = () => [createJssdkNativeRuntime, newThing];\n",
  );
  await assert.rejects(
    stagePresentationRuntime({ source, dest }),
    /runner is incomplete[\s\S]*tools\/lib\/added-upstream\.mjs/,
  );
});

// `playwright` is a bare specifier: node_modules' business, not the walker's.
// Treating it as a missing file would make every staging run fail on a
// dependency that is deliberately not staged.
test("does not mistake a bare specifier for a missing file", async (t) => {
  const { source, dest } = await stageInto(t);
  const { jssdkRunner } = JSON.parse(
    await readFile(path.join((await stagePresentationRuntime({ source, dest })).dest, "runtime.json"), "utf8"),
  );
  assert.ok(!jssdkRunner.closure.some((entry) => entry.includes("playwright")));
});

/**
 * The browser the runner needs is not staged, and the build says so.
 *
 * `jssdk-native-runtime.mjs` imports playwright, staging it would mean shipping
 * a Chromium inside a hardened-runtime bundle, and whether the desktop's only
 * PPTX backend may depend on a browser is a product decision. So the staged
 * tree records what it cannot run instead of pretending otherwise.
 */
test("records that the runner's browser is absent from the staged tree", async (t) => {
  const { source, dest } = await stageInto(t);
  const { playwrightStaged } = await stagePresentationRuntime({ source, dest });
  assert.equal(playwrightStaged, false);

  const manifest = JSON.parse(await readFile(path.join(dest, "runtime.json"), "utf8"));
  assert.equal(manifest.jssdkRunner.playwright, false);
  assert.equal(manifest.jssdkRunner.entry, "tools/execute-jssdk.mjs");
});
