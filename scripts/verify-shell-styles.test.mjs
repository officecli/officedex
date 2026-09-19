// `node --test` cover for scripts/verify-shell-styles.mjs.
//
// Two halves, on purpose.
//
// The fast half exercises the pure functions against fixtures. It is where the
// scanner's own rules are pinned -- the template-literal handling in
// particular, which is the part that produced phantom findings the first time
// it ran, and which nothing in a real build would demonstrate clearly.
//
// The slow half runs a real `vite build` and checks the real artifact. That is
// ~7 seconds and it is the entire point: S0-001 was invisible in source and
// visible only in `dist/index.html`'s stylesheet links, so a version of this
// file that only tested the helpers would be testing everything except the
// thing that broke.
//
//   node --test scripts/verify-shell-styles.test.mjs
//
// There is no conditional skip here. A build that cannot run is a broken
// environment, and `e2e/ui-audit-s4.spec.ts` is the standing example of what
// "30 skipped, exit 0" does to a CI summary.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  UNSTYLED_BY_DESIGN,
  definedClasses,
  linkedStylesheets,
  literalClasses,
  moduleClosure,
  verifyShellStyles,
} from "./verify-shell-styles.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("literalClasses reads plain class attributes", () => {
  const found = literalClasses('<div className="shell-home shell-region" />');
  assert.deepEqual([...found].sort(), ["shell-home", "shell-region"]);
});

test("literalClasses takes only whole words out of a template literal", () => {
  // `shell-home--` and `-open` are prefixes and suffixes of names that only
  // exist at run time. Counting them is how this reported four classes as
  // missing that were never classes.
  const found = literalClasses(
    "<div className={`shell-home shell-home--${mode} is-${state}-open shell-tail`} />",
  );
  assert.deepEqual([...found].sort(), ["shell-home", "shell-tail"]);
});

test("definedClasses reads every class a stylesheet declares", () => {
  const found = definedClasses(".a .b-c > .d{color:red}.e:hover{}");
  assert.deepEqual([...found].sort(), ["a", "b-c", "d", "e"]);
});

test("linkedStylesheets reads the documents links, in order", () => {
  const html = `<link rel="modulepreload" href="./assets/x.js">
    <link rel="stylesheet" crossorigin href="./assets/one.css">
    <link rel="stylesheet" href="./assets/two.css">`;
  assert.deepEqual(linkedStylesheets(html), ["./assets/one.css", "./assets/two.css"]);
});

test("moduleClosure follows dynamic imports as well as static ones", () => {
  const modules = moduleClosure(path.join(root, "src/shell/main.tsx"));
  const relative = modules.map((file) => path.relative(root, file));
  assert.ok(relative.includes("src/shell/App.tsx"), "static import missing");
  // Reached only through `import()` from the canvas registry.
  assert.ok(
    relative.some((file) => file.startsWith("src/canvas/")),
    "no lazily imported canvas module in the closure",
  );
});

test("the shell build ships the styles of every component the shell can reach", () => {
  execFileSync("npx", ["vite", "build"], { cwd: root, stdio: "inherit" });
  const report = verifyShellStyles({ root });

  assert.ok(report.stylesheets.length > 0, "dist/index.html links no stylesheet");
  assert.ok(report.modules > 50, `only ${report.modules} modules reachable -- the walker is broken`);
  assert.ok(report.defined > 500, `only ${report.defined} classes defined -- the CSS was not read`);

  assert.deepEqual(
    report.missing,
    [],
    `classes with no rule in the shell bundle:\n${report.missing
      .map((entry) => `  ${entry.file}  .${entry.class}`)
      .join("\n")}`,
  );
  assert.deepEqual(
    report.nowStyled,
    [],
    `now styled, so remove from UNSTYLED_BY_DESIGN: ${report.nowStyled.join(", ")}`,
  );

  // The exemption list is small enough to read; if it starts growing, the rule
  // being bent is "a component owns its stylesheet", and the answer is not a
  // longer list.
  assert.ok(
    Object.keys(UNSTYLED_BY_DESIGN).length <= 10,
    "UNSTYLED_BY_DESIGN has grown past the point where anyone reads it",
  );
});
