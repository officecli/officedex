import { describe, expect, it, vi } from "vitest";
import { buildHtmlAppFiles, htmlAppFilesAsBytes } from "./htmlAppRuntime";

describe("html app runtime bridge", () => {
  it("converts generated source files into byte payloads for Wails", () => {
    const files = buildHtmlAppFiles({ kind: "html-app", slug: "dashboard", title: "Dashboard", refreshMode: "live", source: { fingerprint: "v1", sheetName: "Data", fieldIds: [] }, components: [{ type: "table", id: "table", columns: [] }] }, { fingerprint: "v1", loadedAt: "", sheets: [] });
    const bytes = htmlAppFilesAsBytes(files);
    expect(ArrayBuffer.isView(bytes["index.html"])).toBe(true);
    expect(new TextDecoder().decode(bytes["src/data.json"])).toContain("v1");
    vi.clearAllMocks();
  });
});
