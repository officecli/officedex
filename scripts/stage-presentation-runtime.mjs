#!/usr/bin/env node
// Stage the MOP authoring runtime (the fegit presentation checkout) into
// build/presentation/ so bundle-runtime.mjs can copy it into the packaged app.
//
// The MOP worker does not merely shell out to mop-convert: it boots a Vite SSR
// server rooted at the presentation checkout and ssrLoadModule()s the engine and
// office-js sources. So the app needs a real directory, not just the converter
// binary. Everything staged here was derived from the worker's actual module
// graph — see PRESENTATION_SOURCES below.
import {
  access,
  chmod,
  cp,
  lstat,
  mkdir,
  open,
  readdir,
  readFile,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const DEST = path.join(ROOT, "build", "presentation");

// Directories and files the worker's module graph actually reaches. Traced by
// booting the worker's four ssrLoadModule() entry points and reading Vite's
// resolved module graph, then confirmed by running officecli's
// TestPPTXMOPSkillWorkerReal against the staged tree.
export const PRESENTATION_SOURCES = Object.freeze([
  // Vite's SSR root needs the manifest and the tsconfig that package
  // tsconfigs extend, otherwise esbuild refuses to transform the sources.
  { from: "package.json", required: true },
  { from: "tsconfig.json", required: true },
  // The authored engine and the office-js host the worker loads.
  // Minified authoring runtime; built by presentation/scripts/build-ssr-runtime.mjs.
  // The worker prefers it over the TypeScript sources, which keeps the engine
  // out of the public installer in readable form.
  { from: "dist-ssr", required: true },
  { from: "packages/presentation-engine", required: true },
  { from: "packages/presentation-office-js", required: true },
  // SmartArt is loaded by an absolute Vite SSR URL, so the nested workspace
  // link under presentation-engine/node_modules is not sufficient. Keep the
  // package at the root-relative path used by the worker and root tsconfig.
  { from: "packages/deps/smartart", required: true },
  // Runtime data read directly from sourceRoot after the SSR graph has booted.
  // These are not visible in Vite's module graph, but authoring fails as soon
  // as it seeds native diagrams or installs the headless presentation host if
  // either directory is absent.
  //
  // `from` is where the staged copy lands, and it stays at the pre-2dbde19 path
  // because OfficeCLI's pptx_mop_skill_worker.mjs reads it from there.
  // `sources` lists where to find it: presentation 2dbde19 moved the product
  // app from packages/ to apps/, and older checkouts still have it in packages/.
  {
    from: "packages/presentation-app/public/presentation-assets/diagram",
    sources: [
      "apps/presentation-app/public/presentation-assets/diagram",
      "packages/presentation-app/public/presentation-assets/diagram",
    ],
    required: true,
  },
  { from: "quality/deps-golden/lib", required: true },
  // Workspace packages imported by bare specifier from the graph above.
  { from: "mop/runtime", required: true },
  // The SSR bundle is compiled against this wasm. bos/dist/mop-wasm/pkg is an
  // older snapshot; pairing it with the current JS wrapper fails at startup as
  // an opaque LinkError inside the obfuscated chunk, which is what the
  // packaged app reported as "chunk-GOFHCYK3.js:1" dumping the whole file.
  { from: "packages/mop-wasm", required: true },
  { from: "bos/dist/mop-wasm/pkg", required: true },
  // The blank deck every generated presentation is cloned from.
  { from: "tools/fixtures/blank-presentation", required: true },
  // The JSSDK Host runner and everything it imports.
  //
  // officecli's jssdk-design backend spawns this file directly
  // (internal/runtime/pptx_jssdk_design.go) and it is the *only* PPTX backend
  // the desktop allows — internal/bridge/client.go rejects every other value.
  // It was absent for as long as this list has existed, and nothing caught it:
  // the four markers a root is validated by (see resolvePresentationSource)
  // do not include the runner, so a tree missing it looks entirely healthy
  // until someone asks for a deck and gets "JSSDK Host runner unavailable".
  //
  // `jssdk-native-browser.ts` is reached through an absolute Vite SSR URL
  // (`import("/tools/lib/jssdk-native-browser.ts")`), so it appears in no
  // static import graph. assertRunnerClosure below covers the rest.
  { from: "tools/execute-jssdk.mjs", required: true },
  { from: "tools/batch-convert-pptx-to-mop.mjs", required: true },
  { from: "tools/lib/jssdk-native-runtime.mjs", required: true },
  { from: "tools/lib/jssdk-vibe-ops.mjs", required: true },
  { from: "tools/lib/jssdk-video-authoring.mjs", required: true },
  { from: "tools/lib/mop-converter-client.mjs", required: true },
  { from: "tools/lib/jssdk-native-browser.ts", required: true },
]);

// Dev-only payloads inside the staged packages. reference-cache alone is ~107MB
// of captured PowerPoint reference material used by the differential audit
// tooling; none of it is read at authoring time.
export const PRESENTATION_PRUNE = Object.freeze([
  // Authored TypeScript: the worker loads dist-ssr instead, so shipping the
  // sources would only publish a readable copy of the engine.
  "packages/presentation-engine/src",
  "packages/presentation-office-js/src",
  "packages/deps/smartart/src",
  // Ships in the public installer otherwise: it documents the compatibility
  // surface, the RPC protocol name and the host bridge interfaces.
  "packages/presentation-office-js/README.md",
  "packages/presentation-office-js/reference-cache",
  "packages/presentation-office-js/differential",
  "packages/presentation-office-js/scripts",
  "packages/presentation-office-js/baseline",
  // The workspace packages' own node_modules. pnpm links them, and copying with
  // dereference materialised every link: presentation-office-js carried a
  // second full copy of presentation-engine, which carried its @learnof deps,
  // which carried katex -- a chain 197 characters deep that no longer fits
  // Windows' MAX_PATH once installed, and ~70MB that nothing loads. The
  // worker imports the self-contained dist-ssr bundles (their only bare import
  // is node's crypto); the source fallback that would resolve these is the
  // development path, never the packaged one, and mop-wasm is staged at
  // packages/mop-wasm, which the worker tries first.
  "packages/presentation-engine/node_modules",
  "packages/presentation-office-js/node_modules",
  "packages/deps/smartart/node_modules",
  "mop/runtime/test",
]);

/**
 * What a published npm package carries that a runtime never reads: test
 * trees, documentation, source maps, type declarations, examples. Pruned from
 * the staged node_modules so the package is smaller and, on Windows, shallower.
 */
export const DEVELOPMENT_DIRECTORY_NAMES = Object.freeze([
  "test", "tests", "__tests__", "docs", "doc", "examples", "example", "benchmark", "benchmarks", "bench", ".github",
]);
export const DEVELOPMENT_FILE_PATTERNS = Object.freeze([
  /\.map$/i,
  /\.d\.(?:ts|mts|cts)$/i,
  /\.(?:spec|test)\.(?:[cm]?js|[cm]?ts|jsx|tsx)$/i,
  /^(?:changelog|changes|history|contributing|readme|authors)(?:\.|$)/i,
  /\.(?:md|markdown)$/i,
  /^\.(?:npmignore|eslintrc(?:\..*)?|prettierrc(?:\..*)?|editorconfig|travis\.yml)$/i,
]);

/** Files a licence check needs: never pruned, whatever their extension. */
function isLicenceFile(name) {
  return /^(?:licen[cs]e|copying|notice)/i.test(name);
}

/**
 * Removes development-only directories and files below `modules`. Returns the
 * counts for runtime.json. A directory named `test` under a package is a test
 * tree; a package *called* test would be its own directory in node_modules,
 * which this does not descend into by name, only by position.
 */
export async function pruneDevelopmentFiles(modules) {
  const result = { directories: 0, files: 0 };
  const walk = async (current, depth) => {
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        // depth 0 is node_modules itself and depth 1 a package (or scope);
        // only inside a package does a name like `test` mean a test tree.
        const insidePackage = depth >= (path.basename(current).startsWith("@") ? 2 : 1) && entry.name !== "node_modules";
        if (insidePackage && DEVELOPMENT_DIRECTORY_NAMES.includes(entry.name)) {
          await rm(full, { recursive: true, force: true });
          result.directories += 1;
          continue;
        }
        await walk(full, depth + 1);
        continue;
      }
      if (isLicenceFile(entry.name)) continue;
      if (DEVELOPMENT_FILE_PATTERNS.some((pattern) => pattern.test(entry.name))) {
        await rm(full, { force: true });
        result.files += 1;
      }
    }
  };
  await walk(modules, 0);
  return result;
}

// node_modules entries the SSR graph resolves. pnpm stores these as symlinks
// into .pnpm/, so each is copied dereferenced.
export const PRESENTATION_NODE_MODULES = Object.freeze([
  // Vite and its own runtime dependencies (rollup, postcss, esbuild, ...).
  { from: "vite", closure: true, required: true },
  // Bare specifiers imported by the engine/office-js sources.
  { from: "lodash-es", required: true },
  { from: "@learnof/ink", sourceFallback: "packages/deps/ink", required: true },
  { from: "@learnof/scientific-formula", sourceFallback: "packages/deps/scientific-formula", required: true },
]);

/** The converter's file name on the *target* platform, which may not be the host's. */
export function converterName(platform = process.platform) {
  return platform === "win32" ? "mop-convert.exe" : "mop-convert";
}

/**
 * The target a staged tree is for. The build host's platform is only the
 * default: a Windows package is staged on a Mac, and everything platform-bound
 * in the tree (natives, the converter's name, runtime.json) is the target's.
 */
export function resolveStagingTarget({
  platform = String(process.env.PRESENTATION_TARGET_PLATFORM || "").trim() || process.platform,
  arch = String(process.env.PRESENTATION_TARGET_ARCH || "").trim() || os.arch(),
} = {}) {
  return { platform, arch };
}

// esbuild, rollup (Vite 6/7) and rolldown (Vite 8) each load a platform-specific
// native package at runtime and throw if it is absent. lightningcss is the same
// for Vite 8's CSS pipeline. The version must match the host package exactly, so
// derive it from the staged copy rather than assuming a hoisted top-level one:
// pnpm may hold several versions side by side in .pnpm/.

// pnpm keeps a package at .pnpm/<id>/node_modules/<name> with its dependencies
// beside it. For a scoped name that is .pnpm/<id>/node_modules/@scope/<pkg>, so
// the sibling set is the grandparent: taking the parent would copy the scope
// directory's children to the top level (@types/node as node_modules/node,
// @esbuild/darwin-arm64 as node_modules/darwin-arm64).
function pnpmSiblingsOf(realPackageDir) {
  const parent = path.dirname(realPackageDir);
  return path.basename(parent).startsWith("@") ? path.dirname(parent) : parent;
}

async function copyPnpmSiblingSet(packageDir, destModules) {
  const siblings = pnpmSiblingsOf(await realpath(packageDir));
  await cp(siblings, destModules, { recursive: true, force: true, dereference: true });
  return siblings;
}

async function nestedPnpmPackages(siblingsDir) {
  const found = [];
  for (const entry of await readdir(siblingsDir, { withFileTypes: true })) {
    const full = path.join(siblingsDir, entry.name);
    if (entry.name.startsWith("@")) {
      if (!entry.isDirectory()) continue;
      for (const child of await readdir(full, { withFileTypes: true })) {
        found.push(path.join(full, child.name));
      }
      continue;
    }
    found.push(full);
  }
  return found;
}

// Vite 8's rolldown (and lightningcss/postcss) keep their runtime deps in
// their own .pnpm folder, not beside vite. Copying only vite's siblings leaves
// `import "@rolldown/pluginutils"` unresolved inside the bundle.
async function copyPnpmClosures(linkedPackage, destModules) {
  const siblingsDir = await copyPnpmSiblingSet(linkedPackage, destModules);
  for (const nested of await nestedPnpmPackages(siblingsDir)) {
    try {
      const info = await lstat(nested);
      if (!info.isSymbolicLink() && !info.isDirectory()) continue;
    } catch {
      continue;
    }
    const nestedSiblings = pnpmSiblingsOf(await realpath(nested));
    if (nestedSiblings === siblingsDir) continue;
    await copyPnpmSiblingSet(nested, destModules);
  }
}

// esbuild names its slices by platform-arch alone; rollup, rolldown and
// lightningcss (napi-rs conventions) add the ABI: -msvc on Windows, -gnu on
// Linux, nothing on macOS. `@rollup/rollup-win32-x64` does not exist.
function nativeAbiSuffix(platform) {
  if (platform === "win32") return "-msvc";
  if (platform === "linux") return "-gnu";
  return "";
}

export function nativePackages(platform = process.platform, arch = os.arch()) {
  const slice = `${platform}-${arch}`;
  const abi = nativeAbiSuffix(platform);
  return [
    { host: "esbuild", name: `@esbuild/${slice}` },
    { host: "rollup", name: `@rollup/rollup-${slice}${abi}` },
    { host: "rolldown", name: `@rolldown/binding-${slice}${abi}` },
    { host: "lightningcss", name: `lightningcss-${slice}${abi}` },
  ];
}

// The four families above publish one package per OS/CPU slice, and pnpm
// installs every slice named in supportedArchitectures. A checkout prepared for
// a cross-arch build therefore carries both the host's and the target's, and
// copyPnpmClosures copies them all: an Intel package staged on Apple Silicon
// shipped @esbuild/darwin-arm64, @rolldown/binding-darwin-arm64 and friends —
// ~30 MB of Mach-O that is signed, notarized and never loaded.
const NATIVE_SLICE =
  "(?:aix|android|darwin|freebsd|linux|netbsd|openbsd|sunos|win32|wasm32)-[a-z0-9]+(?:-[a-z0-9]+)*";
const NATIVE_SLICE_FAMILIES = Object.freeze([
  new RegExp(`^@esbuild/${NATIVE_SLICE}$`),
  new RegExp(`^@rollup/rollup-${NATIVE_SLICE}$`),
  new RegExp(`^@rolldown/binding-${NATIVE_SLICE}$`),
  new RegExp(`^lightningcss-${NATIVE_SLICE}$`),
]);

/** Whether `name` is a per-slice native companion of esbuild/rollup/rolldown/lightningcss. */
export function isNativeSlicePackage(name) {
  return NATIVE_SLICE_FAMILIES.some((family) => family.test(name));
}

// Mach-O cputype values (mach/machine.h) mapped to Node's os.arch() names.
// CPU_ARCH_ABI64 (0x01000000) marks the 64-bit variants.
const MACHO_CPU_TYPES = new Map([
  [0x00000007, "ia32"],
  [0x01000007, "x64"],
  [0x0000000c, "arm"],
  [0x0100000c, "arm64"],
]);

/**
 * The architectures a Mach-O image carries, as os.arch() names, read from its
 * own header: one for a thin image, one per slice for a universal (fat) one.
 * Returns null for anything that is not a Mach-O — a JS shim, a shell script,
 * an ELF. `bytes` is the start of the file; 1 KiB covers any real fat header.
 */
export function machoArchitectures(bytes) {
  if (bytes.length < 8) return null;
  const name = (cputype) => MACHO_CPU_TYPES.get(cputype) ?? `cputype-${cputype.toString(16)}`;
  const magicLE = bytes.readUInt32LE(0);
  const magicBE = bytes.readUInt32BE(0);
  // Thin images (MH_MAGIC / MH_MAGIC_64) are stored in the target's own byte
  // order; every 64-bit Apple target is little-endian, but accept both.
  if (magicLE === 0xfeedface || magicLE === 0xfeedfacf) return [name(bytes.readUInt32LE(4))];
  if (magicBE === 0xfeedface || magicBE === 0xfeedfacf) return [name(bytes.readUInt32BE(4))];
  // Universal images (FAT_MAGIC / FAT_MAGIC_64) are always big-endian: nfat_arch
  // then one fat_arch per slice (20 bytes, or 32 for the 64-bit variant), each
  // starting with its cputype. Java class files share the FAT_MAGIC bytes; like
  // file(1), treat an implausible slice count as not-a-Mach-O.
  if (magicBE === 0xcafebabe || magicBE === 0xcafebabf) {
    const count = bytes.readUInt32BE(4);
    if (count === 0 || count > 30) return null;
    const entrySize = magicBE === 0xcafebabe ? 20 : 32;
    const archs = [];
    for (let index = 0; index < count; index += 1) {
      const offset = 8 + index * entrySize;
      if (offset + 4 > bytes.length) break;
      archs.push(name(bytes.readUInt32BE(offset)));
    }
    return archs;
  }
  return null;
}

async function readHead(file, length = 1024) {
  const handle = await open(file, "r");
  try {
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

// A Mach-O that the target cannot execute: any Mach-O when the target is not
// macOS, otherwise one without a slice for the target's CPU. A universal
// binary that includes the target (fsevents ships fat) is fine.
async function isForeignMachO(file, platform, arch) {
  let archs;
  try {
    archs = machoArchitectures(await readHead(file));
  } catch {
    return false;
  }
  if (!archs) return false;
  return platform !== "darwin" || !archs.includes(arch);
}

/**
 * Remove every native slice package in the staged node_modules (nested ones
 * included) that is not the target's, plus esbuild's own `bin/esbuild` when it
 * is a Mach-O for another CPU: pnpm's postinstall replaces that JS shim with a
 * hard link to the *host's* binary, which copying the closure turned into a
 * 10 MB copy of the wrong slice. esbuild's library API never spawns it (Vite
 * goes through @esbuild/<slice>/bin/esbuild), so dropping it costs nothing.
 *
 * Returns the removed entries relative to `dest`, sorted, for runtime.json.
 */
export async function pruneForeignNatives(dest, { platform, arch }) {
  const wanted = nativePackages(platform, arch).map((native) => native.name);
  // Keep the target's package, and a libc-suffixed variant of it
  // (@rollup/rollup-linux-x64-gnu for a linux-x64 target).
  const isTargets = (name) => wanted.some((want) => name === want || name.startsWith(`${want}-`));
  const pruned = [];

  const visit = async (modules) => {
    let entries;
    try {
      entries = await readdir(modules, { withFileTypes: true });
    } catch {
      return;
    }
    const packages = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const dir = path.join(modules, entry.name);
      if (entry.name.startsWith("@")) {
        for (const child of await readdir(dir, { withFileTypes: true })) {
          if (child.isDirectory()) {
            packages.push({ name: `${entry.name}/${child.name}`, dir: path.join(dir, child.name) });
          }
        }
        continue;
      }
      packages.push({ name: entry.name, dir });
    }
    for (const pkg of packages) {
      // fsevents is macOS-only (a universal Mach-O that no other platform can
      // load); vite's closure brings it along whenever the tree is staged on
      // a Mac, so a Windows or Linux target drops it like any foreign slice.
      const foreignPackage =
        (isNativeSlicePackage(pkg.name) && !isTargets(pkg.name)) || (pkg.name === "fsevents" && platform !== "darwin");
      if (foreignPackage) {
        await rm(pkg.dir, { recursive: true, force: true });
        pruned.push(path.relative(dest, pkg.dir));
        continue;
      }
      if (pkg.name === "esbuild") {
        const bin = path.join(pkg.dir, "bin", "esbuild");
        if (existsSync(bin) && (await isForeignMachO(bin, platform, arch))) {
          await rm(bin, { force: true });
          pruned.push(path.relative(dest, bin));
        }
      }
      await visit(path.join(pkg.dir, "node_modules"));
    }
  };

  await visit(path.join(dest, "node_modules"));
  return pruned.sort();
}

/**
 * Every Mach-O in `dir` (native addons, dylibs and executables) that lacks a
 * slice for `arch`, as `{ file, archs }` relative to `dir`. This is the same
 * sweep as `find -perm +111 | xargs file | grep Mach-O`, and it is what the
 * pruning above is checked against: a wrong-arch converter or a native the
 * families above do not know about is caught here, not by a user whose Intel
 * app cannot load it.
 */
export async function findForeignMachO(dir, arch) {
  const foreign = [];
  const walk = async (current) => {
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
        continue;
      }
      if (!entry.isFile()) continue;
      let candidate = /\.(node|dylib|so)$/.test(entry.name);
      if (!candidate) {
        try {
          candidate = ((await stat(full)).mode & 0o111) !== 0;
        } catch {
          continue;
        }
      }
      if (!candidate) continue;
      let archs;
      try {
        archs = machoArchitectures(await readHead(full));
      } catch {
        continue;
      }
      if (archs && !archs.includes(arch)) foreign.push({ file: path.relative(dir, full), archs });
    }
  };
  await walk(dir);
  return foreign.sort((a, b) => a.file.localeCompare(b.file));
}

// Find a native package at the exact version the staged host package expects.
// Checks the host's own node_modules and the top level first (both are plain
// resolution), then the pnpm store, which is where a non-hoisted install keeps
// it, then `nativePackagesDir` -- a directory of packages fetched for another
// platform (scripts/fetch-presentation-natives.mjs), laid out as
// <dir>/<package name>/package.json. Returns null when no matching version
// exists.
async function findNativePackage(root, staged, { host, name }, nativePackagesDir = "") {
  let version = "";
  try {
    const hostManifest = JSON.parse(
      await readFile(path.join(staged, "node_modules", host, "package.json"), "utf8"),
    );
    version = String(hostManifest.optionalDependencies?.[name] || "").trim();
  } catch {
    // A host without a manifest is a staging bug; report it as a missing native.
    return null;
  }
  if (!version) return null;
  const candidates = [
    path.join(staged, "node_modules", host, "node_modules", name),
    path.join(root, "node_modules", name),
    // pnpm's store layout: @esbuild/darwin-arm64 -> @esbuild+darwin-arm64@X.Y.Z
    path.join(root, "node_modules", ".pnpm", `${name.replace("/", "+")}@${version}`, "node_modules", name),
    ...(nativePackagesDir ? [path.join(nativePackagesDir, name)] : []),
  ];
  for (const candidate of candidates) {
    if (!existsSync(path.join(candidate, "package.json"))) continue;
    try {
      const manifest = JSON.parse(await readFile(path.join(candidate, "package.json"), "utf8"));
      if (manifest.version === version) return { path: candidate, version };
    } catch {
      // Unreadable manifest: treat as a non-match and keep looking.
    }
  }
  return null;
}

/**
 * The repository this checkout belongs to, for a git worktree under
 * .claude/worktrees/: its siblings (presentation, writer) sit beside the main
 * checkout, not beside the worktree. Empty when git cannot tell.
 */
export function mainCheckoutRoot() {
  try {
    const common = execSync("git rev-parse --path-format=absolute --git-common-dir", {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return common ? path.dirname(common) : "";
  } catch {
    return "";
  }
}

export function resolvePresentationSource(explicit = process.env.PRESENTATION_SOURCE_DIR) {
  const candidates = [];
  const configured = String(explicit || "").trim();
  if (configured) candidates.push(configured);
  else {
    candidates.push(path.join(ROOT, "..", "presentation"), path.join(ROOT, "presentation"));
    const main = mainCheckoutRoot();
    if (main && main !== ROOT) candidates.push(path.join(main, "..", "presentation"));
  }
  for (const candidate of candidates) {
    const resolved = path.resolve(candidate);
    // The four markers officecli's validMOPPresentationRoot() looks for. They
    // identify a presentation checkout; they do not certify one. Passing them
    // only means the runtime will *select* this root — the jssdk-design
    // backend then needs tools/execute-jssdk.mjs and a playwright it does not
    // check for here, which is how a staged tree missing the runner was chosen
    // over a complete checkout and failed at generation time instead.
    const markers = [
      "package.json",
      path.join("node_modules", "vite", "dist", "node", "index.js"),
      path.join("bos", "dist", "mop-wasm", "pkg", "mop_wasm_bg.wasm"),
      path.join("tools", "fixtures", "blank-presentation", "content.json"),
    ];
    if (markers.every((marker) => existsSync(path.join(resolved, marker)))) return resolved;
  }
  throw new Error(
    `presentation checkout not found${configured ? ` at ${configured}` : ""}; ` +
    "set PRESENTATION_SOURCE_DIR to a prepared presentation checkout",
  );
}

async function copyEntry(source, from, to) {
  const src = path.join(source, from);
  await mkdir(path.dirname(to), { recursive: true });
  // dereference: pnpm links and Homebrew-style symlinks would otherwise bundle
  // dangling absolute paths, which codesign rejects outright.
  await cp(src, to, { recursive: true, force: true, dereference: true });
}

// Native addons and dylibs inside the staged tree. Each is a Mach-O that must be
// codesigned along with the bundle on macOS.
export async function findNativeModules(dir) {
  const found = [];
  const walk = async (current) => {
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile() && /\.(node|dylib|so)$/.test(entry.name)) found.push(full);
    }
  };
  await walk(dir);
  return found.sort();
}

/** The entry points officecli spawns or loads from the staged tree. */
const RUNNER_ENTRIES = Object.freeze(["tools/execute-jssdk.mjs"]);

/**
 * Every relative import reachable from the runner must exist in the staged tree.
 *
 * The runner is spawned as a plain Node process, so a missing sibling is not a
 * build error — it is a `ERR_MODULE_NOT_FOUND` thrown at the user, minutes into
 * a generation, from inside a subprocess. Listing the closure by hand in
 * PRESENTATION_SOURCES is what let the runner go unstaged in the first place;
 * this walks it instead, so the next import added upstream fails here rather
 * than in someone's app.
 *
 * Only static relative specifiers are followed. Bare specifiers are
 * node_modules' problem (PRESENTATION_NODE_MODULES) and dynamic URL imports
 * cannot be resolved without running Vite — `jssdk-native-browser.ts` is listed
 * explicitly above for exactly that reason.
 */
export async function assertRunnerClosure(dest, entries = RUNNER_ENTRIES) {
  const seen = new Set();
  const queue = [...entries];
  const missing = [];

  while (queue.length > 0) {
    const relative = queue.shift();
    if (seen.has(relative)) continue;
    seen.add(relative);

    const absolute = path.join(dest, relative);
    if (!existsSync(absolute)) {
      missing.push(relative);
      continue;
    }
    if (!/\.(mjs|js)$/.test(relative)) continue;

    const source = await readFile(absolute, "utf8");
    for (const [, specifier] of source.matchAll(/\bfrom\s+"(\.[^"]+)"/g)) {
      queue.push(path.normalize(path.join(path.dirname(relative), specifier)));
    }
  }

  if (missing.length > 0) {
    throw new Error(
      `the JSSDK Host runner is incomplete in the staged tree; add to PRESENTATION_SOURCES:\n  ${missing.join("\n  ")}`,
    );
  }
  return [...seen].sort();
}

/**
 * What runtime.json records as the origin of the staged tree. The default is
 * the neutral component name; set PRESENTATION_SOURCE_REPOSITORY (or pass
 * sourceRepository) when the manifest should name the checkout's remote.
 */
export function presentationSourceRepository(env = process.env) {
  return String(env.PRESENTATION_SOURCE_REPOSITORY || "").trim() || "presentation";
}

export async function stagePresentationRuntime({
  source,
  dest = DEST,
  sourceRepository = presentationSourceRepository(),
  target = resolveStagingTarget(),
  nativePackagesDir = String(process.env.PRESENTATION_NATIVE_PACKAGES_DIR || "").trim(),
  converterSource = String(process.env.MOP_CONVERT_BIN || "").trim(),
} = {}) {
  const root = source || resolvePresentationSource();
  const { platform: targetPlatform, arch: targetArch } = target;
  let sourceRevision = "unknown";
  let sourceDirty = false;
  try {
    sourceRevision = execSync("git rev-parse HEAD", {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    sourceDirty = execSync("git status --porcelain --untracked-files=normal", {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim().length > 0;
  } catch {
    // Source archives may not contain Git metadata; runtime.json remains explicit.
  }
  await rm(dest, { recursive: true, force: true });
  await mkdir(dest, { recursive: true });

  for (const entry of PRESENTATION_SOURCES) {
    const candidates = entry.sources ?? [entry.from];
    const source = candidates.find((candidate) => existsSync(path.join(root, candidate)));
    if (!source) {
      if (entry.required) throw new Error(`presentation source is missing ${candidates.join(" or ")} in ${root}`);
      continue;
    }
    await copyEntry(root, source, path.join(dest, entry.from));
  }
  for (const pruned of PRESENTATION_PRUNE) {
    await rm(path.join(dest, pruned), { recursive: true, force: true });
  }

  await assertObfuscatedRuntime(path.join(dest, "dist-ssr"));
  const runnerClosure = await assertRunnerClosure(dest);

  const modules = path.join(dest, "node_modules");
  await mkdir(modules, { recursive: true });
  for (const entry of PRESENTATION_NODE_MODULES) {
    if (entry.closure) {
      // pnpm keeps a package's own dependencies beside it under .pnpm/<id>/
      // node_modules/. Copying only the linked package would leave vite unable
      // to resolve rollup/rolldown, so copy the whole sibling set, then each
      // nested host's own sibling set (rolldown → @rolldown/pluginutils).
      const linked = path.join(root, "node_modules", entry.from);
      await copyPnpmClosures(linked, modules);
      continue;
    }
    const installed = path.join("node_modules", entry.from);
    const source = existsSync(path.join(root, installed)) ? installed : entry.sourceFallback;
    if (!source || !existsSync(path.join(root, source))) {
      throw new Error(`presentation dependency ${entry.from} is missing from ${root}`);
    }
    await copyEntry(root, source, path.join(modules, entry.from));
  }
  // Cross-platform or cross-arch staging: an Intel or Windows package built on
  // an Apple Silicon machine needs the *target's* esbuild/rollup/rolldown
  // natives, not the build host's. pnpm only installs the host slice by
  // default, so either the presentation checkout was installed with the target
  // included (pnpm's supportedArchitectures) or the packages were fetched
  // separately into nativePackagesDir. Vite 8 replaced rollup with rolldown;
  // only copy natives for hosts that the staged vite closure actually contains.
  const copiedHosts = [];
  for (const native of nativePackages(targetPlatform, targetArch)) {
    if (!existsSync(path.join(dest, "node_modules", native.host, "package.json"))) continue;
    const found = await findNativePackage(root, dest, native, nativePackagesDir);
    if (!found) {
      throw new Error(
        `native package ${native.name} (matching the staged ${native.host}) is missing ` +
          `from ${root}${nativePackagesDir ? ` and ${nativePackagesDir}` : ""}; install the presentation checkout for ` +
          `${targetPlatform}-${targetArch} before staging (pnpm supportedArchitectures), or fetch the ` +
          `packages with scripts/fetch-presentation-natives.mjs --platform ${targetPlatform} --arch ${targetArch}`,
      );
    }
    const target = path.join(modules, native.name);
    await mkdir(path.dirname(target), { recursive: true });
    await cp(found.path, target, { recursive: true, force: true, dereference: true });
    copiedHosts.push(native.host);
  }
  if (!copiedHosts.includes("esbuild")) {
    throw new Error("staged vite closure is missing esbuild; cannot package a working SSR runtime");
  }
  if (!copiedHosts.includes("rollup") && !copiedHosts.includes("rolldown")) {
    throw new Error(
      "staged vite closure is missing rollup/rolldown; cannot package a working SSR runtime",
    );
  }
  // The closure copied above brought every installed slice along; keep only
  // the target's. Done after the copy so a missing target native still fails
  // with the message above rather than leaving a tree with no natives at all.
  const prunedNatives = await pruneForeignNatives(dest, { platform: targetPlatform, arch: targetArch });
  const prunedDevelopment = await pruneDevelopmentFiles(modules);

  // mop-convert: the typed PPTX <-> MOP converter the worker shells out to.
  // Resolved the same way officecli's resolveMOPConvert() resolves it, under
  // the *target's* name: a Windows tree carries mop-convert.exe even when it is
  // staged on a Mac, because that is what mop-converter-client.mjs looks for.
  const converter = converterName(targetPlatform);
  const converterFrom = converterSource || path.join(root, "tools", "bin", converter);
  await access(converterFrom, fsConstants.X_OK).catch(() => {
    throw new Error(
      `mop-convert not found or not executable at ${converterFrom}; ` +
        `build it for ${targetPlatform}-${targetArch} or set MOP_CONVERT_BIN`,
    );
  });
  const converterDest = path.join(dest, "tools", "bin", converter);
  await mkdir(path.dirname(converterDest), { recursive: true });
  await cp(converterFrom, converterDest, { force: true, dereference: true });
  if (process.platform !== "win32") await chmod(converterDest, 0o755);

  // notarize.mjs discovers signing targets with `find -type f -perm +111`, but
  // npm ships some native addons non-executable (rollup's .node is 0644). An
  // unsigned Mach-O left inside the bundle fails `codesign --verify --strict`,
  // so normalize the bits here to keep every native module in that sweep.
  const natives = await findNativeModules(dest);
  for (const native of natives) await chmod(native, 0o755);

  // On a macOS target nothing Mach-O may remain that the target CPU cannot
  // run: a native outside the families pruneForeignNatives knows, or a
  // mop-convert built for the build host, would be signed and notarized only
  // to fail at load time on the user's machine.
  if (targetPlatform === "darwin") {
    const foreign = await findForeignMachO(dest, targetArch);
    if (foreign.length > 0) {
      throw new Error(
        `staged presentation runtime for darwin-${targetArch} contains Mach-O files without a ${targetArch} slice:\n` +
          foreign.map(({ file, archs }) => `  ${file} (${archs.join(", ")})`).join("\n") +
          (foreign.some(({ file }) => file === path.relative(dest, converterDest))
            ? `\nset MOP_CONVERT_BIN to a mop-convert built for darwin-${targetArch}`
            : ""),
      );
    }
  }

  // Any node/node.exe inside the presentation tree would be a second V8
  // engine. It would get signed with hardened runtime + no entitlements and
  // trap the first time it JITs code (only Resources/mop-runtime/bin/node
  // carries the JIT entitlements). Refuse to stage rather than ship such a
  // bundle.
  const stray = await findStrayNodeBinaries(dest);
  if (stray.length > 0) {
    throw new Error(
      `presentation runtime contains a stray node binary; the packaged app would trap under hardened runtime:\n${stray.join("\n")}`,
    );
  }

  /*
   * The runner is staged; its browser is not.
   *
   * `tools/lib/jssdk-native-runtime.mjs` does `import { chromium } from
   * "playwright"`, and playwright is deliberately absent from
   * PRESENTATION_NODE_MODULES: staging it means shipping a Chromium inside the
   * app bundle — every Mach-O of it signed, under a hardened runtime that this
   * very script already refuses to hand a second V8 to (see the stray-node
   * check below). Whether the desktop's only PPTX backend may depend on a
   * browser is a product decision, not something to settle by quietly adding a
   * dependency here.
   *
   * So it is recorded rather than resolved: the staged tree is honest about
   * what it can and cannot run, and a build that ships without playwright says
   * so in runtime.json instead of failing for the user at generation time.
   */
  const playwrightStaged = existsSync(path.join(modules, "playwright"));

  await writeFile(
    path.join(dest, "runtime.json"),
    JSON.stringify(
      {
        name: "officedex-presentation-runtime",
        // The tree's target, not the build host's: a win32-x64 tree staged on
        // an arm64 Mac is a win32-x64 tree.
        platform: targetPlatform,
        arch: targetArch,
        stagedOn: `${process.platform}-${os.arch()}`,
        source: root,
        sourceRepository,
        sourceRevision,
        sourceDirty,
        converter: path.relative(dest, converterDest),
        jssdkRunner: {
          entry: RUNNER_ENTRIES[0],
          closure: runnerClosure,
          // false means the jssdk-design backend cannot run from this tree.
          playwright: playwrightStaged,
        },
        nativeModules: natives.map((native) => path.relative(dest, native)).sort(),
        // Native slice packages (and esbuild's host-arch CLI copy) that the
        // checkout had installed for other CPUs and this tree does not ship.
        prunedNatives,
        prunedDevelopment,
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );
  return { root, dest, converter: converterDest, playwrightStaged, target: { platform: targetPlatform, arch: targetArch } };
}

/**
 * Any node / node.exe inside the staged tree. Walked in JS rather than with
 * find(1) so the same check runs on a Windows build host.
 */
export async function findStrayNodeBinaries(dir) {
  const found = [];
  const walk = async (current) => {
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile() && (entry.name === "node" || entry.name === "node.exe")) found.push(full);
    }
  };
  await walk(dir);
  return found.sort();
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  stagePresentationRuntime()
    .then(({ root, dest, playwrightStaged }) => {
      console.log(`[stage-presentation-runtime] ${root} -> ${dest}`);
      if (!playwrightStaged) {
        console.warn(
          "[stage-presentation-runtime] playwright is not staged: the jssdk-design " +
            "PPTX backend cannot run from this tree, and it is the only backend the " +
            "desktop allows. Generation will fail with a missing-module error unless " +
            "OFFICECLI_MOP_PRESENTATION_ROOT points at a full presentation checkout.",
        );
      }
    })
    .catch((error) => {
      console.error(`[stage-presentation-runtime] ${error.message}`);
      process.exit(1);
    });
}

/**
 * The authored sources are pruned above, so dist-ssr is the only copy of the
 * engine that ships. Refuse to package a plain build: without obfuscation the
 * installer would still carry readable logic, which is the thing pruning the
 * sources was meant to prevent. javascript-obfuscator emits hexadecimal
 * identifiers, so their absence means the release step did not run.
 */
async function assertObfuscatedRuntime(runtimeDir) {
  const entries = await readdir(runtimeDir, { withFileTypes: true });
  const scripts = entries.filter(
    (entry) => entry.isFile() && entry.name.endsWith(".js"),
  );
  if (scripts.length === 0) {
    throw new Error(`no JavaScript found in ${runtimeDir}`);
  }
  for (const script of scripts) {
    const source = await readFile(path.join(runtimeDir, script.name), "utf8");
    if (!source.includes("_0x")) {
      throw new Error(
        `${script.name} is not obfuscated; build it with "pnpm run build:ssr-runtime:release" in the presentation checkout`,
      );
    }
  }
}
