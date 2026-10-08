export interface Point {
  x: number;
  y: number;
}

/**
 * Gaze toward a focus point, as `--gaze-x/--gaze-y` in -1..1.
 *
 * Uses direction, not raw distance: standing beside a text block would pin gx
 * at ±1 if the vector were only divided by falloff. Close-up falloff (`k`)
 * keeps the pill from sitting on the rim of the eye hole.
 *
 * `sweep` is writing-phase progress along the current line (-1 left … +1 right)
 * mixed in so a line of type is readable as a left-to-right look, and a wrap
 * snaps back.
 */
export function gazeToward(focus: Point, markCenter: Point, sweep: number | null = null): { gx: number; gy: number } {
  const dx = focus.x - markCenter.x;
  const dy = focus.y - markCenter.y;
  const distance = Math.hypot(dx, dy) || 1;
  const k = Math.min(1, distance / 70);
  let gx = (dx / distance) * k;
  const gy = (dy / distance) * k;
  if (sweep !== null) gx = Math.max(-1, Math.min(1, gx * 0.45 + sweep * 0.75));
  return { gx, gy };
}

/** Progress of a caret along its line, mapped to -1..1. */
export function lineSweep(caretX: number, lineLeft: number, lineWidth: number): number {
  const width = lineWidth || 1;
  return Math.max(-1, Math.min(1, ((caretX - lineLeft) / width) * 2 - 1));
}
