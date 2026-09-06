import { describe, expect, it, vi } from "vitest";
import { createHtmlRefreshAdapter } from "./officeRefreshHandlers";

describe("HTML refresh adapter", () => {
  it("connects snapshot, file writer, and updated output persistence", async () => {
    const onUpdated = vi.fn(async () => undefined);
    const adapter = createHtmlRefreshAdapter({ snapshot: async () => ({ fingerprint: "v2", loadedAt: "", sheets: [{ name: "Data", fields: [], rows: [] }] }), writer: { write: async () => ["/app/index.html"] }, onUpdated });
    await adapter.refresh({ id: "html", projectId: "p", type: "html-app", title: "App", filePath: "/app/index.html", version: 1, status: "succeeded", updatedAt: "" }, { outputId: "html", changedViews: ["v"], strategy: "charts", preserveManualEdits: false, requiresApproval: false });
    expect(onUpdated).toHaveBeenCalledWith(expect.objectContaining({ version: 2, status: "succeeded" }));
  });
});
