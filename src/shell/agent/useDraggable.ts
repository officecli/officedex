import { useCallback, useEffect, useRef, useState } from "react";

import type { Edge } from "../state/shellReducer";

export interface DraggablePosition {
  x: number;
  y: number;
  edge: Edge;
}

export interface UseDraggableOptions {
  position: DraggablePosition;
  onChange: (next: DraggablePosition) => void;
  /** Size of the dragged object, used for clamping and edge detection. */
  size: { width: number; height: number };
  /** Distance from an edge at which the object tucks away. */
  snapDistance?: number;
  /** How much of the object stays on screen when tucked. */
  peek?: number;
  /** Keyboard step, and the shift-modified step. */
  step?: number;
  bigStep?: number;
  /** Where Home sends it back to, as a fraction of the viewport. */
  home?: { right: number; bottom: number };
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

/**
 * The shell's only drag implementation.
 *
 * The prototype carried three near-identical copies of this — one for the
 * status pet, one for the editor companion, one for the floating task panel —
 * each with its own edge-snapping, its own Home key and its own coordinate
 * clamping against a fixed 1440×900 canvas. Decision 1 collapses the three
 * objects into one, and this collapses their three drag behaviours into one.
 *
 * Coordinates are viewport-relative rather than canvas-relative: the shell is
 * genuinely responsive, so there is no 1440×900 to clamp against.
 */
export function useDraggable({
  position,
  onChange,
  size,
  snapDistance = 24,
  peek = 28,
  step = 10,
  bigStep = 40,
  home = { right: 24, bottom: 28 },
}: UseDraggableOptions) {
  const [dragging, setDragging] = useState(false);
  const origin = useRef<{ pointerId: number; x: number; y: number; from: DraggablePosition } | null>(null);

  const bounds = useCallback(() => {
    const width = typeof window === "undefined" ? 1440 : window.innerWidth;
    const height = typeof window === "undefined" ? 900 : window.innerHeight;
    return { width, height };
  }, []);

  const place = useCallback(
    (x: number, y: number, edge: Edge): DraggablePosition => {
      const { width, height } = bounds();
      if (edge === "left") return { x: peek - size.width, y: clamp(y, 48, height - peek), edge };
      if (edge === "right") return { x: width - peek, y: clamp(y, 48, height - peek), edge };
      if (edge === "top") return { x: clamp(x, 12, width - peek), y: peek - size.height, edge };
      if (edge === "bottom") return { x: clamp(x, 12, width - peek), y: height - peek, edge };
      return {
        x: clamp(x, 8, Math.max(8, width - size.width - 8)),
        y: clamp(y, 48, Math.max(48, height - size.height - 8)),
        edge: null,
      };
    },
    [bounds, peek, size.width, size.height],
  );

  /** Nearest edge within `snapDistance`, else no edge. */
  const detectEdge = useCallback(
    (x: number, y: number): Edge => {
      const { width, height } = bounds();
      const distances: Array<[Exclude<Edge, null>, number]> = [
        ["left", x],
        ["right", width - x - size.width],
        ["top", y - 40],
        ["bottom", height - y - size.height],
      ];
      distances.sort((a, b) => a[1] - b[1]);
      return distances[0][1] <= snapDistance ? distances[0][0] : null;
    },
    [bounds, size.width, size.height, snapDistance],
  );

  const reset = useCallback(() => {
    const { width, height } = bounds();
    onChange(
      place(width - size.width - home.right, height - size.height - home.bottom, null),
    );
  }, [bounds, onChange, place, size.width, size.height, home.right, home.bottom]);

  // A window resize must not leave the object stranded off screen.
  useEffect(() => {
    const onResize = () => onChange(place(position.x, position.y, position.edge));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [onChange, place, position.x, position.y, position.edge]);

  const handleProps = {
    onPointerDown(event: React.PointerEvent<HTMLElement>) {
      if (event.button !== 0) return;
      // The grip drags; controls sitting inside it stay clickable.
      if ((event.target as HTMLElement).closest("button, a, input, textarea, select")) return;
      event.preventDefault();
      origin.current = {
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        from: { ...position },
      };
      event.currentTarget.setPointerCapture(event.pointerId);
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
        const edge = detectEdge(position.x, position.y);
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
