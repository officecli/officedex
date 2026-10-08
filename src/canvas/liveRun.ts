import type { DesktopTask } from "../shared/types";

const LIVE_STATUSES = new Set(["starting", "running", "question", "plan_review"]);
const TERMINAL_STATUSES = new Set(["completed", "failed", "cancelled"]);

/**
 * The run of `documentType` the canvas should be showing, if any.
 *
 * Only while the run is still going: a finished document is a file, and the
 * file is what the user edits. `order` is newest-first, and the walk stops at
 * the first run of the type that has ended — a newer deck that already finished
 * outranks an older run still waiting on someone. Without that stop, a run left
 * blocked on a question in one conversation kept the canvas on its stage while
 * the deck the user had just generated sat in its tab with no editor
 * (shell-pptx-generation-real, 2026-09-28).
 */
export function liveRunOfType(
  tasks: Record<string, DesktopTask>,
  order: readonly string[],
  documentType: DesktopTask["documentType"],
): DesktopTask | null {
  for (const id of order) {
    const task = tasks[id];
    if (!task || task.documentType !== documentType) continue;
    if (LIVE_STATUSES.has(task.status)) return task;
    if (TERMINAL_STATUSES.has(task.status)) return null;
  }
  return null;
}
