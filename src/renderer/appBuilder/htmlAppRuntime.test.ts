import { describe, expect, it } from "vitest";
import { buildHtmlAppFiles } from "./htmlAppRuntime";
import { buildHtmlAppSpec } from "./htmlAppModel";

describe("html app runtime", () => {
  it("emits a runnable Vite-shaped project with workbook data", () => {
    const snapshot = { fingerprint: "v1", loadedAt: "", sheets: [{ name: "Data", fields: [{ id: "value", label: "Value", columnIndex: 0, kind: "number" as const }], rows: [{ id: "r1", values: { value: 42 } }] }] };
    const spec = buildHtmlAppSpec(snapshot, "Data", "Dashboard")!;
    const files = buildHtmlAppFiles(spec, snapshot);
    expect(files["index.html"]).toContain("/src/main.ts");
    expect(JSON.parse(files["package.json"])).toMatchObject({ scripts: { build: "vite build" } });
    expect(files["vite.config.ts"]).toContain("defineConfig");
    expect(files["src/main.ts"]).toContain("fingerprint");
    expect(files["src/data.json"]).toContain('"fingerprint":"v1"');
  });
});
