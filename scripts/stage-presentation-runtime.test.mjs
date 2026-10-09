import assert from "node:assert/strict";
import { chmod, mkdtemp, mkdir, readdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  findForeignMachO,
  findNativeModules,
  findStrayNodeBinaries,
  isNativeSlicePackage,
  machoArchitectures,
  nativePackages,
  pruneDevelopmentFiles,
  pruneForeignNatives,
  presentationSourceRepository,
  resolvePresentationSource,
  stagePresentationRuntime,
} from "./stage-presentation-runtime.mjs";

const MACHO_CPU_TYPE = Object.freeze({ x64: 0x01000007, arm64: 0x0100000c });

// The header of a Mach-O image for the given CPUs: a thin MH_MAGIC_64 image
// for one, a FAT_MAGIC universal image for several. Enough for the staging
// script, which reads the header rather than running lipo.
function machO(...archs) {
  if (archs.length === 1) {
    const header = Buffer.alloc(32);
    header.writeUInt32LE(0xfeedfacf, 0);
    header.writeUInt32LE(MACHO_CPU_TYPE[archs[0]], 4);
    return header;
  }
  const header = Buffer.alloc(8 + 20 * archs.length);
  header.writeUInt32BE(0xcafebabe, 0);
  header.writeUInt32BE(archs.length, 4);
  archs.forEach((arch, index) => header.writeUInt32BE(MACHO_CPU_TYPE[arch], 8 + 20 * index));
  return header;
}

// Build a presentation checkout with the same shape the real one has: the four
// markers officecli validates, a pnpm-style vite link, and the native packages
// esbuild/rollup load at runtime.
// `archs` lists the slices whose natives are installed (pnpm's
// supportedArchitectures); the host's alone unless a cross-arch case asks.
// `platform` names the slices' OS; the host's unless a case wants macOS rules
// regardless of where the tests run.
async function fakeCheckout(
  root,
  { hoistNatives = false, converterMode = 0o755, archs = [os.arch()], platform = process.platform } = {},
) {
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
  const natives = archs.flatMap((arch) =>
    nativePackages(platform, arch).map((native) => ({ ...native, arch })),
  );
  const optionalByHost = {};
  for (const native of natives) {
    (optionalByHost[native.host] ??= {})[native.name] = "1.0.0";
  }
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
        optionalDependencies: optionalByHost[native.host],
      }),
    );
    // A native addon npm ships non-executable — exactly the case that must not
    // slip past notarize.mjs's `find -perm +111` discovery.
    const home = hoistNatives
      ? path.join("node_modules", native.name)
      : path.join("node_modules/.pnpm", `${native.name.replace("/", "+")}@1.0.0`, "node_modules", native.name);
    await write(path.join(home, "package.json"), JSON.stringify({ name: native.name, version: "1.0.0" }));
    await write(path.join(home, "binding.node"), machO(native.arch));
    await chmod(path.join(root, home, "binding.node"), 0o644);
    if (native.host === "esbuild") {
      await write(path.join(home, "bin", "esbuild"), machO(native.arch));
      await chmod(path.join(root, home, "bin", "esbuild"), 0o755);
    }
    // pnpm links every installed slice into the host's sibling set, which is
    // how copying vite's closure drags the foreign ones into the staged tree.
    await mkdir(path.dirname(path.join(store, native.name)), { recursive: true });
    await symlink(path.join(root, home), path.join(store, native.name));
  }
  // esbuild's postinstall swaps its JS `bin/esbuild` shim for a hard link to
  // the host's native binary when that slice is installed. The shim stays
  // otherwise (an install for a foreign CPU only, or on Windows).
  const hostSlice = natives.find((native) => native.host === "esbuild" && native.arch === os.arch());
  await write(
    path.join(path.relative(root, store), "esbuild", "bin", "esbuild"),
    hostSlice && platform !== "win32" ? machO(os.arch()) : '#!/usr/bin/env node\nrequire("../lib/main.js");\n',
  );
  await chmod(path.join(store, "esbuild", "bin", "esbuild"), 0o755);
  // fsevents ships a universal binary; it must survive every pruning pass.
  await write(
    path.join(path.relative(root, store), "fsevents", "package.json"),
    JSON.stringify({ name: "fsevents", version: "2.3.3" }),
  );
  await write(path.join(path.relative(root, store), "fsevents", "fsevents.node"), machO("x64", "arm64"));
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
  assert.equal(manifest.sourceRepository, presentationSourceRepository());
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

// vite's own sibling set links @types/node; pnpm stores it at
// .pnpm/@types+node@X/node_modules/@types/node, and copying that package's
// "siblings" from the scope directory used to land it at node_modules/node.
test("copies a scoped pnpm sibling under its scope, not at the top level", async (t) => {
  const { source, dest } = await stageInto(t);
  const store = path.join(source, "node_modules", ".pnpm", "vite@6.4.3", "node_modules");
  const typesHome = path.join(source, "node_modules", ".pnpm", "@types+node@26.0.0", "node_modules", "@types", "node");
  await mkdir(typesHome, { recursive: true });
  await writeFile(path.join(typesHome, "package.json"), JSON.stringify({ name: "@types/node", version: "26.0.0" }));
  await mkdir(path.join(store, "@types"), { recursive: true });
  await symlink(typesHome, path.join(store, "@types", "node"));

  await stagePresentationRuntime({ source, dest });

  await stat(path.join(dest, "node_modules", "@types", "node", "package.json"));
  await assert.rejects(stat(path.join(dest, "node_modules", "node")), { code: "ENOENT" });
});

test("stages rolldown natives when the vite closure has no rollup", async (t) => {
  const { source, dest } = await stageInto(t);
  const rollup = nativePackages().find((native) => native.host === "rollup");
  assert.ok(rollup, "expected rollup in nativePackages()");
  // No rollup in the closure means no rollup slices linked beside it either.
  for (const entry of ["rollup", "@rollup"]) {
    await rm(path.join(source, "node_modules", ".pnpm", "vite@6.4.3", "node_modules", entry), {
      recursive: true,
      force: true,
    });
  }
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

test("sourceRepository defaults to the neutral component name and follows the environment", () => {
  assert.equal(presentationSourceRepository({}), "presentation");
  assert.equal(presentationSourceRepository({ PRESENTATION_SOURCE_REPOSITORY: "  " }), "presentation");
  assert.equal(
    presentationSourceRepository({ PRESENTATION_SOURCE_REPOSITORY: "example.com/presentation" }),
    "example.com/presentation",
  );
});

// An Intel package built on Apple Silicon (or the reverse) must carry the
// target's natives and say so, or the shipped runtime.json claims the host's
// slice for a tree that cannot load on it.
function withTargetArch(t, arch, platform) {
  const previous = {
    PRESENTATION_TARGET_ARCH: process.env.PRESENTATION_TARGET_ARCH,
    PRESENTATION_TARGET_PLATFORM: process.env.PRESENTATION_TARGET_PLATFORM,
  };
  process.env.PRESENTATION_TARGET_ARCH = arch;
  if (platform) process.env.PRESENTATION_TARGET_PLATFORM = platform;
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

const otherArch = () => (os.arch() === "arm64" ? "x64" : "arm64");

test("stages the target architecture's natives and records that slice in runtime.json", async (t) => {
  const other = otherArch();
  const { source, dest } = await stageInto(t, { archs: [os.arch(), other] });
  withTargetArch(t, other);

  await stagePresentationRuntime({ source, dest });

  const manifest = JSON.parse(await readFile(path.join(dest, "runtime.json"), "utf8"));
  assert.equal(manifest.arch, other, "runtime.json must name the staged slice, not the build host");
  assert.equal(manifest.platform, process.platform);
  for (const native of nativePackages(process.platform, other)) {
    await stat(path.join(dest, "node_modules", native.name, "binding.node"));
  }

  // The checkout was installed for both CPUs, so vite's closure brought the
  // host's slice along too. None of it may ship: it is 30 MB of Mach-O the
  // target never loads, signed and notarized for nothing.
  const expectedPruned = [];
  for (const native of nativePackages(process.platform, os.arch())) {
    await assert.rejects(stat(path.join(dest, "node_modules", native.name)), { code: "ENOENT" }, native.name);
    expectedPruned.push(path.join("node_modules", native.name));
  }
  // esbuild's own bin/esbuild was pnpm's hard link to the host binary.
  await assert.rejects(stat(path.join(dest, "node_modules", "esbuild", "bin", "esbuild")), { code: "ENOENT" });
  expectedPruned.push(path.join("node_modules", "esbuild", "bin", "esbuild"));
  assert.deepEqual(manifest.prunedNatives, expectedPruned.sort());

  // What is left is the target's: every slice package present is the target's,
  // every Mach-O carries the target CPU, and the universal fsevents is untouched.
  const slices = [];
  for (const entry of await readdir(path.join(dest, "node_modules"), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (!entry.name.startsWith("@")) {
      if (isNativeSlicePackage(entry.name)) slices.push(entry.name);
      continue;
    }
    for (const child of await readdir(path.join(dest, "node_modules", entry.name))) {
      const name = `${entry.name}/${child}`;
      if (isNativeSlicePackage(name)) slices.push(name);
    }
  }
  assert.deepEqual(slices.sort(), nativePackages(process.platform, other).map((native) => native.name).sort());
  assert.deepEqual(await findForeignMachO(dest, other), []);
  await stat(path.join(dest, "node_modules", "fsevents", "fsevents.node"));
  assert.ok(!manifest.nativeModules.some((file) => file.includes(`-${os.arch()}`)), "runtime.json lists pruned natives");
  assert.ok(manifest.nativeModules.includes(path.join("node_modules", "fsevents", "fsevents.node")));
});

test("a host-arch build from a dual-arch checkout prunes the other slice and keeps esbuild's CLI", async (t) => {
  const other = otherArch();
  const { source, dest } = await stageInto(t, { archs: [os.arch(), other] });

  await stagePresentationRuntime({ source, dest });

  const manifest = JSON.parse(await readFile(path.join(dest, "runtime.json"), "utf8"));
  assert.equal(manifest.arch, os.arch());
  assert.deepEqual(
    manifest.prunedNatives,
    nativePackages(process.platform, other).map((native) => path.join("node_modules", native.name)).sort(),
  );
  for (const native of nativePackages(process.platform, os.arch())) {
    await stat(path.join(dest, "node_modules", native.name, "binding.node"));
  }
  // The native CLI copy is the host's, so it stays.
  assert.deepEqual(
    machoArchitectures(await readFile(path.join(dest, "node_modules", "esbuild", "bin", "esbuild"))),
    [os.arch()],
  );
  assert.deepEqual(await findForeignMachO(dest, os.arch()), []);
});

test("a single-arch checkout has nothing to prune", async (t) => {
  const { source, dest } = await stageInto(t);
  await stagePresentationRuntime({ source, dest });
  const manifest = JSON.parse(await readFile(path.join(dest, "runtime.json"), "utf8"));
  assert.deepEqual(manifest.prunedNatives, []);
  await stat(path.join(dest, "node_modules", "esbuild", "bin", "esbuild"));
  await stat(path.join(dest, "node_modules", "fsevents", "fsevents.node"));
});

test("leaves esbuild's JS bin shim alone when postinstall did not replace it", async (t) => {
  const other = otherArch();
  // Installed for the target only: pnpm had no host binary to link in.
  const { source, dest } = await stageInto(t, { archs: [other] });
  withTargetArch(t, other);
  await stagePresentationRuntime({ source, dest });
  const shim = await readFile(path.join(dest, "node_modules", "esbuild", "bin", "esbuild"), "utf8");
  assert.match(shim, /^#!\/usr\/bin\/env node/);
  const manifest = JSON.parse(await readFile(path.join(dest, "runtime.json"), "utf8"));
  assert.deepEqual(manifest.prunedNatives, []);
});

test("refuses a macOS tree that still holds a Mach-O without the target slice", async (t) => {
  // Pinned to darwin so the rule is exercised wherever the tests run.
  const { source, dest } = await stageInto(t, { platform: "darwin", archs: ["arm64", "x64"] });
  withTargetArch(t, "x64", "darwin");
  // A converter built on an Apple Silicon host, handed to an Intel build.
  await writeFile(path.join(source, "tools", "bin", "mop-convert"), machO("arm64"));
  await assert.rejects(
    stagePresentationRuntime({ source, dest }),
    /Mach-O files without a x64 slice:\n {2}tools\/bin\/mop-convert \(arm64\)\nset MOP_CONVERT_BIN/,
  );
});

test("reads a Mach-O's architectures from its header", () => {
  assert.deepEqual(machoArchitectures(machO("x64")), ["x64"]);
  assert.deepEqual(machoArchitectures(machO("arm64")), ["arm64"]);
  assert.deepEqual(machoArchitectures(machO("x64", "arm64")), ["x64", "arm64"]);
  // FAT_MAGIC_64 uses 32-byte entries.
  const fat64 = Buffer.alloc(8 + 32 * 2);
  fat64.writeUInt32BE(0xcafebabf, 0);
  fat64.writeUInt32BE(2, 4);
  fat64.writeUInt32BE(MACHO_CPU_TYPE.arm64, 8);
  fat64.writeUInt32BE(MACHO_CPU_TYPE.x64, 40);
  assert.deepEqual(machoArchitectures(fat64), ["arm64", "x64"]);
  // Not Mach-O: a JS shim, a shell script, a Java class file (same magic as
  // FAT_MAGIC, followed by a version number no fat header would have).
  assert.equal(machoArchitectures(Buffer.from("#!/usr/bin/env node\n")), null);
  assert.equal(machoArchitectures(Buffer.from("#!/bin/sh\n")), null);
  assert.equal(machoArchitectures(Buffer.from([0xca, 0xfe, 0xba, 0xbe, 0x00, 0x00, 0x00, 0x34, 0, 0, 0, 0])), null);
  assert.equal(machoArchitectures(Buffer.alloc(0)), null);
});

test("knows the native slice families and nothing else", () => {
  for (const name of [
    "@esbuild/darwin-arm64",
    "@esbuild/linux-loong64",
    "@esbuild/win32-ia32",
    "@rollup/rollup-darwin-x64",
    "@rollup/rollup-linux-x64-gnu",
    "@rollup/rollup-android-arm-eabi",
    "@rolldown/binding-darwin-arm64",
    "@rolldown/binding-wasm32-wasi",
    "lightningcss-win32-x64-msvc",
  ]) {
    assert.ok(isNativeSlicePackage(name), name);
  }
  for (const name of ["esbuild", "rollup", "rolldown", "lightningcss", "@rollup/pluginutils", "@rolldown/pluginutils", "fsevents", "lightningcss-cli"]) {
    assert.ok(!isNativeSlicePackage(name), name);
  }
});

test("refuses a target architecture whose natives are not installed in the checkout", async (t) => {
  const other = os.arch() === "arm64" ? "x64" : "arm64";
  const { source, dest } = await stageInto(t);
  withTargetArch(t, other);

  await assert.rejects(
    stagePresentationRuntime({ source, dest }),
    new RegExp(`native package @esbuild/${process.platform}-${other} .* is missing`),
  );
});

/**
 * A Windows tree staged on a Mac. Nothing in the fake checkout is for win32:
 * the natives come from a fetched directory (fetch-presentation-natives.mjs),
 * the converter is handed in as mop-convert.exe, and everything platform-bound
 * in the result must be the target's, not the host's.
 */
test("stages a win32-x64 tree on a foreign host: msvc natives from a fetched dir, mop-convert.exe, target in runtime.json", async (t) => {
  const { source, dest } = await stageInto(t);
  const wanted = nativePackages("win32", "x64");
  assert.deepEqual(
    wanted.map((native) => native.name),
    ["@esbuild/win32-x64", "@rollup/rollup-win32-x64-msvc", "@rolldown/binding-win32-x64-msvc", "lightningcss-win32-x64-msvc"],
  );

  // The staged hosts must declare the win32 slice, as the real packages do.
  const store = path.join(source, "node_modules", ".pnpm", "vite@6.4.3", "node_modules");
  for (const native of wanted) {
    const manifestPath = path.join(store, native.host, "package.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    manifest.optionalDependencies[native.name] = "1.0.0";
    await writeFile(manifestPath, JSON.stringify(manifest));
  }
  const fetched = path.join(source, "..", "natives-win32-x64");
  for (const native of wanted) {
    await mkdir(path.join(fetched, native.name), { recursive: true });
    await writeFile(path.join(fetched, native.name, "package.json"), JSON.stringify({ name: native.name, version: "1.0.0" }));
    await writeFile(path.join(fetched, native.name, "binding.node"), "win32");
  }
  const converter = path.join(source, "..", "mop-convert.exe");
  await writeFile(converter, "MZ");
  await chmod(converter, 0o755);

  const result = await stagePresentationRuntime({
    source,
    dest,
    target: { platform: "win32", arch: "x64" },
    nativePackagesDir: fetched,
    converterSource: converter,
  });
  assert.deepEqual(result.target, { platform: "win32", arch: "x64" });
  assert.equal(result.converter, path.join(dest, "tools", "bin", "mop-convert.exe"));
  await stat(path.join(dest, "tools", "bin", "mop-convert.exe"));
  await assert.rejects(stat(path.join(dest, "tools", "bin", "mop-convert")), { code: "ENOENT" });
  for (const native of wanted) {
    await stat(path.join(dest, "node_modules", native.name, "binding.node"));
  }
  // The host's own slice is still in the tree (it came with vite's pnpm
  // siblings); what matters is that the target's is there too.
  const manifest = JSON.parse(await readFile(path.join(dest, "runtime.json"), "utf8"));
  assert.equal(manifest.platform, "win32");
  assert.equal(manifest.arch, "x64");
  assert.equal(manifest.stagedOn, `${process.platform}-${os.arch()}`);
  assert.equal(manifest.converter, path.join("tools", "bin", "mop-convert.exe"));
});

test("a win32 target without fetched natives says how to get them", async (t) => {
  const { source, dest } = await stageInto(t);
  const converter = path.join(source, "..", "mop-convert.exe");
  await writeFile(converter, "MZ");
  await chmod(converter, 0o755);
  await assert.rejects(
    stagePresentationRuntime({ source, dest, target: { platform: "win32", arch: "x64" }, converterSource: converter }),
    /fetch-presentation-natives\.mjs --platform win32 --arch x64/,
  );
});

test("findStrayNodeBinaries finds node and node.exe anywhere in the tree, and nothing else", async (t) => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "officedex-stray-"));
  t.after(() => rm(tmp, { recursive: true, force: true }));
  await mkdir(path.join(tmp, "a", "bin"), { recursive: true });
  await writeFile(path.join(tmp, "a", "bin", "node.exe"), "");
  await writeFile(path.join(tmp, "node"), "");
  await writeFile(path.join(tmp, "a", "node_modules.txt"), "");
  assert.deepEqual(await findStrayNodeBinaries(tmp), [path.join(tmp, "a", "bin", "node.exe"), path.join(tmp, "node")]);
});

test("a win32-x64 target keeps only its own slice: other platforms, other CPUs and fsevents are pruned", async (t) => {
  // vite's pnpm siblings bring the host's darwin natives (and fsevents) into a
  // Windows tree; a checkout installed for several slices brings those too.
  const tmp = await mkdtemp(path.join(os.tmpdir(), "officedex-prune-"));
  t.after(() => rm(tmp, { recursive: true, force: true }));
  const modules = path.join(tmp, "node_modules");
  for (const name of [
    "@rolldown/binding-darwin-arm64",
    "@rolldown/binding-win32-x64-msvc",
    "@rolldown/binding-win32-arm64-msvc",
    "@esbuild/darwin-x64",
    "@esbuild/win32-x64",
    "lightningcss-darwin-arm64",
    "lightningcss-win32-x64-msvc",
    "fsevents",
    "lodash-es",
    "vite",
    "@rolldown/pluginutils",
  ]) {
    await mkdir(path.join(modules, ...name.split("/")), { recursive: true });
    await writeFile(path.join(modules, ...name.split("/"), "package.json"), JSON.stringify({ name }));
  }
  const pruned = await pruneForeignNatives(tmp, { platform: "win32", arch: "x64" });
  assert.deepEqual(
    pruned,
    [
      "@esbuild/darwin-x64",
      "@rolldown/binding-darwin-arm64",
      "@rolldown/binding-win32-arm64-msvc",
      "fsevents",
      "lightningcss-darwin-arm64",
    ].map((name) => path.join("node_modules", ...name.split("/"))).sort(),
  );
  for (const kept of ["@rolldown/binding-win32-x64-msvc", "@esbuild/win32-x64", "lightningcss-win32-x64-msvc", "lodash-es", "vite", "@rolldown/pluginutils"]) {
    await stat(path.join(modules, ...kept.split("/"), "package.json"));
  }
});

test("a darwin target keeps fsevents and only its own CPU's slice", async (t) => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "officedex-prune-"));
  t.after(() => rm(tmp, { recursive: true, force: true }));
  const modules = path.join(tmp, "node_modules");
  for (const name of ["@esbuild/darwin-arm64", "@esbuild/darwin-x64", "@esbuild/win32-x64", "fsevents"]) {
    await mkdir(path.join(modules, ...name.split("/")), { recursive: true });
  }
  assert.deepEqual(await pruneForeignNatives(tmp, { platform: "darwin", arch: "x64" }), [
    path.join("node_modules", "@esbuild", "darwin-arm64"),
    path.join("node_modules", "@esbuild", "win32-x64"),
  ]);
  await stat(path.join(modules, "@esbuild", "darwin-x64"));
  await stat(path.join(modules, "fsevents"));
});

test("development-only directories and files are pruned from node_modules; licences and runtime files stay", async (t) => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "officedex-devprune-"));
  t.after(() => rm(tmp, { recursive: true, force: true }));
  const modules = path.join(tmp, "node_modules");
  const write = async (rel, body = "") => {
    const file = path.join(modules, rel);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, body);
  };
  await write("katex/dist/katex.js");
  await write("katex/dist/katex.js.map");
  await write("katex/dist/katex.d.ts");
  await write("katex/contrib/mathtex-script-type/mathtex-script-type.js");
  await write("katex/test/katex-spec.js");
  await write("katex/README.md");
  await write("katex/LICENSE");
  await write("katex/CHANGELOG.md");
  await write("@scope/pkg/lib/index.mjs");
  await write("@scope/pkg/lib/index.test.mjs");
  await write("@scope/pkg/__tests__/x.js");
  await write("@scope/pkg/LICENSE.txt");
  // A package whose *name* is test is a package, not a test tree.
  await write("test/index.js");
  const result = await pruneDevelopmentFiles(modules);
  assert.deepEqual(result, { directories: 2, files: 5 });
  for (const kept of ["katex/dist/katex.js", "katex/contrib/mathtex-script-type/mathtex-script-type.js", "katex/LICENSE", "@scope/pkg/lib/index.mjs", "@scope/pkg/LICENSE.txt", "test/index.js"]) {
    await stat(path.join(modules, kept));
  }
  for (const gone of ["katex/dist/katex.js.map", "katex/dist/katex.d.ts", "katex/test", "katex/README.md", "katex/CHANGELOG.md", "@scope/pkg/lib/index.test.mjs", "@scope/pkg/__tests__"]) {
    await assert.rejects(stat(path.join(modules, gone)), { code: "ENOENT" }, gone);
  }
});
