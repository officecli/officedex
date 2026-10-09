#!/usr/bin/env node
// Assembles the Windows amd64 package: `npm run dist:win`.
//
// The macOS flow is a chain of npm scripts; the Windows one is this file,
// because almost every step needs to be told it is building for win32-x64
// rather than for the host, and because the same sequence has to run in two
// places: on a Mac, which can stage and bundle everything but cannot execute a
// Windows binary, and on a Windows machine (the windows-smoke workflow, or a
// developer's PC), which is where the staged Node is actually started, the NSIS
// installer is produced natively and the app is launched.
//
// Order:
//
//   officecli            fetch the pinned officecli windows/amd64 release
//   mop-runtime          stage node.exe (file-checked on a Mac, executed on Windows)
//   presentation-natives npm-pack the win32-x64 esbuild/rolldown/lightningcss slices
//   presentation         stage the SSR tree with mop-convert.exe
//   writer-fonts         stage Writer's default-font closure
//   word2mow             stage convert.exe against its pinned digest
//   frontend             wails generate module + the desktop renderer build
//   wails                wails build -platform windows/amd64 -webview2 embed  -> officedex.exe
//   bundle               copy every payload beside officedex.exe
//   office2modoc         office2modoc_ffi.dll (x86_64-pc-windows-msvc) beside it
//   licenses             third-party licences + the bundled-font licence gate
//   verify               verify-packaged-runtime + a PE32+ x86-64 audit of every .exe/.dll/.node
//   installer (--installer)  makensis -> dist-artifacts/OfficeDex-v<x>-windows-amd64-installer.exe
//   zip       (--zip)        the portable tree -> dist-artifacts/OfficeDex-v<x>-windows-amd64.zip
//
// `--inputs <dir>` points at an unpacked windows-inputs archive
// (scripts/windows-inputs.mjs): the parts that only a Mac with the private
// sibling checkouts can produce -- dist/, the staged presentation tree, the
// Writer fonts, the two Rust converters -- are taken from there, and the
// frontend/presentation/writer-fonts steps become copies. That is how the
// Windows smoke runner builds without access to the presentation repository
// or the Rust registry.
//
// The package is assembled in its own directory (default build/win32-x64), not
// build/bin: on a Mac, build/bin may hold OfficeDex.app from a local build, and
// bundle-runtime would stage into the .app rather than beside the .exe.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { cp, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { bundleRuntime } from "./bundle-runtime.mjs";
import { OFFICE2MODOC_VERSION, bundleWindowsOffice2modoc } from "./bundle-office2modoc.mjs";
import { fetchPresentationNatives, nativesCacheDir } from "./fetch-presentation-natives.mjs";
import { inspectPortableExecutable } from "./pe-executable.mjs";
import { prefetchWord2MowConvert, sha256File } from "./prefetch-word2mow-convert.mjs";
import { mainCheckoutRoot, stagePresentationRuntime } from "./stage-presentation-runtime.mjs";
import { stageMopRuntime } from "./stage-mop-runtime.mjs";
import { verifyPackagedRuntime } from "./verify-packaged-runtime.mjs";
import { assertNoHostMetadataFiles } from "./windows-inputs.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");

export const TARGET_PLATFORM = "win32";
export const DEFAULT_ARCH = "x64";

/**
 * Digest of the Windows build of mop-convert (see docs/windows-build.md for the
 * toolchain and command). word2mow's is in KNOWN_CONVERT_BUILDS like every
 * other slice; mop-convert has no table of its own (the macOS build is taken
 * from the presentation checkout's tools/bin), so its digest is pinned here for
 * the same reason the word2mow one is pinned at all: a silently swapped
 * converter must fail the build, not ship.
 */
export const PINNED_CONVERTER_BUILDS = Object.freeze({
  "mop-convert": Object.freeze({
    "win32-x64": Object.freeze({
      sha256: "0a6256df61618d9330127602a828f7d2a928545a3cacd1b21f1579e7630547e1",
      revision: "4e047c64b0ffe898dcc0317885861045a91cc032",
      toolchain: "cargo-zigbuild 0.23.4, zig 0.17.0, x86_64-pc-windows-gnu, release-desktop profile",
    }),
  }),
});

/**
 * office2modoc's Windows FFI, per release, from the third_party manifest in
 * officecli-internal. The manifest itself is preferred when the checkout is
 * reachable; this is the fallback for a build that only has the DLL.
 */
export const OFFICE2MODOC_WINDOWS_SHA256 = Object.freeze({
  "0.1.34": "a5fca02c382bc78de198c00d60464d5370c149603fe2f0ce25feef236716a9d5",
});

export const STEPS = Object.freeze([
  "officecli",
  "mop-runtime",
  "presentation-natives",
  "presentation",
  "writer-fonts",
  "word2mow",
  "frontend",
  "wails",
  "bundle",
  "office2modoc",
  "licenses",
  "verify",
  "installer",
  "zip",
]);

export function parseArgs(argv) {
  const options = {
    arch: DEFAULT_ARCH,
    out: path.join(ROOT, "build", `${TARGET_PLATFORM}-${DEFAULT_ARCH}`),
    artifacts: path.join(ROOT, "dist-artifacts"),
    installer: false,
    zip: false,
    skipFrontend: false,
    inputs: "",
    from: "",
    only: [],
    installScope: "machine",
    dryRun: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = () => {
      index += 1;
      if (argv[index] === undefined) throw new Error(`${flag} needs a value`);
      return argv[index];
    };
    switch (flag) {
      case "--arch": options.arch = value(); break;
      case "--out": options.out = path.resolve(value()); break;
      case "--artifacts": options.artifacts = path.resolve(value()); break;
      case "--installer": options.installer = true; break;
      case "--zip": options.zip = true; break;
      case "--skip-frontend": options.skipFrontend = true; break;
      case "--inputs": options.inputs = path.resolve(value()); break;
      case "--from": options.from = value(); break;
      case "--only": options.only = value().split(",").map((step) => step.trim()).filter(Boolean); break;
      case "--install-scope": options.installScope = value(); break;
      case "--dry-run": options.dryRun = true; break;
      default:
        throw new Error(`unknown flag ${flag}; see the header of scripts/dist-win.mjs`);
    }
  }
  if (options.arch !== "x64") throw new Error(`only win32-x64 is built today (got --arch ${options.arch})`);
  if (!["machine", "user"].includes(options.installScope)) throw new Error(`--install-scope must be machine or user`);
  for (const step of [options.from, ...options.only].filter(Boolean)) {
    if (!STEPS.includes(step)) throw new Error(`unknown step ${step}; steps are ${STEPS.join(", ")}`);
  }
  return options;
}

/** The ordered steps a run performs, given its flags. */
export function planSteps(options) {
  let steps = STEPS.filter((step) => {
    if (step === "installer") return options.installer;
    if (step === "zip") return options.zip;
    // With prepared inputs the presentation tree arrives staged, natives
    // included, and the frontend arrives built.
    if (step === "presentation-natives") return !options.inputs;
    return true;
  });
  if (options.from) steps = steps.slice(steps.indexOf(options.from));
  if (options.only.length > 0) steps = steps.filter((step) => options.only.includes(step));
  return steps;
}

/** Release asset names, matching build-mac-dmg.sh's OfficeDex-v<x>-darwin-<arch>.zip. */
export function artifactNames(version) {
  return {
    installer: `OfficeDex-v${version}-windows-amd64-installer.exe`,
    zip: `OfficeDex-v${version}-windows-amd64.zip`,
    summary: `OfficeDex-v${version}-windows-amd64.build.json`,
  };
}

/** Where the inputs for a step come from: a prepared inputs dir or build/cache. */
export function inputPaths({ inputs = "", arch = DEFAULT_ARCH, root = ROOT } = {}) {
  const slice = `${TARGET_PLATFORM}-${arch}`;
  if (inputs) {
    return {
      dist: path.join(inputs, "dist"),
      presentation: path.join(inputs, "presentation"),
      writerFonts: path.join(inputs, "writer-fonts"),
      mopConvert: path.join(inputs, "mop-convert", slice, "mop-convert.exe"),
      word2mow: path.join(inputs, "word2mow", slice, "convert.exe"),
    };
  }
  return {
    dist: "",
    presentation: "",
    writerFonts: "",
    mopConvert: process.env.MOP_CONVERT_BIN?.trim() || path.join(root, "build", "cache", "mop-convert", slice, "mop-convert.exe"),
    word2mow: process.env.OFFICEDEX_WORD2MOW_CONVERT_SRC?.trim() || path.join(root, "build", "cache", "word2mow", slice, "convert.exe"),
  };
}

/**
 * The office2modoc DLL and the digest it must have. Looks in build/cache (the
 * release workflow's layout), then in the officecli-internal checkout beside
 * the repository; the digest comes from that checkout's manifest when present.
 */
export async function resolveOffice2modocWindows({ root = ROOT, version = OFFICE2MODOC_VERSION, env = process.env } = {}) {
  const candidates = [];
  if (env.OFFICE2MODOC_WINDOWS_DLL?.trim()) candidates.push(path.resolve(env.OFFICE2MODOC_WINDOWS_DLL.trim()));
  candidates.push(path.join(root, "build", "cache", "office2modoc", version, "windows-amd64", "office2modoc_ffi.dll"));
  const siblings = [path.join(root, ".."), mainCheckoutRoot() ? path.join(mainCheckoutRoot(), "..") : ""].filter(Boolean);
  const thirdParty = siblings.map((dir) => path.join(dir, "officecli-internal", "third_party", "office2modoc-ffi", version));
  for (const dir of thirdParty) candidates.push(path.join(dir, "x86_64-pc-windows-msvc", "office2modoc_ffi.dll"));

  const source = candidates.find((candidate) => existsSync(candidate));
  if (!source) {
    throw new Error(
      `office2modoc_ffi.dll ${version} (x86_64-pc-windows-msvc) not found; looked at:\n  ${candidates.join("\n  ")}\n` +
        "set OFFICE2MODOC_WINDOWS_DLL, or stage it into build/cache/office2modoc/<version>/windows-amd64/",
    );
  }
  let expectedSha256 = "";
  for (const dir of thirdParty) {
    const manifest = path.join(dir, "manifest.json");
    if (!existsSync(manifest)) continue;
    const parsed = JSON.parse(await readFile(manifest, "utf8"));
    expectedSha256 = String(parsed.artifacts?.["x86_64-pc-windows-msvc"]?.sha256 || "");
    if (expectedSha256) break;
  }
  if (!expectedSha256) expectedSha256 = OFFICE2MODOC_WINDOWS_SHA256[version] || "";
  if (!expectedSha256) {
    throw new Error(`no pinned sha256 for office2modoc ${version} on Windows; add it to OFFICE2MODOC_WINDOWS_SHA256 in scripts/dist-win.mjs`);
  }
  return { source, expectedSha256 };
}

/**
 * Every PE image in the tree with what it is. A Windows package must be PE32+
 * x86-64 throughout: a Mach-O copied in by mistake, or an arm64 .node, fails
 * on the customer's machine and nowhere earlier.
 */
export async function auditPortableExecutables(dir, { arch = DEFAULT_ARCH } = {}) {
  const wanted = { format: "PE32+", machine: arch === "arm64" ? "arm64" : "x86-64" };
  const images = [];
  const walk = async (current) => {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile() && /\.(exe|dll|node)$/i.test(entry.name)) images.push(full);
    }
  };
  await walk(dir);
  const rows = [];
  const wrong = [];
  for (const image of images.sort()) {
    let result;
    try {
      result = await inspectPortableExecutable(image);
    } catch (error) {
      result = { format: "not PE", machine: error.message };
    }
    const relative = path.relative(dir, image);
    const ok = result.format === wanted.format && result.machine === wanted.machine;
    rows.push({ path: relative, ...result, size: (await stat(image)).size, ok });
    if (!ok) wrong.push(`${relative}: ${result.format} ${result.machine}`);
  }
  return { rows, wrong, wanted };
}

/**
 * Windows' MAX_PATH is 260 characters unless the machine opts into long paths,
 * and the NSIS installer writes under `C:\Program Files\OfficeDex\OfficeDex\`
 * (37 characters) or `C:\Users\<name>\AppData\Local\Programs\OfficeDex\`
 * (about 50 with a short user name). The staged presentation tree nests
 * node_modules several levels deep, so the longest relative path is what
 * decides whether an install can fail with "path too long" on a stock
 * machine. 200 leaves room for a user name; today's deepest file is 197.
 */
export const MAX_RELATIVE_PATH = 200;

/** Files whose path relative to `dir` is longer than the budget, longest first. */
export async function findOverlongPaths(dir, budget = MAX_RELATIVE_PATH) {
  const found = [];
  const walk = async (current) => {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(full);
      else {
        const relative = path.relative(dir, full);
        if (relative.length > budget) found.push({ path: relative, length: relative.length });
      }
    }
  };
  await walk(dir);
  return found.sort((a, b) => b.length - a.length);
}

/* ------------------------------------------------------------------ runner */

function log(step, message) {
  console.log(`[dist-win${step ? `:${step}` : ""}] ${message}`);
}

function run(command, args, { env = process.env, cwd = ROOT } = {}) {
  log("", `$ ${[command, ...args].join(" ")}`);
  const result = spawnSync(command, args, { stdio: "inherit", env, cwd, shell: false });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} exited with ${result.status}`);
}

function runNode(script, args = [], env = {}) {
  run(process.execPath, [path.join(HERE, script), ...args], { env: { ...process.env, ...env } });
}

async function packageVersion() {
  return JSON.parse(await readFile(path.join(ROOT, "package.json"), "utf8")).version;
}

async function copyTree(from, to, label) {
  if (!existsSync(from)) throw new Error(`${label} not found at ${from}`);
  await rm(to, { recursive: true, force: true });
  await mkdir(path.dirname(to), { recursive: true });
  await cp(from, to, { recursive: true, dereference: true });
  log("", `${from} -> ${to}`);
}

async function assertPresentationTarget(dir, arch) {
  const manifest = JSON.parse(await readFile(path.join(dir, "runtime.json"), "utf8"));
  if (manifest.platform !== TARGET_PLATFORM || manifest.arch !== arch) {
    throw new Error(`${dir} was staged for ${manifest.platform}-${manifest.arch}, not ${TARGET_PLATFORM}-${arch}`);
  }
}

export async function distWin(options) {
  const steps = planSteps(options);
  const version = await packageVersion();
  const names = artifactNames(version);
  const inputs = inputPaths(options);
  const { arch, out } = options;
  const slice = `${TARGET_PLATFORM}-${arch}`;
  const summary = {
    version,
    target: slice,
    builtOn: `${process.platform}-${os.arch()}`,
    builtAt: new Date().toISOString(),
    steps,
    artifacts: {},
  };
  log("", `OfficeDex ${version} for ${slice}; steps: ${steps.join(" -> ")}`);
  if (options.dryRun) return { steps, summary };

  for (const step of steps) {
    log(step, "start");
    switch (step) {
      case "officecli":
        runNode("fetch-officecli.mjs", [], {
          OFFICECLI_TARGET_PLATFORM: TARGET_PLATFORM,
          OFFICECLI_TARGET_ARCH: arch,
          // The stage dir is shared with macOS builds; a previous Mac stage
          // must not satisfy the "already staged" check by version alone.
          OFFICECLI_FORCE: process.env.OFFICECLI_FORCE ?? "0",
        });
        break;

      case "mop-runtime": {
        const result = await stageMopRuntime({ platform: TARGET_PLATFORM, arch });
        summary.mopRuntime = { probed: result.probed, version: result.version, unverifiedReason: result.unverifiedReason };
        log(step, result.probed ? `node ${result.version} executed and relocatable` : `not executed here: ${result.unverifiedReason}`);
        break;
      }

      case "presentation-natives": {
        const { fetched } = await fetchPresentationNatives({ platform: TARGET_PLATFORM, arch });
        log(step, fetched.map((native) => `${native.name}@${native.version}`).join(", "));
        break;
      }

      case "presentation": {
        const dest = path.join(ROOT, "build", "presentation");
        if (inputs.presentation) {
          await copyTree(inputs.presentation, dest, "prepared presentation tree");
        } else {
          if (!existsSync(inputs.mopConvert)) {
            throw new Error(`mop-convert.exe not found at ${inputs.mopConvert}; build it (docs/windows-build.md) or set MOP_CONVERT_BIN`);
          }
          await pinConverter("mop-convert", inputs.mopConvert, slice);
          const result = await stagePresentationRuntime({
            target: { platform: TARGET_PLATFORM, arch },
            nativePackagesDir: nativesCacheDir(TARGET_PLATFORM, arch),
            converterSource: inputs.mopConvert,
          });
          if (!result.playwrightStaged) log(step, "playwright is not staged (as on macOS); see stage-presentation-runtime.mjs");
        }
        await assertPresentationTarget(dest, arch);
        break;
      }

      case "writer-fonts":
        if (inputs.writerFonts) await copyTree(inputs.writerFonts, path.join(ROOT, "build", "writer-fonts"), "prepared Writer fonts");
        else runNode("stage-writer-fonts.mjs");
        break;

      case "word2mow": {
        const result = await prefetchWord2MowConvert({ platform: TARGET_PLATFORM, arch, source: inputs.word2mow });
        summary.word2mow = { sha256: result.sha256, revision: result.revision };
        log(step, `${result.source} -> ${result.dest} (word2mow ${result.revision})`);
        break;
      }

      case "frontend": {
        const dist = path.join(ROOT, "dist");
        if (inputs.dist) {
          await copyTree(inputs.dist, dist, "prepared renderer build");
          break;
        }
        if (options.skipFrontend) {
          if (!existsSync(path.join(dist, "index.html"))) throw new Error(`--skip-frontend but ${dist} has no index.html`);
          log(step, `skipped; using the existing ${dist}`);
          break;
        }
        // main.go embeds dist/; the renderer build needs the bindings wails
        // generates while compiling main.go. A placeholder breaks the cycle.
        await mkdir(dist, { recursive: true });
        if (!existsSync(path.join(dist, "index.html"))) await writeFile(path.join(dist, ".placeholder"), "");
        run("wails", ["generate", "module"]);
        run("bash", [path.join(HERE, "build-frontend-desktop.sh")]);
        break;
      }

      case "wails": {
        const bin = path.join(ROOT, "build", "bin");
        const built = path.join(bin, "officedex.exe");
        await rm(built, { force: true });
        run("wails", [
          "build",
          "-platform", "windows/amd64",
          // Embed Microsoft's WebView2 bootstrapper; the reasoning is in main.go.
          "-webview2", "embed",
          "-trimpath",
          "-s", // the frontend was built (or copied) in the previous step
          "-o", "officedex.exe",
          "-ldflags", `-X main.appVersion=${version}`,
        ]);
        if (!existsSync(built)) throw new Error(`wails build did not produce ${built}`);
        await rm(out, { recursive: true, force: true });
        await mkdir(out, { recursive: true });
        await rename(built, path.join(out, "officedex.exe"));
        log(step, `${path.join(out, "officedex.exe")}`);
        break;
      }

      case "bundle": {
        const target = await bundleRuntime({ platform: TARGET_PLATFORM, bin: out });
        if (!target || target.kind !== "windows-dir") throw new Error(`expected a windows-dir package in ${out}`);
        break;
      }

      case "office2modoc": {
        const { source, expectedSha256 } = await resolveOffice2modocWindows();
        const result = await bundleWindowsOffice2modoc({ app: out, source, expectedSha256 });
        summary.office2modoc = { version: OFFICE2MODOC_VERSION, sha256: result.sha256 };
        log(step, `${source} -> ${result.target}`);
        break;
      }

      case "licenses":
        runNode("bundle-licenses.mjs", ["--target", out]);
        runNode("verify-bundled-fonts.mjs", [out]);
        break;

      case "verify": {
        // Nothing from the build host's filesystem rides along: AppleDouble
        // files carry quarantine and where-from attributes, and a `._x.woff`
        // is also what the font licence gate trips over.
        await assertNoHostMetadataFiles(out, "the assembled Windows package");
        const overlong = await findOverlongPaths(out);
        if (overlong.length > 0) {
          throw new Error(
            `the assembled package has ${overlong.length} file(s) deeper than ${MAX_RELATIVE_PATH} characters, which can exceed MAX_PATH once installed:\n  ` +
              overlong.slice(0, 10).map((entry) => `${entry.length}  ${entry.path}`).join("\n  "),
          );
        }
        const result = await verifyPackagedRuntime(out, { platform: TARGET_PLATFORM, arch });
        log(step, `${result.present.length} payload(s) present`);
        for (const entry of result.degraded) log(step, `shipping without ${entry.split("\n")[0]}`);
        for (const entry of result.unverified) log(step, `NOT EXECUTED on this host -- ${entry}`);
        const audit = await auditPortableExecutables(out, { arch });
        for (const row of audit.rows) {
          log(step, `${row.ok ? "ok " : "BAD"} ${row.format.padEnd(6)} ${row.machine.padEnd(7)} ${String(row.size).padStart(10)}  ${row.path}`);
        }
        if (audit.wrong.length > 0) {
          throw new Error(`the package carries images that are not ${audit.wanted.format} ${audit.wanted.machine}:\n  ${audit.wrong.join("\n  ")}`);
        }
        summary.verify = { present: result.present, degraded: result.degraded, unverified: result.unverified, images: audit.rows };
        break;
      }

      case "installer": {
        await mkdir(options.artifacts, { recursive: true });
        const installer = path.join(options.artifacts, names.installer);
        const installerDir = path.join(ROOT, "build", "windows", "installer");
        await mkdir(path.join(installerDir, "tmp"), { recursive: true });
        await ensureWebView2Bootstrapper(installerDir);
        await rm(installer, { force: true });
        const defines = [
          `-DARG_WAILS_AMD64_BINARY=${path.join(out, "officedex.exe")}`,
          `-DARG_OFFICEDEX_PAYLOAD_DIR=${out}`,
          `-DARG_OFFICEDEX_INSTALLER_OUT=${installer}`,
          `-DINFO_PRODUCTVERSION=${version}`,
          `-DINFO_PROJECTNAME=OfficeDex`,
          `-DINFO_PRODUCTNAME=OfficeDex`,
          `-DINFO_COMPANYNAME=OfficeDex`,
          `-DPRODUCT_EXECUTABLE=officedex.exe`,
          `-DWAILS_INSTALL_SCOPE=${options.installScope}`,
          `-DREQUEST_EXECUTION_LEVEL=${options.installScope === "user" ? "user" : "admin"}`,
        ];
        const makensis = resolveMakensis();
        run(makensis, [...defines, "project.nsi"], { cwd: installerDir });
        if (!existsSync(installer)) throw new Error(`makensis did not produce ${installer}`);
        summary.artifacts.installer = await describeArtifact(installer);
        log(step, `${installer} (${summary.artifacts.installer.size} bytes, sha256 ${summary.artifacts.installer.sha256})`);
        break;
      }

      case "zip": {
        await mkdir(options.artifacts, { recursive: true });
        const zip = path.join(options.artifacts, names.zip);
        await rm(zip, { force: true });
        if (process.platform === "win32") {
          run("powershell", ["-NoProfile", "-Command", `Compress-Archive -Path '${out}\\*' -DestinationPath '${zip}' -Force`]);
        } else {
          run("zip", ["-r", "-X", "-q", zip, "."], { cwd: out });
        }
        summary.artifacts.zip = await describeArtifact(zip);
        log(step, `${zip} (${summary.artifacts.zip.size} bytes, sha256 ${summary.artifacts.zip.sha256})`);
        break;
      }

      default:
        throw new Error(`no runner for step ${step}`);
    }
    log(step, "done");
  }

  await mkdir(options.artifacts, { recursive: true });
  const summaryPath = path.join(options.artifacts, names.summary);
  await writeFile(summaryPath, JSON.stringify(summary, null, 2) + "\n", "utf8");
  log("", `summary written to ${summaryPath}`);
  return { steps, summary };
}

/**
 * The NSIS compiler to run. OFFICEDEX_MAKENSIS names another command -- on a
 * Mac, scripts/nsis/makensis-docker.sh, because Homebrew's makensis aborts on
 * start (see scripts/nsis/Dockerfile). On Windows the NSIS installer puts
 * makensis.exe under Program Files without adding it to PATH (GitHub's
 * windows-latest image included), so the usual locations are tried before
 * falling back to PATH.
 */
export function resolveMakensis({ platform = process.platform, env = process.env, exists = existsSync, root = ROOT } = {}) {
  if (env.OFFICEDEX_MAKENSIS?.trim()) return path.resolve(root, env.OFFICEDEX_MAKENSIS.trim());
  if (platform === "win32") {
    for (const programFiles of [env["ProgramFiles(x86)"], env.ProgramFiles, "C:\\Program Files (x86)", "C:\\Program Files"]) {
      if (!programFiles) continue;
      const candidate = path.join(programFiles, "NSIS", "makensis.exe");
      if (exists(candidate)) return candidate;
    }
  }
  return "makensis";
}

async function pinConverter(name, file, slice) {
  const pinned = PINNED_CONVERTER_BUILDS[name]?.[slice];
  if (!pinned) throw new Error(`no pinned ${name} build for ${slice}`);
  const digest = await sha256File(file);
  if (digest !== pinned.sha256) {
    throw new Error(`${name} digest mismatch for ${slice}: expected ${pinned.sha256}, got ${digest} (${file}); rebuild from ${pinned.revision} or update PINNED_CONVERTER_BUILDS`);
  }
}

/**
 * wails_tools.nsh installs Microsoft's WebView2 bootstrapper from
 * installer/tmp/, a file `wails build -nsis` writes from the copy embedded in
 * the Wails CLI (so its version follows the pinned Wails, not whatever the
 * Microsoft download link serves today). installer/tmp/ is not checked in, so
 * a fresh checkout (the CI runner) gets it the same way: a throwaway
 * `wails build -nsis` into a scratch name. That build also runs makensis,
 * which fails for want of the payload defines -- expected and ignored; the
 * bootstrapper has been written by then, and that is all this wants.
 */
async function ensureWebView2Bootstrapper(installerDir) {
  const bootstrapper = path.join(installerDir, "tmp", "MicrosoftEdgeWebview2Setup.exe");
  if (existsSync(bootstrapper)) return;
  log("installer", `${bootstrapper} is missing; letting wails write it`);
  const probe = "officedex-webview2-probe.exe";
  spawnSync(
    "wails",
    ["build", "-platform", "windows/amd64", "-nsis", "-s", "-skipbindings", "-o", probe, "-ldflags", "-X main.appVersion=0.0.0-probe"],
    { cwd: ROOT, stdio: "ignore", shell: false },
  );
  await rm(path.join(ROOT, "build", "bin", probe), { force: true });
  if (!existsSync(bootstrapper)) {
    throw new Error(`${bootstrapper} is still missing after \`wails build -nsis\`; is the Wails CLI (${process.env.WAILS_VERSION || "v2.x"}) on PATH?`);
  }
}

async function describeArtifact(file) {
  const bytes = await readFile(file);
  return { path: file, size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    await distWin(parseArgs(process.argv.slice(2)));
  } catch (error) {
    console.error(`[dist-win] ${error.message}`);
    process.exit(1);
  }
}
