#!/usr/bin/env node
// Asserts that the styles of every component the shell can reach are actually
// in the shell build's CSS.
//
// This exists because S0-001 is a class of defect that source code cannot show
// you. `ForceUpdateOverlay` had its stylesheet in the repository, imported,
// committed, and passing every test in the suite -- and in the packaged shell
// the mandatory-update page rendered as black Times on white with no layout,
// because the import lived on the *legacy entry* and the shell entry emitted a
// CSS bundle with no `force-update-*` rule in it. Every grep said the styles
// were there. The build said otherwise, and the build is what users run.
//
// So this gate is not allowed to read `src/` for the answer. It reads
// `dist/index.html`, takes the stylesheets that document actually links, and
// asks whether the classes the shell's own module graph writes into the DOM
// have rules in them. The one place a missing stylesheet is visible is the
// artifact, so the artifact is what gets asked.
//
// It is deliberately NOT a vitest file. It needs `vite build` (~7s), and a
// gate that adds seven seconds to every `npx vitest run` is a gate people
// start skipping. Run it on its own, or in CI next to the other
// `scripts/verify-*` checks:
//
//   node scripts/verify-shell-styles.mjs            # builds, then checks
//   node scripts/verify-shell-styles.mjs --no-build # checks an existing dist/
//
// KNOWN BLIND SPOTS
//
// 1. It sees literal class names. `className={styles[kind]}` or any name
//    assembled at run time is invisible to it, and a template literal
//    contributes only the parts that are whole words -- `shell-home--${mode}`
//    contributes nothing, by design, because `shell-home--` is not a class.
// 2. "Has a rule somewhere in the linked CSS" is not "is styled correctly".
//    A class defined only inside a media query that never matches passes.
// 3. It checks the *shell* entry. `legacy.html` gets the same treatment from
//    nobody; if the old renderer grows this bug, this will not say so.
// 4. It assumes every CSS chunk the shell needs is reachable from a `<link>` in
//    `dist/index.html`. That is true of this build (Vite hoists the shared CSS
//    into the entry's links), and it is what makes the gate discriminating --
//    `legacy-*.css` is linked from `legacy.html` only, which is exactly the
//    distinction S0-001 turned on. If Vite ever emits a lazily-injected CSS
//    chunk for a route the shell reaches, this will report false missing
//    classes; the fix then is to walk the chunk graph, not to widen
//    UNSTYLED_BY_DESIGN.
// 5. The real fix, as always, is upstream of the scanner: a component that owns
//    its stylesheet with its own `import` cannot drift from it. This gate is
//    what catches the ones that do not.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

/**
 * Class names the shell writes that no stylesheet defines, and that is correct.
 *
 * Every entry is a structural or test hook, not a visual: removing it changes
 * nothing on screen. They are listed rather than filtered by a pattern, because
 * "this class has no rule" is exactly the S0-001 symptom and each instance
 * should have had to be looked at once by a person.
 *
 * `.shell-region` is the one worth knowing about: six components carry it as a
 * landmark marker and nothing styles it. If a rule for any of these appears,
 * delete the entry -- the list is checked in both directions.
 */
export const UNSTYLED_BY_DESIGN = Object.freeze({
  "shell-region": "landmark marker on the six top-level regions; no rule, by design",
  "shell-sidebar-tree": "wrapper that exists only to carry the folder drop handlers",
  "shell-task-list": "block name; only its `-head`/`-hint` elements are styled",
  "shell-cx-model": "variant marker on a `.shell-cx-button`; only `-name` is styled",
  "shell-home--editor":
    "Editor Home has no styling of its own -- `.shell-home--agent` does, this does not. " +
    "The same asymmetry S5 table 8 found at the root (`data-mode` has one rule and it is " +
    "the agent's). Not this gate's to fix; delete this line when Editor Home gets a rule.",
  "spreadsheet-header-markers": "legacy sheet canvas: positioned by inline style",
  "spreadsheet-header-marker": "legacy sheet canvas: positioned by inline style",
  "spreadsheet-catalog-range": "legacy sheet canvas: positioned by inline style",
});

const SOURCE_EXTENSIONS = [".tsx", ".ts", ".jsx", ".js"];

function resolveImport(fromFile, specifier) {
  if (!specifier.startsWith(".")) return null;
  const base = path.resolve(path.dirname(fromFile), specifier);
  if (/\.(css|svg|png|jpg|json|woff2?)$/.test(specifier)) return existsSync(base) ? base : null;
  for (const extension of SOURCE_EXTENSIONS) {
    if (existsSync(base + extension)) return base + extension;
  }
  for (const extension of SOURCE_EXTENSIONS) {
    const indexFile = path.join(base, `index${extension}`);
    if (existsSync(indexFile)) return indexFile;
  }
  return null;
}

const IMPORT_PATTERN =
  /(?:^|\n)\s*import\s+(?:[^'"]*?from\s*)?["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g;

/**
 * Every source module the entry can reach, static imports and dynamic alike.
 *
 * Dynamic `import()` is followed on purpose: the canvases and viewers arrive
 * that way, they render inside `#shell`, and "it is lazy" has never been a
 * reason for a component to be unstyled when it finally shows up.
 */
export function moduleClosure(entry) {
  const modules = [];
  const seen = new Set();
  const visit = (file) => {
    if (seen.has(file)) return;
    seen.add(file);
    if (!/\.[jt]sx?$/.test(file)) return;
    modules.push(file);
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(IMPORT_PATTERN)) {
      const resolved = resolveImport(file, match[1] ?? match[2]);
      if (resolved) visit(resolved);
    }
  };
  visit(path.resolve(entry));
  return modules;
}

/**
 * The literal class names a module puts in the DOM.
 *
 * Template literals contribute only their whole words. A segment that is glued
 * to an interpolation on one side -- the `shell-home--` of
 * `` `shell-home--${mode}` `` -- is a prefix, not a class, and counting it as
 * one produced four phantom "missing" classes on the first run of this.
 */
export function literalClasses(source) {
  const classes = new Set();
  const take = (value) => {
    for (const name of value.split(/\s+/)) if (name) classes.add(name);
  };

  for (const match of source.matchAll(/className=["']([^"'{}]+)["']/g)) take(match[1]);

  for (const match of source.matchAll(/className=\{`([^`]*)`\}/g)) {
    const template = match[1];
    const segments = template.split(/\$\{[^}]*\}/);
    segments.forEach((segment, index) => {
      const words = segment.split(/\s+/).filter(Boolean);
      if (words.length === 0) return;
      // A segment glued to an interpolation on its left starts mid-class.
      if (index > 0 && !/^\s/.test(segment)) words.shift();
      // ...and one glued on its right ends mid-class.
      if (index < segments.length - 1 && !/\s$/.test(segment)) words.pop();
      take(words.join(" "));
    });
  }
  return classes;
}

/** Every class name any rule in `css` declares. */
export function definedClasses(css) {
  return new Set([...css.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map((match) => match[1]));
}

/** The stylesheets an HTML document actually links, in order. */
export function linkedStylesheets(html) {
  return [...html.matchAll(/<link\b[^>]*\brel=["']stylesheet["'][^>]*>/g)]
    .map((tag) => /\bhref=["']([^"']+)["']/.exec(tag[0])?.[1])
    .filter(Boolean);
}

function shellSources(directory) {
  const out = [];
  for (const entry of readdirSync(directory)) {
    const at = path.join(directory, entry);
    if (statSync(at).isDirectory()) {
      out.push(...shellSources(at));
      continue;
    }
    if (/\.[jt]sx?$/.test(entry) && !entry.includes(".test.")) out.push(at);
  }
  return out;
}

/**
 * The check itself.
 *
 * Returns the evidence as well as the verdict: "the update page is unstyled" is
 * an opinion, "13 classes beginning force-update- have no rule in
 * assets/main-*.css or assets/useAppUpdate-*.css" is something the next person
 * can check.
 */
export function verifyShellStyles({ root = process.cwd(), dist = "dist", entry = "src/shell/main.tsx" } = {}) {
  const distDir = path.resolve(root, dist);
  const indexHtml = path.join(distDir, "index.html");
  if (!existsSync(indexHtml)) {
    throw new Error(`${indexHtml} does not exist -- run the build first, or drop --no-build`);
  }

  const hrefs = linkedStylesheets(readFileSync(indexHtml, "utf8"));
  if (hrefs.length === 0) {
    throw new Error("dist/index.html links no stylesheet at all -- the shell build ships unstyled");
  }
  const css = hrefs
    .map((href) => readFileSync(path.join(distDir, href.replace(/^\.?\//, "")), "utf8"))
    .join("\n");
  const defined = definedClasses(css);

  const modules = moduleClosure(path.resolve(root, entry)).filter((file) => !file.includes(".test."));
  const missing = [];
  for (const file of modules) {
    for (const name of literalClasses(readFileSync(file, "utf8"))) {
      if (defined.has(name)) continue;
      if (name in UNSTYLED_BY_DESIGN) continue;
      missing.push({ file: path.relative(root, file), class: name });
    }
  }

  // The exemptions are assertions too: one that has acquired a rule has to be
  // deleted, or the list turns into a place where rules go to be forgotten.
  const nowStyled = Object.keys(UNSTYLED_BY_DESIGN).filter((name) => defined.has(name));

  return { stylesheets: hrefs, modules: modules.length, defined: defined.size, missing, nowStyled };
}

function build(root) {
  execFileSync("npx", ["vite", "build"], { cwd: root, stdio: "inherit" });
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (invokedDirectly) {
  const root = process.cwd();
  if (!process.argv.includes("--no-build")) build(root);
  const report = verifyShellStyles({ root });
  console.log(`shell stylesheets: ${report.stylesheets.join(", ")}`);
  console.log(`modules reachable from the shell entry: ${report.modules}`);
  console.log(`classes defined in the shell bundle: ${report.defined}`);
  if (report.nowStyled.length > 0) {
    console.error(`These are styled now -- remove them from UNSTYLED_BY_DESIGN: ${report.nowStyled.join(", ")}`);
  }
  if (report.missing.length > 0) {
    console.error(`\n${report.missing.length} class(es) the shell writes have no rule in the shell bundle:`);
    for (const entry of report.missing) console.error(`  ${entry.file}  .${entry.class}`);
    console.error("\nThe stylesheet is probably imported by an entry rather than by the component.");
  }
  if (report.missing.length > 0 || report.nowStyled.length > 0) process.exit(1);
  console.log("OK: every class the shell writes has a rule in the CSS the shell ships.");
}
