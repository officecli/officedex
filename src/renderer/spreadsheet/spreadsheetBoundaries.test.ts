import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const spreadsheetDir = path.resolve("src/renderer/spreadsheet");

function productionSpreadsheetSource(): string {
  const files = readdirSync(spreadsheetDir)
    .filter((file) => !file.includes(".test.") && /\.(ts|tsx)$/.test(file))
    .map((file) => readFileSync(path.join(spreadsheetDir, file), "utf8"));
  files.push(readFileSync("src/renderer/styles/spreadsheet.css", "utf8"));
  return files.join("\n");
}

describe("spreadsheet workspace boundaries", () => {
  it("does not depend on legacy component libraries, remote resources, or the old conversation UI", () => {
    const source = productionSpreadsheetSource();
    expect(source).not.toMatch(new RegExp(`from ["']${["ant", "d"].join("")}`));
    expect(source).not.toContain(["@ant", "design/icons"].join("-"));
    expect(source).not.toMatch(/https?:\/\//);
    expect(source).not.toContain(["Dialogue", "Screen"].join(""));
    expect(source).not.toContain(["preview", "components"].join("/"));
  });

  it("contains Sheet SDK stacking so App Builder overlays remain fully visible", () => {
    // The workspace shares the Office workbench frame, so the stacking context
    // that keeps the sheet editor under the overlay lives there now.
    const css = readFileSync("src/renderer/workbench/workbench.css", "utf8");
    expect(css).toMatch(/\.wb-body\s*\{[^}]*isolation:\s*isolate/s);
    expect(css).toMatch(/\.wb-overlay\s*\{[^}]*z-index:\s*40/s);
  });
});
