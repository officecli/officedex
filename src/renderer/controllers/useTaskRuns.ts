import { useCallback, useEffect } from "react";
import type { TaskHistoryEntry } from "../../shared/types";
import { useDesktopApi } from "../services/desktopApi";
import { useTaskStore } from "../store/taskStore";
import { applyTaskEvent, attachTaskContext, type TaskState } from "../taskState";
import { STALL_POLL_INTERVAL_MS, markStalledTasks } from "../stallDetector";
import { TASK_HISTORY_RECONCILE_INTERVAL_MS } from "../constants/timing";
import { usePolling } from "../utils/usePolling";

/** How many history entries a hydrate or reconcile pass asks for. */
const HISTORY_PAGE = 50;

/**
 * Replays persisted history into task state. Entries already present are
 * skipped: live events are the fast path and must not be re-reduced.
 */
export function hydrateTaskHistory(state: TaskState, entries: TaskHistoryEntry[]): TaskState {
  let next = state;
  for (const entry of entries) {
    if (next.tasks[entry.taskId]) continue;
    for (const event of entry.events) next = applyTaskEvent(next, event);
    next = attachTaskContext(next, entry.taskId, {
      createdAt: entry.createdAt,
      conversationId: entry.conversationId,
      parentTaskId: entry.parentTaskId,
      workspaceId: entry.workspaceId,
      workspacePath: entry.workspacePath,
    });
  }
  return next;
}

/**
 * Keeps task state honest about runs the live event stream did not fully
 * describe. Three jobs, all of them about the same gap:
 *
 * - hydrate once on mount, so a reload does not start from an empty list;
 * - reconcile against history while any run is active, because the transport
 *   can drop frames and history is authoritative after a bridge response;
 * - mark runs stalled when nothing has been heard from them for too long.
 *
 * Reconciliation deliberately does not filter by the pre-refresh status: a task
 * can have reached failed or completed while the renderer still believes it is
 * parked in plan_review.
 *
 * Rules R-A-09, R-A-10, R-A-11 in docs/interaction-rules.md.
 */
export function useTaskRuns(): void {
  const api = useDesktopApi();
  const { state, update } = useTaskStore();

  useEffect(() => {
    let cancelled = false;
    api
      .getTaskHistory(HISTORY_PAGE)
      .then((entries) => {
        if (cancelled || entries.length === 0) return;
        update((current) => hydrateTaskHistory(current, entries));
      })
      .catch(() => {
        // History hydration is best-effort; live events still flow.
      });
    return () => {
      cancelled = true;
    };
    // Mount only: later history reads go through reconciliation below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Identity of the active set, so the poll starts and stops with it rather
  // than on every state change.
  const activeTaskHistoryKey = state.taskOrder
    .filter((taskId) => {
      const status = state.tasks[taskId]?.status;
      return status === "starting" || status === "running" || status === "question" || status === "plan_review";
    })
    .join("|");

  const reconcile = useCallback(async () => {
    try {
      const entries = await api.getTaskHistory(HISTORY_PAGE);
      if (entries.length === 0) return;
      update((current) => {
        let next = current;
        for (const entry of entries) {
          const beforeEntry = next;
          for (const event of entry.events) next = applyTaskEvent(next, event);
          if (next !== beforeEntry) {
            next = attachTaskContext(next, entry.taskId, {
              createdAt: entry.createdAt,
              conversationId: entry.conversationId,
              parentTaskId: entry.parentTaskId,
              workspaceId: entry.workspaceId,
              workspacePath: entry.workspacePath,
            });
          }
        }
        return next;
      });
    } catch {
      // Live events remain the fast path. The next reconciliation tick retries.
    }
  }, [api, update]);

  usePolling(reconcile, TASK_HISTORY_RECONCILE_INTERVAL_MS, { enabled: Boolean(activeTaskHistoryKey) });

  usePolling(
    useCallback(() => update((current) => markStalledTasks(current, Date.now())), [update]),
    STALL_POLL_INTERVAL_MS,
    { immediate: false },
  );
}
