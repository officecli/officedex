import type { DesktopAPI, DesktopTask } from "../../shared/types";

type PlanReviewOption = "approve" | "revise";

function isLegacyQuestionIDFallbackError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /question mismatch:\s*want\s+question-[^\s]+\s+got\s+plan-/i.test(message);
}

/**
 * Respond to the active plan gate using the plan request ID. Older bridges
 * briefly exposed the preceding question ID as the gate ID, so retry that ID
 * only when the bridge explicitly reports the corresponding ID mismatch. The
 * rejected first request has no side effect, making this compatibility retry
 * safe while keeping unrelated failures visible.
 */
export async function respondToPlanReview(
  api: Pick<DesktopAPI, "respond">,
  task: DesktopTask,
  optionId: PlanReviewOption,
  answer?: string,
): Promise<unknown> {
  if (!task.plan) throw new Error("plan is unavailable");
  const request = {
    taskId: task.id,
    questionId: task.plan.id,
    optionId,
    answer,
  };
  try {
    return await api.respond(request);
  } catch (error) {
    const legacyQuestionID = task.question?.id;
    if (!legacyQuestionID || legacyQuestionID === task.plan.id || !isLegacyQuestionIDFallbackError(error)) {
      throw error;
    }
    return api.respond({ ...request, questionId: legacyQuestionID });
  }
}
