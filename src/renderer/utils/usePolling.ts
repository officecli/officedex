import { useEffect, useRef } from "react";

export interface PollingOptions {
  /** Run once immediately on mount / when the key changes. Default true. */
  immediate?: boolean;
  /** Pause without unmounting: no ticks run while false. Default true. */
  enabled?: boolean;
  /** Also run when the document becomes visible again. Default false. */
  refreshOnVisible?: boolean;
}

/**
 * Calls `refresh` every `intervalMs` while mounted. This is the one polling
 * loop for the renderer: the task-history reconcile, the runtime panels, the
 * workbook data source and the credit status each had their own
 * setInterval/clearInterval pair, and they disagreed about overlap and
 * cleanup. Here a tick never overlaps a still-running refresh, the latest
 * `refresh` is always the one called (no stale closure), and unmount stops
 * everything.
 */
export function usePolling(refresh: () => void | Promise<void>, intervalMs: number, options: PollingOptions = {}): void {
  const { immediate = true, enabled = true, refreshOnVisible = false } = options;
  const latest = useRef(refresh);
  latest.current = refresh;
  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    let running = false;
    const tick = async () => {
      if (disposed || running) return;
      running = true;
      try {
        await latest.current();
      } catch {
        // A failed tick is the caller's to report; the loop keeps going.
      } finally {
        running = false;
      }
    };
    if (immediate) void tick();
    const timer = window.setInterval(() => void tick(), intervalMs);
    const onVisible = () => {
      if (document.visibilityState === "visible") void tick();
    };
    if (refreshOnVisible) document.addEventListener("visibilitychange", onVisible);
    return () => {
      disposed = true;
      window.clearInterval(timer);
      if (refreshOnVisible) document.removeEventListener("visibilitychange", onVisible);
    };
  }, [intervalMs, immediate, enabled, refreshOnVisible]);
}
