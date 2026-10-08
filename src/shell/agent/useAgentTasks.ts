import { useEffect, useState } from "react";

import { usePort } from "../port/PortContext";
import type { AgentTask, AgentTaskSummary } from "../../shared/uiPort";
import { isNotImplemented } from "../../shared/notImplemented";
import { logShellEvent } from "../port/shellLog";

/** Matches the service's own default; see LIST_LIMIT in src/services/agent.ts. */
const DEFAULT_LIMIT = 8;

/**
 * Every folder's recent runs, kept live off the port's event stream.
 *
 * The plural of `useAgentTask`, and deliberately not a generalisation of it.
 * That hook answers "what is the agent doing *here*" and is scoped to
 * `scopeFolderId`; this one answers "what was I doing" and is scoped to
 * nothing, because a run started in another folder is still the user's work
 * and switching the folder chip used to make it vanish from Home.
 *
 * Nothing here can fail loudly. Home draws this band without anyone asking for
 * it, so a rejected read is not a click that disappeared — it is a section that
 * does not appear, which is a shape the band already has (an empty list renders
 * nothing at all).
 */
export function useAgentTasks(limit: number = DEFAULT_LIMIT) {
  const port = usePort();
  const [tasks, setTasks] = useState<AgentTaskSummary[]>([]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const rows = await port.agent.list({ limit });
        if (!cancelled) setTasks(rows);
      } catch (reason) {
        if (cancelled) return;
        /*
         * A port without `list` behind it is not a failure the user caused.
         *
         * `reportPortFailure` would be wrong here on both branches: a "not
         * built yet" notice would pop on every visit to Home with nobody
         * having pressed anything, and a real failure of a background read
         * would raise an error over a band the user never asked to see. The
         * log is where this belongs — it is what a packaged build leaves
         * behind — and on screen the band simply stays away.
         */
        const message = reason instanceof Error ? reason.message : String(reason);
        if (isNotImplemented(reason)) {
          logShellEvent("not-implemented", { feature: reason.feature, message });
          return;
        }
        logShellEvent("port-failure", { feature: "agent.list", message });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [port, limit]);

  useEffect(
    () =>
      port.agent.subscribe((event) => {
        // Errors and notices belong to `useAgentTask`, which announces them
        // once. Two subscribers reporting the same rejection is two toasts for
        // one failure, and this one has no run of its own to speak for.
        if (event.kind !== "task") return;
        setTasks((rows) => merge(rows, event.task, limit));
      }),
    [port, limit],
  );

  // No `refresh` here on purpose. The port's own event stream is what keeps
  // this list current, and a manual re-read exists only for a caller that
  // knows something the stream does not — there is no such caller today, and
  // an exported escape hatch nobody uses is how a second, divergent way of
  // loading this band gets started.
  return { tasks };
}

/**
 * Folds a live task into the list.
 *
 * Only the five fields a row draws are taken across. The event carries a whole
 * `AgentTask` — every message, every step, the suggestion — and copying that
 * into the list would undo the reason `AgentTaskSummary` is a separate type:
 * Home would be holding a dozen transcripts to render a dozen one-line rows.
 *
 * A row already in the list is updated **in place** rather than moved to the
 * front. Order is the port's answer to "how recent", settled once at load; a
 * running task emits an event every second or so, and re-sorting on each one
 * would shuffle the band under the pointer of whoever is reading it. A task
 * that is *not* in the list is genuinely new — it has no position to keep — so
 * it goes to the top, which is where a run started a moment ago belongs.
 *
 * `updatedAt` is carried over from the existing row rather than restamped. The
 * shell does not display it and cannot observe it: writing `Date.now()` here
 * would replace something the runtime knows with something the renderer
 * guessed.
 */
function merge(rows: AgentTaskSummary[], task: AgentTask, limit: number): AgentTaskSummary[] {
  const busyImage = task.image?.runs.some((run) => run.status === "running") ?? false;
  const row: AgentTaskSummary = {
    // An image series is one row keyed by its first run, and a conversation
    // one row keyed by its id, whichever run this event came from — the same
    // keys `agent.list` hands out.
    id: task.image?.runs[0]?.taskId ?? task.conversationId ?? task.id,
    ...(task.conversationId ? { conversationId: task.conversationId } : {}),
    title: task.title,
    folderId: task.folderId,
    status: busyImage && task.status === "done" ? "writing" : task.status,
    phase: task.phase,
    ...(task.image ? { image: task.image } : {}),
  };
  const index = rows.findIndex((entry) => entry.id === row.id);
  if (index < 0) return [row, ...rows].slice(0, limit);
  const next = [...rows];
  next[index] = { ...rows[index], ...row };
  return next;
}
