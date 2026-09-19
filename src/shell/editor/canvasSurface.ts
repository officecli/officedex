/**
 * What the shell and the thing mounted in its canvas know about each other's
 * boxes.
 *
 * The audit found three defects with one cause: `canvasContract.ts` describes
 * what an adapter can be *asked to do* and nothing about what it *occupies*.
 * So the floating presence parked itself with `innerWidth - width - 24` and
 * landed on the sheet tab strip, the slide status bar and the Writer ruler
 * (S4-002, S4-012, S6-015); and `App.tsx` drew its own status bar
 * unconditionally over three editors that each draw one too, which came out as
 * two bars, two bars, and — under the workbook's `position: fixed` footer —
 * none at all (S4-003, S4-010).
 *
 * ── Why this is not on `CanvasAdapter` ──────────────────────────────────────
 *
 * Two reasons, and the second is the load-bearing one.
 *
 * 1. `CanvasAdapter` is already the longest interface in `src/shell`. Every
 *    question the shell has ever wanted to ask an editor has been answered by
 *    adding a method, and "how tall is your own toolbar" is not the same kind
 *    of question as "save" or "showDraft" — it is not an instruction at all.
 *
 * 2. **The adapter is not what knows.** One adapter serves the whole shell for
 *    its entire life (see the note in `createDesktopCanvas`), while what is
 *    drawn under it changes with every tab *and* with every run: a deck being
 *    generated mounts a stage with `position: absolute; inset: 0` and no chrome
 *    whatsoever, then the same tab becomes a finished .pptx in an editor with a
 *    ribbon and a status bar. An answer that comes from the adapter object
 *    would have to be re-plumbed through it from the leaf that actually knows,
 *    which is exactly the `onSave` / `onSelectionChange` / `onDirtyChange`
 *    ladder — five props deep and already there three times.
 *
 * Reserving space for a control strip that is not currently on screen is not a
 * cosmetic error: it is how the shell ends up moving out of the way of a deck
 * that is still being drawn.
 *
 * So the leaf publishes and the shell subscribes, through a module channel
 * rather than through the object. There is exactly one canvas host per shell
 * (decision 4, guarded by `EditorCanvasHost.test.tsx`), so a module-level value
 * is not a shortcut around a collection — it is the shape of the thing.
 *
 * ── The default is silence ──────────────────────────────────────────────────
 *
 * Nothing has to publish. `createShellCanvas()` returns null outside the
 * desktop app, no editor mounts, nothing reports, and every consumer here
 * answers "no information" — which is defined to mean *the behaviour that was
 * there before this file existed*: the presence keeps its viewport-relative
 * corner, and the shell keeps its own status bar. A missing report must never
 * read as "the editor has no chrome", because those two are opposite
 * instructions and only one of them is safe to guess.
 */

import { useSyncExternalStore } from "react";

/** Distances from the edges of a box, in CSS pixels. */
export interface CanvasInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export const NO_CANVAS_INSETS: CanvasInsets = { top: 0, right: 0, bottom: 0, left: 0 };

/** The canvas host's rectangle, in viewport coordinates. */
export interface CanvasBox {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/**
 * What the editor currently on screen says about the space it has taken.
 *
 * `insets` are measured inward from the canvas box, not from the viewport: the
 * editor knows how tall its own ribbon and status bar are, and knows nothing
 * about where the shell decided to put the box. The translation to viewport
 * coordinates is `canvasKeepOut`, below, and it is the shell's job because the
 * box is the shell's fact.
 */
export interface EditorChrome {
  /** Editor-drawn controls along each edge of the canvas box. */
  readonly insets: CanvasInsets;
  /**
   * The editor draws a status bar of its own along the bottom.
   *
   * Separate from `insets.bottom` because it answers a different question.
   * `insets.bottom` tells the floating layer where not to park; this tells the
   * shell whether drawing `StatusBar` would be the second one on screen. An
   * editor could have a bottom strip that is not a status bar (a horizontal
   * scrollbar), and a stage could have neither.
   */
  readonly ownsStatusBar: boolean;
}

export interface CanvasSurface {
  /** Where the canvas is, or null while the workspace is hidden (Home). */
  readonly box: CanvasBox | null;
  /** What is in it, or null when nothing has said — see the note above. */
  readonly chrome: EditorChrome | null;
}

const EMPTY_SURFACE: CanvasSurface = { box: null, chrome: null };

let box: CanvasBox | null = null;
/**
 * Published chrome, newest last.
 *
 * A stack rather than a single slot because two editors overlap for a moment
 * at every tab switch: React mounts the incoming leaf before running the
 * outgoing one's effect cleanup, so a single slot would be cleared by the
 * editor that is leaving and the shell would spend that frame believing the
 * canvas has no chrome. The live entry is the last one still registered.
 */
const published: Array<{ chrome: EditorChrome }> = [];

let snapshot: CanvasSurface = EMPTY_SURFACE;
const listeners = new Set<() => void>();

function sameInsets(a: CanvasInsets, b: CanvasInsets): boolean {
  return a.top === b.top && a.right === b.right && a.bottom === b.bottom && a.left === b.left;
}

function sameBox(a: CanvasBox | null, b: CanvasBox | null): boolean {
  if (a === null || b === null) return a === b;
  return a.top === b.top && a.right === b.right && a.bottom === b.bottom && a.left === b.left;
}

function sameChrome(a: EditorChrome | null, b: EditorChrome | null): boolean {
  if (a === null || b === null) return a === b;
  return a.ownsStatusBar === b.ownsStatusBar && sameInsets(a.insets, b.insets);
}

/**
 * Rebuilds the snapshot, and only when something actually changed.
 *
 * `useSyncExternalStore` compares snapshots by identity and re-renders on a new
 * one, so handing out a fresh object per read would loop. The publishers here
 * are a `ResizeObserver` and a mount effect, both of which fire with identical
 * values routinely.
 */
function commit(): void {
  const chrome = published.length > 0 ? published[published.length - 1].chrome : null;
  if (sameBox(snapshot.box, box) && sameChrome(snapshot.chrome, chrome)) return;
  snapshot = { box, chrome };
  for (const listener of listeners) listener();
}

/** The shell reports where it put the canvas. Null while it is not showing. */
export function publishCanvasBox(next: CanvasBox | null): void {
  box = next;
  commit();
}

/**
 * An editor reports its own chrome. Returns the release, for the effect that
 * published it — an editor that has unmounted is not describing anything.
 */
export function publishEditorChrome(chrome: EditorChrome): () => void {
  const entry = { chrome };
  published.push(entry);
  commit();
  return () => {
    const at = published.indexOf(entry);
    if (at === -1) return;
    published.splice(at, 1);
    commit();
  };
}

export function readCanvasSurface(): CanvasSurface {
  return snapshot;
}

export function subscribeCanvasSurface(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Drops every report. For tests, which share one module across cases. */
export function resetCanvasSurface(): void {
  box = null;
  published.length = 0;
  snapshot = EMPTY_SURFACE;
  for (const listener of listeners) listener();
}

export function useCanvasSurface(): CanvasSurface {
  return useSyncExternalStore(subscribeCanvasSurface, readCanvasSurface, readCanvasSurface);
}

/**
 * The editor's chrome expressed as keep-out margins from the viewport edges,
 * which is what a `position: fixed` floating layer can use.
 *
 * All zeros when either half is missing. That is the "no information" answer
 * and it has to be the additive identity, because the caller merges it with
 * insets it already had (the sidebar) using `max` — a sentinel that meant
 * anything else would either win over a real one or have to be special-cased at
 * every call site.
 *
 * Each edge is zero unless the editor claimed something there, rather than
 * being derived from the box alone: the shell's own status bar sits below the
 * canvas and is not the editor's to reserve, and an edge with no editor chrome
 * on it is an edge the presence may still use.
 */
export function canvasKeepOut(
  surface: CanvasSurface,
  viewport: { width: number; height: number },
): CanvasInsets {
  const { box: rect, chrome } = surface;
  if (!rect || !chrome) return NO_CANVAS_INSETS;
  const { insets } = chrome;
  return {
    top: insets.top > 0 ? Math.max(0, rect.top + insets.top) : 0,
    right: insets.right > 0 ? Math.max(0, viewport.width - (rect.right - insets.right)) : 0,
    bottom: insets.bottom > 0 ? Math.max(0, viewport.height - (rect.bottom - insets.bottom)) : 0,
    left: insets.left > 0 ? Math.max(0, rect.left + insets.left) : 0,
  };
}
