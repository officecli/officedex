/**
 * Where the presence is allowed to be — the shell's single source of landing
 * points, clamping and edge snapping.
 *
 * Before this module the three answers lived in three places and disagreed:
 * `AgentPresence` picked the first landing point, `useDraggable.place()` did
 * the clamping, and `agent.css` decided what "tucked" looked like. The audit
 * (R2, 15 findings) is mostly that disagreement: a panel clamped to a size it
 * does not have, a tuck that moved the artwork but not its host, a landing
 * point that only knew about the viewport. Every one of those is a question
 * about geometry, so they are all answered here and nowhere else.
 */

import type { Edge } from "../state/shellReducer";

export interface DraggablePosition {
  x: number;
  y: number;
  edge: Edge;
}

export interface Size {
  width: number;
  height: number;
}

export interface Viewport {
  width: number;
  height: number;
}

/** Edges the presence must stay clear of, in CSS pixels. */
export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export const NO_INSETS: Insets = { top: 0, right: 0, bottom: 0, left: 0 };

/**
 * The strip the window controls own, measured from the viewport's top-left.
 *
 * The desktop build reserves a close / minimise / full-screen cluster and the
 * sidebar toggle in the top row; on that build they are the *only* window
 * controls there are. (On macOS the cluster is the system's own traffic lights
 * showing through the band rather than a set the page drew — see
 * `chrome/WindowBar.tsx`. Same region either way, which is why this contract is
 * about the region and not about the buttons.) A floating presence is
 * `position: fixed` at `z-index: 200`, so anything it is allowed to sit on top
 * of, it also swallows the clicks of — which is how the presence could be
 * parked over the close button with no way to shut the window (S4-001, P0).
 *
 * The numbers are deliberately **not** imported from `chrome/WindowBar.tsx`:
 * the floating layer and the window chrome are owned by different parts of the
 * shell and coupling them would make either one unable to move without the
 * other. They are a contract about a screen region, restated here, and they
 * correspond to:
 *
 *   width  132px — `.shell-windowbar`'s `min-width` in `app.css`, which exists
 *                  for exactly this reason ("the traffic lights and the
 *                  sidebar toggle always fit"). The cluster itself measures
 *                  12px padding + 63px of lights + 12px gap + 28px toggle.
 *   height  40px — `--shell-windowbar-h` in `tokens.css`, the top row.
 *
 * If the window bar ever grows past either number, the presence will start
 * covering it again; the regression test in `e2e/fix-w1b.spec.ts` asserts
 * against the live control rects rather than against these constants, so it
 * fails when that happens instead of agreeing with a stale copy.
 */
export const CHROME_RESERVE = { width: 132, height: 40 };

/**
 * Keep-out margins for a freely placed presence.
 *
 * `top: 48` clears the 40px window bar with room for the focus ring, which is
 * why free placement never needs the chrome reserve.
 */
export const PRESENCE_MARGIN = { top: 48, side: 8, bottom: 8 };

/** Where "never placed" and the Home key both land it: the bottom-right. */
export const HOME_OFFSET = { right: 24, bottom: 28 };

export interface PlaceOptions {
  viewport: Viewport;
  /** The object's measured box. Measured, not declared — see AgentPresence. */
  size: Size;
  /** How much of a tucked object stays on screen. */
  peek: number;
  /**
   * Whether an edge means "hang off it" (the collapsed mark) or "park flush
   * against it" (the expanded panel).
   *
   * A 56px mark holding on to the window edge reads as a character that has
   * got out of the way. A 340px panel with 28px showing is not a state anyone
   * can use or recognise, and the overhang carried its own header, its
   * composer and every reply's avatar off screen with it (S4-005, S6-012).
   * So the panel snaps flush and stays whole.
   */
  overhang: boolean;
  /**
   * Regions the presence must keep clear of, on top of the viewport edges.
   *
   * Zero today. This is the seam Wave 3-H plugs the canvas safe area into:
   * the embedded editors each draw their own bottom control strip (sheet tabs,
   * slide status bar, ruler) and the presence currently parks right on top of
   * them (S4-002, S4-012, S6-015). Fixing that needs the editor to report its
   * content rect through `editor/canvasContract.ts`, which this track does not
   * own — but once it does, it arrives here and nothing else has to change.
   */
  safeArea?: Insets;
}

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(Math.max(min, max), value));

/** The rectangle the presence may use, viewport minus the safe area. */
function usable(viewport: Viewport, safeArea: Insets) {
  return {
    left: safeArea.left,
    top: Math.max(PRESENCE_MARGIN.top, safeArea.top),
    right: viewport.width - safeArea.right,
    bottom: viewport.height - safeArea.bottom,
  };
}

/**
 * Whether an object whose host box lands at `anchoredY` would overlap the
 * window controls.
 *
 * It is the *anchored* y that matters, not the stored one: a tucked position
 * is deliberately off-screen and `anchorPresence` pulls the host back in, so
 * a mark stored at `y = -28` is really drawn at `y = 0`, right on the lights.
 */
function overlapsChrome(anchoredY: number): boolean {
  return anchoredY < CHROME_RESERVE.height;
}

/**
 * Clamps a candidate position, and resolves an edge into a real coordinate.
 *
 * The only function that decides where the presence may be. Drag, keyboard,
 * resize, the Home key and the first-ever landing point all come through here.
 */
export function placePresence(
  x: number,
  y: number,
  edge: Edge,
  { viewport, size, peek, overhang, safeArea = NO_INSETS }: PlaceOptions,
): DraggablePosition {
  const area = usable(viewport, safeArea);
  const freeMinX = area.left + PRESENCE_MARGIN.side;
  const freeMaxX = area.right - size.width - PRESENCE_MARGIN.side;
  const freeMaxY = area.bottom - size.height - PRESENCE_MARGIN.bottom;

  /** Along an edge the cross-axis still has to stay reachable. */
  const alongY = () =>
    clamp(y, area.top, overhang ? area.bottom - peek : area.bottom - size.height);

  /**
   * Along the top or bottom edge, x additionally has to clear the window
   * controls whenever the host box ends up in their band.
   */
  const alongX = (resolvedY: number) => {
    const anchoredY = clamp(resolvedY, 0, viewport.height - size.height);
    const min = overlapsChrome(anchoredY) ? CHROME_RESERVE.width : freeMinX;
    return clamp(x, min, overhang ? area.right - peek : freeMaxX);
  };

  if (edge === "left") {
    return { x: overhang ? peek - size.width : area.left, y: alongY(), edge };
  }
  if (edge === "right") {
    return {
      x: overhang ? area.right - peek : area.right - size.width,
      y: alongY(),
      edge,
    };
  }
  if (edge === "top") {
    const resolvedY = overhang ? peek - size.height : area.top;
    return { x: alongX(resolvedY), y: resolvedY, edge };
  }
  if (edge === "bottom") {
    const resolvedY = overhang ? area.bottom - peek : area.bottom - size.height;
    return { x: alongX(resolvedY), y: resolvedY, edge };
  }

  const freeY = clamp(y, area.top, freeMaxY);
  return {
    x: clamp(x, overlapsChrome(freeY) ? CHROME_RESERVE.width : freeMinX, freeMaxX),
    y: freeY,
    edge: null,
  };
}

/**
 * The bottom-right landing point, for a presence that has never been placed
 * and for the Home key.
 *
 * Resolved from the live viewport every time rather than stored, so growing
 * the window still puts it in the corner the design asks for. Storing it the
 * first time a window resized is what made a presence sit in the middle of a
 * larger window forever after (S4-015).
 */
export function defaultPresencePosition(
  viewport: Viewport,
  size: Size,
  safeArea: Insets = NO_INSETS,
): DraggablePosition {
  const area = usable(viewport, safeArea);
  return {
    x: Math.max(area.left + PRESENCE_MARGIN.side, area.right - size.width - HOME_OFFSET.right),
    y: Math.max(area.top, area.bottom - size.height - HOME_OFFSET.bottom),
    edge: null,
  };
}

/**
 * Splits a position into the host's on-screen anchor and the overhang.
 *
 * Placing the host itself off screen (which is what a tucked coordinate
 * literally says) takes its focus ring with it, so a keyboard user tabbing to
 * the presence would move focus to something they cannot see. The host stays
 * in the window; only the artwork hangs out, expressed as a transform.
 *
 * A flush-parked panel is already inside the window, so its overhang is zero
 * and no transform is applied to it — which is the whole of S4-004/S4-005:
 * the transform used to be written on `.shell-face`, and `.shell-face` is also
 * every avatar *inside* the panel.
 */
export function anchorPresence(
  position: DraggablePosition,
  size: Size,
  viewport: Viewport,
): { x: number; y: number; offsetX: number; offsetY: number } {
  if (!position.edge) {
    return { x: position.x, y: position.y, offsetX: 0, offsetY: 0 };
  }
  const x = clamp(position.x, 0, viewport.width - size.width);
  const y = clamp(position.y, 0, viewport.height - size.height);
  return { x, y, offsetX: position.x - x, offsetY: position.y - y };
}

/** The nearest edge within `snapDistance`, else none. */
export function detectEdge(
  position: { x: number; y: number },
  size: Size,
  viewport: Viewport,
  snapDistance: number,
  safeArea: Insets = NO_INSETS,
): Edge {
  const area = usable(viewport, safeArea);
  const distances: Array<[Exclude<Edge, null>, number]> = [
    ["left", position.x - area.left],
    ["right", area.right - position.x - size.width],
    ["top", position.y - area.top],
    ["bottom", area.bottom - position.y - size.height],
  ];
  distances.sort((a, b) => a[1] - b[1]);
  return distances[0][1] <= snapDistance ? distances[0][0] : null;
}
