import { describe, expect, it, vi } from "vitest";
import { refreshHtmlApp } from "./htmlAppRefresh";

describe("html app refresh", () => {
  it("rewrites the app files and increments the output version", async () => {
    const write = vi.fn(async () => ["/workspace/app.html-app/index.html"]);
    const output = { id: "html", projectId: "p", type: "html-app" as const, title: "Dashboard", filePath: "/workspace/app.html-app/index.html", version: 2, status: "succeeded" as const, lineage: { workbookId: "book", viewIds: ["v1"], sourceIds: [], workbookFingerprint: "v1", capturedAt: "" }, updatedAt: "" };
    const next = await refreshHtmlApp(output, { outputId: "html", changedViews: ["v2"], strategy: "charts", preserveManualEdits: false, requiresApproval: false }, { fingerprint: "v2", loadedAt: "", sheets: [{ name: "Data", fields: [], rows: [] }] }, { write });
    expect(write).toHaveBeenCalledOnce(); expect(next.version).toBe(3); expect(next.lineage?.workbookFingerprint).toBe("v2");
  });
});
