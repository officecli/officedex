import { useCallback, useEffect, useRef, useState } from "react";

import type { Size } from "./presenceLayout";

/**
 * The element's real box, kept in state.
 *
 * Every vertical clamp in the floating layer used to be fed a declared
 * `PANEL_SIZE.height = 520` while the panel actually rendered at 543 — so the
 * presence could be dragged 23px past the bottom of the window and the
 * composer got cut off by the window edge (S6-011). The height is not a
 * constant anyone can maintain: it is content plus padding under a
 * `max-height: min(76vh, 620px)` cap, so it changes with the conversation and
 * with the window. Measuring it is the only version of this number that
 * cannot drift.
 *
 * `fallback` is what the first render and jsdom get — a `ResizeObserver` has
 * not fired yet at that point, and the test environment's is a no-op.
 */
export function useMeasuredSize(fallback: Size): {
  size: Size;
  ref: (node: HTMLElement | null) => void;
} {
  const [measured, setMeasured] = useState<Size | null>(null);
  const observer = useRef<ResizeObserver | null>(null);

  useEffect(() => () => observer.current?.disconnect(), []);

  const ref = useCallback((node: HTMLElement | null) => {
    observer.current?.disconnect();
    observer.current = null;
    if (!node || typeof ResizeObserver === "undefined") {
      setMeasured(null);
      return;
    }
    const apply = () => {
      const rect = node.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      setMeasured((current) =>
        current && Math.abs(current.width - rect.width) < 0.5 && Math.abs(current.height - rect.height) < 0.5
          ? current
          : { width: rect.width, height: rect.height },
      );
    };
    apply();
    const next = new ResizeObserver(apply);
    next.observe(node);
    observer.current = next;
  }, []);

  return { size: measured ?? fallback, ref };
}
