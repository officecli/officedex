import { useEffect, type ReactNode } from "react";

import type { BridgeEvent, DesktopAPI } from "../shared/types";
import { applyTaskEvent } from "../renderer/taskState";
import { TaskStoreProvider, useTaskStore } from "../renderer/store/taskStore";

/**
 * Task state for the canvas layer.
 *
 * The presentation stage needs a whole `DesktopTask` — its stages, its pending
 * question, its partial work, its artifact. `AgentTask`, which is what `UiPort`
 * carries, is a lossy projection of that for a chat panel; it has a status and a
 * phase label and nothing the stage draws from.
 *
 * So this reduces the bridge stream a second time, with `applyTaskEvent`, the
 * same pure function `src/services/agent.ts` uses. **That is not two sources of
 * truth.** Same input, same reducer, two readers with different needs — the way
 * a database has more than one index. The alternative, exposing the agent
 * service's private state so the canvas could reach into it, would couple two
 * layers that currently share only a contract.
 *
 * Mirrors the reduction half of `src/renderer/controllers/useBridgeLifecycle.ts`
 * and nothing else: no toasts, no routing, no recovery — those belong to the old
 * app's shell, not to a document canvas.
 */
export function CanvasTaskStore({ api, children }: { api: DesktopAPI; children: ReactNode }) {
  return (
    <TaskStoreProvider>
      <TaskStorePump api={api} />
      {children}
    </TaskStoreProvider>
  );
}

function TaskStorePump({ api }: { api: DesktopAPI }) {
  const { update } = useTaskStore();

  useEffect(() => {
    // Subscribed for the provider's whole life rather than per reader: a run
    // that started before the stage was on screen still has to be in the store
    // when it gets there.
    return api.onBridgeEvent((event: BridgeEvent) => {
      if (!event.task_id) return;
      update((current) => applyTaskEvent(current, event));
    });
  }, [api, update]);

  // History is what a reload has instead of the events it missed.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const entries = await api.getTaskHistory(50).catch(() => []);
      if (cancelled || entries.length === 0) return;
      update((current) =>
        entries.reduce(
          (state, entry) => entry.events.reduce(applyTaskEvent, state),
          current,
        ),
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [api, update]);

  return null;
}
