import { useEffect, useRef } from "react";

/**
 * Pointer-tracked gaze: the companion's eyes follow the cursor.
 *
 * The prototype did this inside its global requestAnimationFrame loop, which
 * recomputed every eye path on every frame whether the pointer had moved or
 * not. Here the eyes are a `translate` driven by two CSS custom properties, so
 * a move costs one `getBoundingClientRect` per visible mark and two property
 * writes — and only on frames where the pointer actually moved.
 *
 * One listener serves every mark on the page; marks register themselves by
 * mounting the returned ref.
 */

const targets = new Set<HTMLElement>();
let pointer: { x: number; y: number } | null = null;
let frame = 0;
let listening = false;

/**
 * Travel, in the artboard's own units — roughly the prototype's `playful`
 * mood. Less than this and the eyes barely move at 56px, which is the size the
 * presence actually appears at; much more and the mark looks twitchy.
 */
const MAX_X = 5.5;
const MAX_Y = 3.6;
/** Distance, in px, at which the gaze is fully committed to one side. */
const FALLOFF = 190;

const clamp = (value: number, limit: number) => Math.max(-limit, Math.min(limit, value));

function apply() {
  frame = 0;
  if (!pointer) return;
  for (const element of targets) {
    const rect = element.getBoundingClientRect();
    if (rect.width === 0) continue;
    const x = clamp(((pointer.x - (rect.left + rect.width / 2)) / FALLOFF) * MAX_X, MAX_X);
    const y = clamp(((pointer.y - (rect.top + rect.height / 2)) / FALLOFF) * MAX_Y, MAX_Y);
    element.style.setProperty("--shell-face-gaze-x", `${x.toFixed(2)}px`);
    element.style.setProperty("--shell-face-gaze-y", `${y.toFixed(2)}px`);
  }
}

function onPointerMove(event: PointerEvent) {
  pointer = { x: event.clientX, y: event.clientY };
  if (frame === 0) frame = requestAnimationFrame(apply);
}

function listen() {
  if (listening || typeof window === "undefined") return;
  listening = true;
  window.addEventListener("pointermove", onPointerMove, { passive: true });
}

function stopListening() {
  if (!listening || targets.size > 0) return;
  listening = false;
  window.removeEventListener("pointermove", onPointerMove);
  if (frame !== 0) {
    cancelAnimationFrame(frame);
    frame = 0;
  }
}

/**
 * @param enabled tracking is per-mark: a 16px mark in a menu row, or a mark
 * printed next to an old reply, should hold still.
 */
export function useGaze(enabled: boolean) {
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    // Following the cursor is continuous motion, so it goes with the rest of it.
    const still =
      typeof window === "undefined" || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!enabled || still) {
      element.style.removeProperty("--shell-face-gaze-x");
      element.style.removeProperty("--shell-face-gaze-y");
      return;
    }

    targets.add(element);
    listen();
    if (pointer && frame === 0) frame = requestAnimationFrame(apply);

    return () => {
      targets.delete(element);
      element.style.removeProperty("--shell-face-gaze-x");
      element.style.removeProperty("--shell-face-gaze-y");
      stopListening();
    };
  }, [enabled]);

  return ref;
}
