import { describe, expect, it, vi } from "vitest";
import type { DesktopTask } from "../../shared/types";
import { respondToPlanReview } from "./planReviewResponse";

function planTask(): DesktopTask {
  return {
    id: "task-1",
    conversationId: "task-1",
    status: "plan_review",
    events: [],
    question: { id: "question-3", question: "Previous question", options: [], allowFreeform: true },
    plan: { id: "plan-plan-1787996039364794000-1", markdown: "# Outline", revision: 1 },
  };
}

describe("respondToPlanReview", () => {
  it("prefers the active plan request ID over a stale question ID", async () => {
    const respond = vi.fn().mockResolvedValue(undefined);

    await respondToPlanReview({ respond }, planTask(), "approve");

    expect(respond).toHaveBeenCalledOnce();
    expect(respond).toHaveBeenCalledWith(expect.objectContaining({
      taskId: "task-1",
      questionId: "plan-plan-1787996039364794000-1",
      optionId: "approve",
    }));
  });

  it("retries the preceding question ID only for an explicit legacy bridge mismatch", async () => {
    const respond = vi.fn()
      .mockRejectedValueOnce(new Error("question mismatch: want question-3 got plan-plan-1787996039364794000-1"))
      .mockResolvedValueOnce(undefined);

    await respondToPlanReview({ respond }, planTask(), "revise", "Shorten the deck.");

    expect(respond).toHaveBeenNthCalledWith(2, expect.objectContaining({
      questionId: "question-3",
      optionId: "revise",
      answer: "Shorten the deck.",
    }));
  });

  it("does not replay unrelated failures", async () => {
    const respond = vi.fn().mockRejectedValue(new Error("bridge unavailable"));

    await expect(respondToPlanReview({ respond }, planTask(), "approve")).rejects.toThrow("bridge unavailable");
    expect(respond).toHaveBeenCalledOnce();
  });
});
