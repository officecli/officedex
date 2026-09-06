import { describe, expect, it, vi } from "vitest";
import { createWriterDocumentRefreshAdapter } from "./officeRefreshHandlers";

describe("Writer document refresh adapter", () => {
  it("replaces mapped fields and saves the document", async () => {
    const replaceText = vi.fn(async () => ({ replaced: 1 })); const save = vi.fn(async () => undefined);
    const adapter = createWriterDocumentRefreshAdapter({ writer: { capabilities: () => ({ replaceText: true }), replaceText, save } as never, replacements: () => [{ query: "old", replacement: "new" }] });
    await adapter.refresh({ id: "doc", projectId: "p", type: "document", title: "Report", version: 1, status: "succeeded", updatedAt: "" }, { outputId: "doc", changedViews: ["v"], strategy: "content", preserveManualEdits: false, requiresApproval: false });
    expect(replaceText).toHaveBeenCalledWith("old", "new", "document"); expect(save).toHaveBeenCalledOnce();
  });
});
