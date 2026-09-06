import { describe, expect, it } from "vitest";
import { preparePublishedWorkbookRefresh } from "./appStore";
import type { PublishedWorkbookApp } from "./types";

describe("published workbook app refresh", () => {
  it("updates the HTML data contract without changing app identity or permissions", () => {
    const app: PublishedWorkbookApp = {
      id: "app-1",
      sourceFileName: "sales.xlsx",
      publishedAt: "2026-09-06T00:00:00.000Z",
      config: { name: "Sales", slug: "sales", prompt: "dashboard", sheetName: "Data", fieldIds: ["revenue"], access: "private", allowCreate: true, allowUpdate: false, outputKind: "html-app", refreshMode: "live" },
      outputKind: "html-app",
    };
    const refreshed = preparePublishedWorkbookRefresh(app, { fingerprint: "v2", loadedAt: "2026-09-06T01:00:00.000Z", sheets: [{ name: "Data", fields: [{ id: "revenue", label: "Revenue", columnIndex: 0, kind: "number" }], rows: [] }] });
    expect(refreshed.id).toBe("app-1");
    expect(refreshed.config.allowUpdate).toBe(false);
    expect(refreshed.htmlSpec?.source.fingerprint).toBe("v2");
  });
});
