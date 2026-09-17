#!/usr/bin/env node
// Asserts that a packaged build actually contains the runtime payloads it needs.
//
// This exists because their absence used to be indistinguishable from success.
// `verify-bundled-fonts` walks whatever font files it finds, so a package with
// no writer-fonts directory at all passed the licence gate -- green not because
// the bundle was clean but because there was nothing in it. On Windows that was
// the normal outcome: nothing copied the staged resources next to the
// executable, so DOCX editing shipped broken and no gate said so.
//
// Presence is checked here and licensing in verify-bundled-fonts.mjs; keeping
// them apart means neither can mask the other.
//
// For payloads that are executables, presence turned out to be its own version
// of the same lie: a mop-runtime directory holding a Node that aborts in dyld
// satisfied "the directory is there" for four days of builds. Those payloads
// are checked by running them -- see relocatable-runtime.mjs.

import { access, readdir, stat } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { verifyRelocatableRuntime } from "./relocatable-runtime.mjs";

/**
 * What a shippable package must contain, expressed against the resource root.
 *
 * `optional` payloads are declared rather than omitted: a build that cannot
 * carry one is a known gap we want printed on every run, not a silent absence.
 */
export const REQUIRED_RESOURCES = Object.freeze([
  Object.freeze({
    kind: "directory", at: "skills/aippt-jssdk-animation", label: "Native animation PPT Skill",
    contains: ["SKILL.md", "registry.json", "snapshot.json", "scripts/validate-animation.mjs"],
    why: "Animation tasks require the matching Skill and native playback validator",
  }),
  Object.freeze({
    kind: "directory",
    at: "skills/aippt-jssdk-design",
    label: "Verified JSSDK progressive Skill",
    contains: ["SKILL.md", "policy.json", "registry.json", "snapshot.json", "availability.json"],
    why: "PPT generation requires the portable progressive Skill with source programs and verification evidence",
  }),
  Object.freeze({
    kind: "directory",
    at: "writer-fonts",
    label: "Writer default-font closure",
    contains: ["prebuilt", "files"],
    why: "internal/writerfonts serves it; without it every font request 404s and DOCX layout has no metrics",
  }),
  Object.freeze({
    // Checked as a runtime, not as a directory: a directory holding a Node
    // that cannot start passed this gate for four days, and the failure
    // surfaced instead at the MOP worker, minutes into a user's generation.
    kind: "runtime",
    at: "mop-runtime",
    label: "MOP Node runtime",
    why: "the MOP worker needs its own Node; the host's is not used",
  }),
  Object.freeze({
    kind: "directory",
    at: "presentation",
    label: "MOP presentation runtime",
    contains: ["package.json"],
    why: "the worker boots a Vite SSR server rooted here",
  }),
  Object.freeze({
    kind: "binary",
    at: [path.join("presentation", "tools", "bin"), "mop-convert"],
    label: "mop-convert",
    why: "every PPTX import and export shells out to it; without it the editor can only report itself unavailable",
  }),
  Object.freeze({
    kind: "binary",
    at: ["officecli", "officecli"],
    label: "officecli",
    why: "the agent bridge shells out to it",
  }),
  Object.freeze({
    kind: "binary",
    at: ["word2mow", "convert"],
    label: "word2mow converter",
    optional: true,
    why: "DOCX <-> MOW conversion; no Windows build of it exists yet, so a Windows package ships without DOCX editing",
  }),
]);

/** Mirrors resolveBundleTarget in bundle-runtime.mjs: .app on macOS, loose beside the exe on Windows. */
export async function resolveResourceRoot(binDirectory) {
  const app = path.join(binDirectory, "OfficeDex.app");
  if (await exists(app)) return { kind: "macos-app", root: path.join(app, "Contents", "Resources") };
  for (const executable of ["officedex.exe", "officedex"]) {
    if (await exists(path.join(binDirectory, executable))) {
      return { kind: "windows-dir", root: binDirectory };
    }
  }
  return null;
}

async function exists(candidate) {
  try {
    await access(candidate, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function resourcePath(root, entry, platform) {
  if (entry.kind !== "binary") return path.join(root, entry.at);
  const [directory, binary] = entry.at;
  return path.join(root, directory, platform === "win32" ? `${binary}.exe` : binary);
}

/**
 * Names `--may-be-absent` can use for this payload: the resource path, and for
 * binaries also the file name and the top-level resource directory they live
 * under. Tolerating `presentation` therefore also covers mop-convert inside it.
 */
export function resourceAbsenceKeys(entry) {
  if (typeof entry.at === "string") return [entry.at];
  const [directory, binary] = entry.at;
  const top = directory.split(/[\\/]/).find(Boolean);
  return [...new Set([binary, directory, top].filter(Boolean))];
}

function isToleratedAbsent(entry, tolerated) {
  return resourceAbsenceKeys(entry).some((key) => tolerated.has(key));
}

/**
 * `mayBeAbsent` names payloads this build is allowed to ship without, by their
 * `at`. A local build stages no Node runtime and the app falls back to the
 * developer's own -- but if one *is* there it still has to work, because the
 * app prefers the runtime next to its executable over anything on PATH. So the
 * question this gate asks is not "required or not" but "absent, or valid".
 */
export async function verifyPackagedRuntime(
  binDirectory,
  { platform = process.platform, mayBeAbsent = [], verifyRuntime = verifyRelocatableRuntime } = {},
) {
  const target = await resolveResourceRoot(binDirectory);
  if (target === null) {
    throw new Error(`no packaged application found in ${binDirectory}`);
  }
  const tolerated = new Set(mayBeAbsent);

  const missing = [];
  const degraded = [];
  const present = [];
  for (const entry of REQUIRED_RESOURCES) {
    const at = resourcePath(target.root, entry, platform);
    if (isToleratedAbsent(entry, tolerated) && !(await exists(at))) {
      degraded.push(`${entry.label}: absent at ${at}\n      ${entry.why}`);
      continue;
    }
    const problem = await inspect(at, entry, platform, verifyRuntime);
    if (problem === null) {
      present.push(entry.label);
      continue;
    }
    (entry.optional ? degraded : missing).push(`${entry.label}: ${problem}\n      ${entry.why}`);
  }

  if (missing.length > 0) {
    throw new Error(
      `packaged application is incomplete (${target.kind}, ${target.root}):\n  ${missing.join("\n  ")}`,
    );
  }
  return { ...target, present, degraded };
}

async function inspect(at, entry, platform, verifyRuntime) {
  if (!(await exists(at))) return `missing at ${at}`;
  if (entry.kind === "binary") {
    const info = await stat(at);
    if (!info.isFile()) return `not a file: ${at}`;
    return null;
  }
  if (entry.kind === "runtime") {
    // Run it where it sits: this copy is at its destination, which is exactly
    // where the app will start it from.
    try {
      await verifyRuntime(at, { platform });
      return null;
    } catch (error) {
      return error.message;
    }
  }
  const info = await stat(at);
  if (!info.isDirectory()) return `not a directory: ${at}`;
  const entries = new Set(await readdir(at));
  if (entries.size === 0) return `empty directory: ${at}`;
  for (const required of entry.contains ?? []) {
    if (!(await exists(path.join(at, required)))) return `missing ${required}/ inside ${at}`;
  }
  return null;
}

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) {
  const args = process.argv.slice(2);
  const mayBeAbsent = args
    .filter((arg) => arg.startsWith("--may-be-absent="))
    .flatMap((arg) => arg.slice("--may-be-absent=".length).split(",").filter(Boolean));
  const binDirectory =
    args.find((arg) => !arg.startsWith("--")) ??
    path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "build", "bin");
  try {
    const { kind, root, present, degraded } = await verifyPackagedRuntime(binDirectory, { mayBeAbsent });
    console.log(`verify-packaged-runtime: ${present.length} runtime payload(s) present (${kind}, ${root})`);
    for (const entry of degraded) {
      console.log(`verify-packaged-runtime: shipping without ${entry.split("\n")[0]}`);
    }
  } catch (error) {
    console.error(`verify-packaged-runtime: ${error.message}`);
    process.exit(1);
  }
}
