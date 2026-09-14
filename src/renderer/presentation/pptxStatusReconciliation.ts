import type { PptxTaskStatus } from "../../shared/types";
import { applyTaskEvent, type TaskState } from "../taskState";

/** Ignore late responses for deleted, canceled or otherwise finished tasks. */
export function reconcilePptxTaskStatus(state: TaskState, taskId: string, status: PptxTaskStatus, now = Date.now()): TaskState {
  const task = state.tasks[taskId];
  if (!task || status.task_id !== taskId || !["running", "starting"].includes(task.status)) return state;
  if (["completed", "failed", "cancelled"].includes(status.status)) {
    return applyTaskEvent(state, {
      task_id: taskId,
      event_id: `status:${taskId}:${status.status}:${status.updated_at ?? "terminal"}`,
      type: `task.${status.status}`,
      ts: status.updated_at || new Date(now).toISOString(),
      payload: { message: status.last_error || undefined, error: status.last_error || undefined, reconciled: true },
    });
  }
  if (!["running", "starting", "question", "plan_review"].includes(status.status)) return state;
  return { ...state, tasks: { ...state.tasks, [taskId]: { ...task, lastStatusCheckAt: now } } };
}
