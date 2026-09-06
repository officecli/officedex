import { describe, expect, it, vi } from "vitest";
import { createOfficeRefreshHandlers } from "./officeRefreshHandlers";

describe("office refresh handlers", () => {
  it("plans and applies a safe presentation refresh", async () => {
    const inspect = vi.fn(async () => ({ slides: [] }));
    const plan = vi.fn(async () => ({ summary: "ok", source: "script", confidence: "high" as const }));
    const apply = vi.fn(async () => undefined);
    const handlers = createOfficeRefreshHandlers({ presentation: { inspect, plan, apply } });
    await handlers.presentation!({ id: "ppt", projectId: "p", type: "presentation", title: "PPT", version: 1, status: "succeeded", updatedAt: "" }, { outputId: "ppt", changedViews: ["sales"], strategy: "charts", preserveManualEdits: false, requiresApproval: false });
    expect(inspect).toHaveBeenCalledOnce(); expect(plan).toHaveBeenCalledOnce(); expect(apply).toHaveBeenCalledOnce();
  });
});
