import { describe, expect, it, vi } from "vitest";
import { executeRefreshQueue, createRefreshQueue } from "./refreshExecutor";

describe("refresh executor", () => {
  it("dispatches by output type and records failure for missing handlers", async () => {
    const outputs = [{ id: "ppt", projectId: "p", type: "presentation" as const, title: "PPT", version: 1, status: "succeeded" as const, updatedAt: "" }, { id: "html", projectId: "p", type: "html-app" as const, title: "HTML", version: 1, status: "succeeded" as const, updatedAt: "" }];
    const plans = outputs.map((output) => ({ outputId: output.id, changedViews: ["v"], strategy: "charts" as const, preserveManualEdits: false, requiresApproval: false }));
    const presentation = vi.fn(async () => undefined);
    const queue = await executeRefreshQueue(createRefreshQueue(plans), outputs, { presentation });
    expect(presentation).toHaveBeenCalledOnce();
    expect(queue.map((item) => item.status)).toEqual(["succeeded", "failed"]);
    expect(queue[1].error).toContain("No refresh handler");
  });
});
