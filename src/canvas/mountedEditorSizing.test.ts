/**
 * The editors this layer mounts have a size.
 *
 * A deck opened in the shell mounted correctly, reported no error, and drew
 * nothing. The iframe was there; it just had no dimensions, because the rule
 * that gives it any lives in `renderer/preview/PreviewApp.css` — a stylesheet
 * the old entry point imports and the shell never has. An iframe with no size
 * collapses against a canvas of the same colour, so every signal said it
 * worked.
 *
 * Nothing else in the suite could have caught it: the adapter tests mock the
 * leaves away, and jsdom has no layout to assert on. So this is a source check
 * — for each editor root the canvas can mount, some stylesheet the shell
 * actually loads has to say how big it is.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/** Every root a canvas leaf can render, and where its size must come from. */
const MOUNTED_ROOTS = [
  { editor: "presentation", selector: ".pptx-embed-frame", sheet: "src/canvas/canvas.css" },
  { editor: "writer", selector: ".writer-embed-frame", sheet: "src/canvas/canvas.css" },
  { editor: "workbook", selector: ".spreadsheet-canvas", sheet: "src/canvas/canvas.css" },
];

/**
 * Stylesheets that reach the shell. `canvas.css` is imported by
 * createDesktopCanvas; spreadsheet.css travels with SpreadsheetCanvas itself.
 */
const SHELL_STYLESHEETS = [
  "src/canvas/canvas.css",
  "src/shell/app.css",
  "src/renderer/styles/spreadsheet.css",
];

function loaded(): string {
  return SHELL_STYLESHEETS.map((path) => readFileSync(path, "utf8")).join("\n");
}

describe("mounted editors are sized", () => {
  it.each(MOUNTED_ROOTS)("$editor has a height rule the shell loads", ({ selector }) => {
    const css = loaded();
    const rule = new RegExp(`${selector.replace(".", "\\.")}[^{]*\\{[^}]*\\}`, "g");
    const blocks = css.match(rule) ?? [];

    expect(blocks.length, `no rule for ${selector} in any stylesheet the shell loads`).toBeGreaterThan(0);
    expect(
      blocks.some((block) => /height:|inset:/.test(block)),
      `${selector} is styled but never given a height`,
    ).toBe(true);
  });

  // The sizing has to arrive through an import, not by luck: every rule above
  // is in a file something in the mount path pulls in.
  it("the canvas layer imports its own stylesheet", () => {
    expect(readFileSync("src/canvas/createDesktopCanvas.tsx", "utf8")).toContain('import "./canvas.css"');
  });

  it("the workbook component carries its own", () => {
    expect(readFileSync("src/renderer/spreadsheet/SpreadsheetCanvas.tsx", "utf8"))
      .toContain("styles/spreadsheet.css");
  });
});
