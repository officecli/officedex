import { describe, expect, it } from "vitest";
import { approveRefresh, createRefreshQueue, finishRefresh, isRefreshQueueComplete, startRefresh } from "./refreshQueue";

describe("refresh queue", () => {
  it("requires approval for manually edited outputs and supports retry", () => {
    const plans = [
      { outputId: "ppt", changedViews: ["v"], strategy: "charts" as const, preserveManualEdits: false, requiresApproval: false },
      { outputId: "doc", changedViews: ["v"], strategy: "content" as const, preserveManualEdits: true, requiresApproval: true },
    ];
    let queue = createRefreshQueue(plans);
    expect(queue.map((item) => item.status)).toEqual(["queued", "awaiting_confirmation"]);
    queue = startRefresh(queue, "ppt");
    queue = finishRefresh(queue, "ppt", "temporary failure");
    expect(queue[0]).toMatchObject({ status: "failed", attempts: 1 });
    queue = startRefresh(queue, "ppt");
    queue = finishRefresh(queue, "ppt");
    queue = approveRefresh(queue, "doc");
    queue = startRefresh(queue, "doc");
    queue = finishRefresh(queue, "doc");
    expect(isRefreshQueueComplete(queue)).toBe(true);
  });
});
