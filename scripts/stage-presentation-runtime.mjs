#!/usr/bin/env node
// Stage the MOP authoring runtime (the fegit presentation checkout) into
// build/presentation/ so bundle-runtime.mjs can copy it into the packaged app.
//
// The MOP worker does not merely shell out to mop-convert: it boots a Vite SSR
// server rooted at the presentation checkout and ssrLoadModule()s the engine and
// office-js sources. So the app needs a real directory, not just the converter
// binary. Everything staged here was derived from the worker's actual module
// graph — see PRESENTATION_SOURCES below.
import { access, chmod, cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
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
  {
    from: "packages/presentation-app/public/presentation-assets/diagram",
    required: true,
  },
  { from: "quality/deps-golden/lib", required: true },
  // Workspace packages imported by bare specifier from the graph above.
  { from: "mop/runtime", required: true },
  { from: "bos/dist/mop-wasm/pkg", required: true },
  // The blank deck every generated presentation is cloned from.
  { from: "tools/fixtures/blank-presentation", required: true },
]);

// Dev-only payloads inside the staged packages. reference-cache alone is ~107MB
// of captured PowerPoint reference material used by the differential audit
// tooling; none of it is read at authoring time.
export const PRESENTATION_PRUNE = Object.freeze([
  "packages/presentation-office-js/reference-cache",
  "packages/presentation-office-js/differential",
  "packages/presentation-office-js/scripts",
  "packages/presentation-office-js/baseline",
]);

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

function converterName() {
  return process.platform === "win32" ? "mop-convert.exe" : "mop-convert";
}

// esbuild and rollup each load a platform-specific native package at runtime and
// throw if it is absent. The version must match the host package exactly, so
// derive it from the staged copy rather than assuming a hoisted top-level one:
// pnpm may hold several versions side by side in .pnpm/.
export function nativePackages(platform = process.platform, arch = os.arch()) {
  const slice = `${platform === "win32" ? "win32" : platform}-${arch}`;
  return [
    { host: "esbuild", name: `@esbuild/${slice}` },
    { host: "rollup", name: `@rollup/rollup-${slice}` },
  ];
}

// Find a native package at the exact version the staged host package expects.
// Checks the host's own node_modules and the top level first (both are plain
// resolution), then the pnpm store, which is where a non-hoisted install keeps
// it. Returns null when no matching version exists.
async function findNativePackage(root, staged, { host, name }) {
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

export function resolvePresentationSource(explicit = process.env.PRESENTATION_SOURCE_DIR) {
  const candidates = [];
  const configured = String(explicit || "").trim();
  if (configured) candidates.push(configured);
  else candidates.push(path.join(ROOT, "..", "presentation"), path.join(ROOT, "presentation"));
  for (const candidate of candidates) {
    const resolved = path.resolve(candidate);
    // Same four markers officecli's validMOPPresentationRoot() checks, so a
    // root accepted here is a root the runtime will accept.
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

export async function stagePresentationRuntime({ source, dest = DEST } = {}) {
  const root = source || resolvePresentationSource();
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
    if (!existsSync(path.join(root, entry.from))) {
      if (entry.required) throw new Error(`presentation source is missing ${entry.from} in ${root}`);
      continue;
    }
    await copyEntry(root, entry.from, path.join(dest, entry.from));
  }
  for (const pruned of PRESENTATION_PRUNE) {
    await rm(path.join(dest, pruned), { recursive: true, force: true });
  }

  const modules = path.join(dest, "node_modules");
  await mkdir(modules, { recursive: true });
  for (const entry of PRESENTATION_NODE_MODULES) {
    if (entry.closure) {
      // pnpm keeps a package's own dependencies beside it under .pnpm/<id>/
      // node_modules/. Copying only the linked package would leave vite unable
      // to resolve rollup, so copy the whole sibling set.
      const linked = path.join(root, "node_modules", entry.from);
      const real = await import("node:fs/promises").then((fs) => fs.realpath(linked));
      await cp(path.dirname(real), modules, { recursive: true, force: true, dereference: true });
      continue;
    }
    const installed = path.join("node_modules", entry.from);
    const source = existsSync(path.join(root, installed)) ? installed : entry.sourceFallback;
    if (!source || !existsSync(path.join(root, source))) {
      throw new Error(`presentation dependency ${entry.from} is missing from ${root}`);
    }
    await copyEntry(root, source, path.join(modules, entry.from));
  }
  // Cross-arch staging: an Intel package built on an Apple Silicon machine (or
  // the reverse) needs the *target's* esbuild/rollup natives, not the build
  // host's. pnpm only installs the host slice by default, so the presentation
  // checkout must have been installed with the target architecture included
  // (pnpm's supportedArchitectures) before staging can find them.
  const targetArch = String(process.env.PRESENTATION_TARGET_ARCH || "").trim() || os.arch();
  const targetPlatform =
    String(process.env.PRESENTATION_TARGET_PLATFORM || "").trim() || process.platform;
  for (const native of nativePackages(targetPlatform, targetArch)) {
    const found = await findNativePackage(root, dest, native);
    if (!found) {
      throw new Error(
        `native package ${native.name} (matching the staged ${native.host}) is missing ` +
          `from ${root}; install the presentation checkout for ${targetPlatform}-${targetArch} ` +
          "before staging (pnpm supportedArchitectures, or install on that platform)",
      );
    }
    const target = path.join(modules, native.name);
    await mkdir(path.dirname(target), { recursive: true });
    await cp(found.path, target, { recursive: true, force: true, dereference: true });
  }

  // mop-convert: the typed PPTX <-> MOP converter the worker shells out to.
  // Resolved the same way officecli's resolveMOPConvert() resolves it.
  const converter = converterName();
  const converterSource =
    String(process.env.MOP_CONVERT_BIN || "").trim() || path.join(root, "tools", "bin", converter);
  await access(converterSource, fsConstants.X_OK).catch(() => {
    throw new Error(
      `mop-convert not found or not executable at ${converterSource}; ` +
        "build it for this platform or set MOP_CONVERT_BIN",
    );
  });
  const converterDest = path.join(dest, "tools", "bin", converter);
  await mkdir(path.dirname(converterDest), { recursive: true });
  await cp(converterSource, converterDest, { force: true, dereference: true });
  if (process.platform !== "win32") await chmod(converterDest, 0o755);

  // notarize.mjs discovers signing targets with `find -type f -perm +111`, but
  // npm ships some native addons non-executable (rollup's .node is 0644). An
  // unsigned Mach-O left inside the bundle fails `codesign --verify --strict`,
  // so normalize the bits here to keep every native module in that sweep.
  const natives = await findNativeModules(dest);
  for (const native of natives) await chmod(native, 0o755);

  // Any node/node.exe inside the presentation tree would be a second V8
  // engine. It would get signed with hardened runtime + no entitlements and
  // trap the first time it JITs code (only Resources/mop-runtime/bin/node
  // carries the JIT entitlements). Refuse to stage rather than ship such a
  // bundle.
  const stray = execSync(
    `find "${dest}" -type f \\( -name node -o -name node.exe \\)`,
    { encoding: "utf8" },
  ).trim();
  if (stray) {
    throw new Error(
      `presentation runtime contains a stray node binary; the packaged app would trap under hardened runtime:\n${stray}`,
    );
  }

  await writeFile(
    path.join(dest, "runtime.json"),
    JSON.stringify(
      {
        name: "officedex-presentation-runtime",
        platform: process.platform,
        arch: os.arch(),
        source: root,
        sourceRepository: "fegit.shimo.im/presentation/presentation",
        sourceRevision,
        sourceDirty,
        converter: path.relative(dest, converterDest),
        nativeModules: natives.map((native) => path.relative(dest, native)).sort(),
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );
  return { root, dest, converter: converterDest };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  stagePresentationRuntime()
    .then(({ root, dest }) => console.log(`[stage-presentation-runtime] ${root} -> ${dest}`))
    .catch((error) => {
      console.error(`[stage-presentation-runtime] ${error.message}`);
      process.exit(1);
    });
}
