import type { TaskState } from "./taskState";

/** A running task with no progress for this long is shown as stalled. */
export const STALL_THRESHOLD_MS = 300_000;
/** How often the renderer re-evaluates stalled tasks. */
export const STALL_POLL_INTERVAL_MS = 30_000;

/**
 * Returns the moment a task last showed progress, or undefined when nothing is
 * known. Progress events stamp `lastProgressAt`; before the first one arrives
 * the task's own start event is the only signal.
 */
export function lastActivityAt(task: TaskState["tasks"][string]): number | undefined {
  if (task.lastProgressAt !== undefined) return task.lastProgressAt;
  const firstTs = task.events[0]?.ts;
  if (!firstTs) return undefined;
  const parsed = Date.parse(firstTs);
  return Number.isNaN(parsed) ? undefined : parsed;
}

/**
 * Marks running tasks whose last activity is older than the threshold as
 * stalled. Tasks already marked keep their original `stalledSince`; nothing
 * else changes. Returns the same state object when no task changed, so React
 * can skip the re-render.
 */
export function markStalledTasks(state: TaskState, now: number, thresholdMs: number = STALL_THRESHOLD_MS): TaskState {
  let changed = false;
  const tasks = { ...state.tasks };
  for (const id of state.taskOrder) {
    const task = tasks[id];
    if (!task || task.status !== "running" || task.stalledSince) continue;
    const lastActivity = lastActivityAt(task);
    if (lastActivity === undefined) continue;
    if (now - lastActivity > thresholdMs) {
      tasks[id] = { ...task, stalledSince: now };
      changed = true;
    }
  }
  return changed ? { ...state, tasks } : state;
}
