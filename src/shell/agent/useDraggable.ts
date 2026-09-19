import { useCallback, useEffect, useRef, useState } from "react";

import type { Edge } from "../state/shellReducer";
import {
  NO_INSETS,
  defaultPresencePosition,
  detectEdge,
  placePresence,
  type DraggablePosition,
  type Insets,
  type Size,
  type Viewport,
} from "./presenceLayout";

export type { DraggablePosition } from "./presenceLayout";

export interface UseDraggableOptions {
  position: DraggablePosition;
  onChange: (next: DraggablePosition) => void;
  /** Size of the dragged object. Measured, not declared — see useMeasuredSize. */
  size: Size;
  /** The viewport, as state, so a resize re-renders rather than persists. */
  viewport: Viewport;
  /**
   * Whether the user has actually placed this object.
   *
   * False means `position` is a default derived from the viewport. A resize
   * must not write that default into persisted state: doing so is what turned
   * "never placed" into a stale absolute coordinate the first time a window
   * changed size (S4-015).
   */
  placed?: boolean;
  /** Whether an edge means "hang off it" or "park flush against it". */
  overhang?: boolean;
  /** Regions to keep clear of, on top of the viewport edges. */
  safeArea?: Insets;
  /** Distance from an edge at which the object snaps to it. */
  snapDistance?: number;
  /** How much of the object stays on screen when tucked. */
  peek?: number;
  /** Keyboard step, and the shift-modified step. */
  step?: number;
  bigStep?: number;
}

/**
 * The shell's only drag implementation.
 *
 * The prototype carried three near-identical copies of this — one for the
 * status pet, one for the editor companion, one for the floating task panel —
 * each with its own edge-snapping, its own Home key and its own coordinate
 * clamping against a fixed 1440×900 canvas. Decision 1 collapses the three
 * objects into one, and this collapses their three drag behaviours into one.
 *
 * The geometry itself now lives in `presenceLayout.ts`: this hook owns pointer
 * and key handling, and asks that module where things are allowed to be. Three
 * callers used to answer that question separately and disagree (R2).
 */
export function useDraggable({
  position,
  onChange,
  size,
  viewport,
  placed = true,
  overhang = true,
  safeArea = NO_INSETS,
  snapDistance = 24,
  peek = 28,
  step = 10,
  bigStep = 40,
}: UseDraggableOptions) {
  const [dragging, setDragging] = useState(false);
  const origin = useRef<{ pointerId: number; x: number; y: number; from: DraggablePosition } | null>(null);
  const draggedRef = useRef(false);

  const place = useCallback(
    (x: number, y: number, edge: Edge): DraggablePosition =>
      placePresence(x, y, edge, { viewport, size, peek, overhang, safeArea }),
    [viewport, size, peek, overhang, safeArea],
  );

  /** The Home key. Same landing point as "never placed" — one rule, one place. */
  const reset = useCallback(() => {
    onChange(defaultPresencePosition(viewport, size, safeArea));
  }, [onChange, viewport, size, safeArea]);

  /**
   * A window resize must not leave a *placed* object stranded off screen.
   *
   * An unplaced one is left alone on purpose: its coordinates are derived from
   * the viewport on every render, so re-deriving is already the correct
   * behaviour and writing them down would only destroy the sentinel.
   */
  useEffect(() => {
    if (!placed) return;
    const next = place(position.x, position.y, position.edge);
    if (next.x === position.x && next.y === position.y && next.edge === position.edge) return;
    onChange(next);
  }, [placed, place, onChange, position.x, position.y, position.edge]);

  /**
   * Escape abandons a drag in progress and puts the object back.
   *
   * On `window`, not on the handle: a pointer capture does not move focus, so
   * during a drag the key event goes to whatever had focus before — usually
   * not the thing being dragged. The prototype had the same escape hatch, and
   * without it the only way out of a drag you did not mean to start is to
   * finish it somewhere and drag back.
   */
  useEffect(() => {
    if (!dragging) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      const start = origin.current;
      if (!start) return;
      event.preventDefault();
      origin.current = null;
      setDragging(false);
      onChange(start.from);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [dragging, onChange]);

  const handleProps = {
    onPointerDown(event: React.PointerEvent<HTMLElement>) {
      if (event.button !== 0) return;
      /*
       * Controls *inside* the grip stay clickable — the header's dock button
       * is one. The handle itself is not one of them: the collapsed presence
       * is a `<button>` with these props on it, so a blanket `closest("button")`
       * matched the handle and the mark could not be dragged at all. It is the
       * object most able to end up on top of the window controls, and the
       * only way to move it was the arrow keys.
       */
      const control = (event.target as HTMLElement).closest("button, a, input, textarea, select");
      if (control && control !== event.currentTarget) return;
      event.preventDefault();
      origin.current = {
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        from: { ...position },
      };
      event.currentTarget.setPointerCapture(event.pointerId);
    },

    /*
     * A drag must not also read as a click.
     *
     * `dragging` is already false by the time the click arrives — the state
     * update from pointerup has landed — so the flag the handler reads cannot
     * be the same one the render reads. This one is a ref, set on pointerup
     * and spent by the very next click.
     */
    onClickCapture(event: React.MouseEvent<HTMLElement>) {
      if (!draggedRef.current) return;
      draggedRef.current = false;
      event.preventDefault();
      event.stopPropagation();
    },

    onPointerMove(event: React.PointerEvent<HTMLElement>) {
      const start = origin.current;
      if (!start || start.pointerId !== event.pointerId) return;
      const dx = event.clientX - start.x;
      const dy = event.clientY - start.y;
      if (!dragging && Math.hypot(dx, dy) < 6) return;
      setDragging(true);
      onChange(place(start.from.x + dx, start.from.y + dy, null));
    },

    onPointerUp(event: React.PointerEvent<HTMLElement>) {
      const start = origin.current;
      origin.current = null;
      if (!start) return;
      if (dragging) {
        draggedRef.current = true;
        const edge = detectEdge(position, size, viewport, snapDistance, safeArea);
        onChange(place(position.x, position.y, edge));
      }
      setDragging(false);
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    },

    onPointerCancel() {
      const start = origin.current;
      origin.current = null;
      if (start) onChange(start.from);
      setDragging(false);
    },

    onKeyDown(event: React.KeyboardEvent<HTMLElement>) {
      if (event.key === "Home") {
        event.preventDefault();
        reset();
        return;
      }
      if (!event.key.startsWith("Arrow")) return;
      event.preventDefault();
      const delta = event.shiftKey ? bigStep : step;
      const dx = event.key === "ArrowLeft" ? -delta : event.key === "ArrowRight" ? delta : 0;
      const dy = event.key === "ArrowUp" ? -delta : event.key === "ArrowDown" ? delta : 0;
      // Arrowing off an edge un-tucks first, so the object cannot get stuck.
      onChange(place(position.x + dx, position.y + dy, null));
    },
  };

  return { dragging, handleProps, reset, place };
}
