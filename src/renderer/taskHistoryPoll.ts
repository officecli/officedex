import type { TaskHistoryEntry } from "../shared/types";
import { delay } from "./utils/timing";

const TERMINAL_TASK_EVENT_TYPES = new Set(["task.completed", "task.failed", "task.cancelled"]);

export async function pollTaskHistoryUntilTerminal(
  taskId: string,
  readHistory: () => Promise<TaskHistoryEntry[]>,
  onEntry: (entry: TaskHistoryEntry) => void,
  options: { intervalMs?: number; maxAttempts?: number } = {},
): Promise<boolean> {
  const intervalMs = options.intervalMs ?? 1_000;
  const maxAttempts = options.maxAttempts ?? 15 * 60;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const entry = (await readHistory()).find((candidate) => candidate.taskId === taskId);
      if (entry) {
        onEntry(entry);
        if (entry.events.some((event) => TERMINAL_TASK_EVENT_TYPES.has(event.type))) return true;
      }
    } catch {
      // Live bridge events remain authoritative. History polling is only a
      // recovery path for browser/SSE interruptions, so transient reads retry.
    }
    await delay(intervalMs);
  }
  return false;
}
