import { describe, expect, it } from "vitest";
import { buildHtmlAppSpec } from "./htmlAppModel";

describe("html app model", () => {
  it("creates deterministic live components from a workbook view", () => {
    const spec = buildHtmlAppSpec({
      fingerprint: "book-v1",
      loadedAt: "2026-09-06T00:00:00.000Z",
      sheets: [{
        name: "Metrics",
        fields: [
          { id: "revenue", label: "Revenue", columnIndex: 0, kind: "number" },
          { id: "region", label: "Region", columnIndex: 1, kind: "text" },
        ],
        rows: [],
      }],
    }, "Metrics", "Sales Dashboard");
    expect(spec).toMatchObject({ kind: "html-app", refreshMode: "live", source: { fingerprint: "book-v1", sheetName: "Metrics" } });
    expect(spec?.components).toEqual([
      { type: "kpi", id: "kpi-revenue", fieldId: "revenue" },
      { type: "table", id: "data-table", columns: ["revenue", "region"] },
    ]);
  });
});
