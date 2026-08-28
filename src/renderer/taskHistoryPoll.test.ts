import { describe, expect, it, vi } from "vitest";
import type { TaskHistoryEntry } from "../shared/types";
import { pollTaskHistoryUntilTerminal } from "./taskHistoryPoll";

describe("pollTaskHistoryUntilTerminal", () => {
  it("replays persisted history until a missed terminal event appears", async () => {
    const running: TaskHistoryEntry = {
      taskId: "task-marketing-image",
      conversationId: "task-marketing-image",
      events: [{ task_id: "task-marketing-image", type: "task.started", payload: { document_type: "img" } }],
    };
    const completed: TaskHistoryEntry = {
      ...running,
      events: [
        ...running.events,
        {
          task_id: "task-marketing-image",
          type: "task.completed",
          payload: { file_path: "/tmp/marketing.png", document_type: "img", document_name: "marketing.png" },
        },
      ],
    };
    const readHistory = vi.fn()
      .mockResolvedValueOnce([running])
      .mockResolvedValueOnce([completed]);
    const entries: TaskHistoryEntry[] = [];

    await expect(pollTaskHistoryUntilTerminal(
      "task-marketing-image",
      readHistory,
      (entry) => entries.push(entry),
      { intervalMs: 0, maxAttempts: 3 },
    )).resolves.toBe(true);

    expect(readHistory).toHaveBeenCalledTimes(2);
    expect(entries.at(-1)?.events.at(-1)?.type).toBe("task.completed");
  });

  it("retries transient history read errors", async () => {
    const completed: TaskHistoryEntry = {
      taskId: "task-recovered",
      conversationId: "task-recovered",
      events: [{ task_id: "task-recovered", type: "task.completed", payload: {} }],
    };
    const readHistory = vi.fn()
      .mockRejectedValueOnce(new Error("temporary bridge error"))
      .mockResolvedValueOnce([completed]);

    await expect(pollTaskHistoryUntilTerminal(
      "task-recovered",
      readHistory,
      () => undefined,
      { intervalMs: 0, maxAttempts: 3 },
    )).resolves.toBe(true);
  });
});
