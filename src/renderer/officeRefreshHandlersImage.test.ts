import { describe, expect, it, vi } from "vitest";
import { createImageRefreshAdapter } from "./officeRefreshHandlers";

describe("image refresh adapter", () => {
  it("generates a replacement asset and increments its version", async () => {
    const onUpdated = vi.fn(async () => undefined);
    const adapter = createImageRefreshAdapter({ generate: async () => ({ filePath: "/images/next.png" }), onUpdated });
    await adapter.refresh({ id: "img", projectId: "p", type: "image", title: "Cover", version: 2, status: "succeeded", filePath: "/images/old.png", updatedAt: "" }, { outputId: "img", changedViews: ["v"], strategy: "full", preserveManualEdits: false, requiresApproval: false });
    expect(onUpdated).toHaveBeenCalledWith(expect.objectContaining({ version: 3, filePath: "/images/next.png" }), { filePath: "/images/next.png" });
  });
});
