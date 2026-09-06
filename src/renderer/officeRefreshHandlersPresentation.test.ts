import { describe, expect, it, vi } from "vitest";
import { createPresentationRefreshAdapter } from "./officeRefreshHandlers";

describe("presentation refresh adapter", () => {
  it("preserves the real editor inspect/plan/apply contract", async () => {
    const inspect = vi.fn(async () => ({ slides: [{ id: "1" }] }));
    const plan = vi.fn(async () => ({ summary: "refresh", source: "return {};", confidence: "high" as const }));
    const apply = vi.fn(async () => undefined);
    const adapter = createPresentationRefreshAdapter({ inspect, plan, apply });
    await adapter.apply({ id: "ppt", projectId: "p", type: "presentation", title: "PPT", version: 1, status: "succeeded", updatedAt: "" }, { summary: "refresh", source: "return {};", confidence: "high" });
    expect(apply).toHaveBeenCalledOnce();
  });
});
