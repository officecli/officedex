import { describe, expect, it, vi } from "vitest";
import { createRefreshQueue, executeAndPersistRefreshQueue } from "./refreshExecutor";

describe("persistent refresh executor", () => {
  it("persists running and terminal state", async () => {
    const saves: string[] = [];
    const output = { id: "html", projectId: "p", type: "html-app" as const, title: "HTML", version: 1, status: "succeeded" as const, updatedAt: "" };
    const plan = { outputId: "html", changedViews: ["v"], strategy: "charts" as const, preserveManualEdits: false, requiresApproval: false };
    const queue = await executeAndPersistRefreshQueue(createRefreshQueue([plan]), [output], { "html-app": vi.fn(async () => undefined) }, { save: async (item) => { saves.push(item.status); } });
    expect(queue[0].status).toBe("succeeded"); expect(saves).toEqual(["running", "succeeded"]);
  });
});
