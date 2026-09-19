import { useEffect, useRef } from "react";

import { AttentionOverlay, type AttentionBox } from "./attentionOverlay";

/** How far inside the workspace the border sits when it frames the whole canvas. */
const INSET = 10;

export interface AttentionBorderProps {
  /** The agent is doing something to this document right now. */
  active: boolean;
  /**
   * Where, in the host's pixels. Null frames the whole canvas.
   *
   * Nothing passes a box yet: the shell cannot see inside a mounted editor, so
   * paragraph-level coordinates have to come from the canvas adapter, and
   * `CanvasAdapter` has no channel for them. Framing the document is the
   * honest version of the same signal — "the agent is working in here" — and
   * the day the adapter can say "this paragraph", it says it through here.
   */
  box?: AttentionBox | null;
}

/**
 * The border the prototype drew around whatever the agent was working on.
 *
 * Mounted permanently and told when to show, like everything else on the
 * canvas seam (decision 4): the overlay owns a clock, and a component that
 * unmounts between runs restarts it — the light would jump back to the same
 * corner every time the agent started.
 */
export function AttentionBorder({ active, box = null }: AttentionBorderProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<AttentionOverlay | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const overlay = new AttentionOverlay(host);
    overlayRef.current = overlay;
    return () => {
      overlayRef.current = null;
      overlay.dispose();
    };
  }, []);

  useEffect(() => {
    const host = hostRef.current;
    const overlay = overlayRef.current;
    if (!host || !overlay) return;

    if (!active) {
      overlay.hide();
      return;
    }

    // The whole-canvas box is a layout answer, so it is re-asked whenever the
    // layout changes — the agent column opening is a resize, not a re-render.
    const paint = () => {
      if (box) {
        overlay.focus(box);
        return;
      }
      const rect = host.getBoundingClientRect();
      if (rect.width < 2 * INSET || rect.height < 2 * INSET) {
        overlay.hide(true);
        return;
      }
      overlay.focus({
        left: INSET,
        top: INSET,
        width: rect.width - 2 * INSET,
        height: rect.height - 2 * INSET,
      });
    };

    paint();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(paint);
    observer.observe(host);
    return () => observer.disconnect();
  }, [active, box]);

  return <div ref={hostRef} className="shell-attention" aria-hidden="true" />;
}
