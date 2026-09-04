// Resuming a task that is parked on an interactive gate (a plan review or a
// question). This used to be a 70-line callback inside App.tsx whose only
// React dependency was setState; the decisions in it (what the approval
// answer looks like, which errors mean "the gate was already consumed") are
// pure and are exported for their own tests.

import type { DesktopAPI, DesktopTask, TaskHistoryEntry, TaskQuestionAnswer } from "../../shared/types";
import { BRIDGE_ERROR_CODES, errorCode } from "../failureKind";
import { respondToPlanReview } from "../presentation/planReviewResponse";
import { responseForPptxQuestion } from "../presentation/pptxQuestionResponse";
import { pollTaskHistoryUntilTerminal } from "../taskHistoryPoll";
import { applyTaskEvent, finishTaskContinuing, markTaskContinuing, restoreTaskInteractiveGate, type TaskState } from "../taskState";

export interface OutlineSection {
  id: string;
  title: string;
  detail?: string;
  estimatedSlides?: number;
  slide?: number;
}

/** How long and how often the resumed task's history is polled after the gate is answered. */
export const RESUME_POLL = { intervalMs: 1_000, maxAttempts: 30 } as const;

/**
 * The answer body sent with a plan approval: the (possibly edited) outline as
 * the runtime's section schema, or empty when the user approved the plan as
 * proposed.
 */
export function planApprovalAnswer(outline: OutlineSection[] | undefined): string {
  if (!outline || outline.length === 0) return "";
  return JSON.stringify({
    sections: outline.map(({ id, title, detail, estimatedSlides, slide }, index) => ({
      id,
      slide: slide ?? index + 1,
      title,
      purpose: detail,
      estimatedSlides,
    })),
  });
}

/**
 * The browser bridge can briefly retain a stale task snapshot after the
 * runtime already consumed its gate. Answering that gate then fails with the
 * bridge's no_pending_input code, which is not actionable for the user.
 */
export function isGateAlreadyConsumed(message: string): boolean {
  return errorCode(message) === BRIDGE_ERROR_CODES.noPendingInput;
}

/** The id of the most recent task.question event, which older bridges expect as questionId. */
export function latestQuestionEventId(task: DesktopTask): string | undefined {
  const event = [...(task.events ?? [])].reverse().find((candidate) => candidate.type === "task.question");
  return event?.payload && typeof event.payload.id === "string" ? event.payload.id : undefined;
}

export interface ResumeTaskDeps {
  api: Pick<DesktopAPI, "respond" | "getTaskHistory">;
  setState: (update: (current: TaskState) => TaskState) => void;
  /** Injectable for tests; defaults to pollTaskHistoryUntilTerminal. */
  poll?: typeof pollTaskHistoryUntilTerminal;
}

export interface ResumeTaskRequest {
  task: DesktopTask;
  outline?: OutlineSection[];
  questionAnswer?: TaskQuestionAnswer;
}

/**
 * Answers the gate the task is waiting on, then follows the task's history
 * until it reaches a terminal event so the UI leaves the gate even if live
 * events are interrupted. A stale-gate error is swallowed after pulling the
 * durable history once; any other error restores the gate and propagates.
 */
export async function resumeInteractiveTask({ task, outline, questionAnswer }: ResumeTaskRequest, deps: ResumeTaskDeps): Promise<void> {
  const { api, setState } = deps;
  const poll = deps.poll ?? pollTaskHistoryUntilTerminal;
  const waitingStatus = task.status === "plan_review" ? "plan_review" : "question";
  const applyHistory = (entry: TaskHistoryEntry) => {
    setState((current) => entry.events.reduce((next, event) => applyTaskEvent(next, event), current));
  };
  setState((current) => markTaskContinuing(current, task.id));
  try {
    if (task.status === "plan_review") {
      // The plan decision goes through the typed option channel: a freeform
      // "approve" answer is ambiguous to older runtimes and can reopen the
      // plan gate indefinitely.
      await respondToPlanReview(api, task, "approve", planApprovalAnswer(outline));
    } else {
      const eventQuestionId = latestQuestionEventId(task);
      await api.respond(questionAnswer ? {
        taskId: task.id,
        questionId: questionAnswer.questionId || eventQuestionId,
        answer: questionAnswer.answer,
        ...(questionAnswer.optionId ? { optionId: questionAnswer.optionId } : {}),
      } : responseForPptxQuestion(task, eventQuestionId));
    }
    setState((current) => finishTaskContinuing(current, task.id));
    void poll(task.id, () => api.getTaskHistory(50), applyHistory, RESUME_POLL);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (isGateAlreadyConsumed(message)) {
      setState((current) => finishTaskContinuing(current, task.id));
      try {
        const entry = (await api.getTaskHistory(50)).find((candidate) => candidate.taskId === task.id);
        if (entry) applyHistory(entry);
      } catch {
        // The normal reconciliation loop remains the fallback.
      }
      return;
    }
    setState((current) => restoreTaskInteractiveGate(current, task.id, waitingStatus));
    throw error;
  }
}
