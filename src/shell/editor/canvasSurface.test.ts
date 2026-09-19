/**
 * The canvas surface channel — W3-H.
 *
 * The cases that matter here are the ones about *absence*. A channel whose
 * default is wrong is worse than no channel: the three consumers (the floating
 * presence's safe area, the shell's status bar, the locale handed to a mounted
 * old-renderer component) all have a "do nothing" branch, and it has to be
 * reachable from a shell with no adapter, from Home, and from a generation
 * stage that has no chrome of its own.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  NO_CANVAS_INSETS,
  canvasKeepOut,
  publishCanvasBox,
  publishEditorChrome,
  readCanvasSurface,
  resetCanvasSurface,
  subscribeCanvasSurface,
  type EditorChrome,
} from "./canvasSurface";
import {
  canvasLocaleTag,
  publishCanvasLocale,
  readCanvasLocale,
  subscribeCanvasLocale,
} from "./canvasLocale";

const VIEWPORT = { width: 1440, height: 900 };
/** The canvas as measured in the audit: below the tab strip, left of nothing. */
const BOX = { top: 40, right: 1440, bottom: 900, left: 190 };
const SHEET: EditorChrome = {
  insets: { top: 0, right: 0, bottom: 36, left: 0 },
  ownsStatusBar: true,
};

afterEach(() => {
  resetCanvasSurface();
  publishCanvasLocale(null);
});

describe("canvas surface", () => {
  it("reports nothing before anything is published", () => {
    expect(readCanvasSurface()).toEqual({ box: null, chrome: null });
  });

  it("keeps out of nothing while no editor has reported", () => {
    publishCanvasBox(BOX);
    expect(canvasKeepOut(readCanvasSurface(), VIEWPORT)).toEqual(NO_CANVAS_INSETS);
  });

  it("keeps out of nothing while the workspace is hidden, even with an editor", () => {
    publishEditorChrome(SHEET);
    publishCanvasBox(null);
    expect(canvasKeepOut(readCanvasSurface(), VIEWPORT)).toEqual(NO_CANVAS_INSETS);
  });

  it("turns the editor's own inset into a viewport keep-out", () => {
    publishCanvasBox(BOX);
    publishEditorChrome(SHEET);
    // The footer occupies 864–900; the presence must stay above 864, which from
    // the bottom of a 900px viewport is 36.
    expect(canvasKeepOut(readCanvasSurface(), VIEWPORT)).toEqual({
      top: 0,
      right: 0,
      bottom: 36,
      left: 0,
    });
  });

  it("leaves an edge the editor did not claim alone", () => {
    publishCanvasBox(BOX);
    publishEditorChrome({ insets: { ...NO_CANVAS_INSETS, bottom: 36 }, ownsStatusBar: true });
    const keepOut = canvasKeepOut(readCanvasSurface(), VIEWPORT);
    // Not `box.left` (190): the sidebar is the shell's own inset and merging it
    // in here would count it twice.
    expect(keepOut.left).toBe(0);
    expect(keepOut.top).toBe(0);
  });

  it("goes back to silence when the editor unmounts", () => {
    publishCanvasBox(BOX);
    const release = publishEditorChrome(SHEET);
    expect(readCanvasSurface().chrome).not.toBeNull();
    release();
    expect(readCanvasSurface().chrome).toBeNull();
    expect(canvasKeepOut(readCanvasSurface(), VIEWPORT)).toEqual(NO_CANVAS_INSETS);
  });

  it("survives a tab switch where the incoming editor mounts before the outgoing one leaves", () => {
    publishCanvasBox(BOX);
    const releaseSheet = publishEditorChrome(SHEET);
    const slides: EditorChrome = {
      insets: { ...NO_CANVAS_INSETS, bottom: 32 },
      ownsStatusBar: true,
    };
    publishEditorChrome(slides);
    // React runs the outgoing component's cleanup *after* the incoming one's
    // effect. A single slot would be blanked here.
    releaseSheet();
    expect(readCanvasSurface().chrome).toEqual(slides);
  });

  it("hands out the same snapshot when a publisher repeats itself", () => {
    publishCanvasBox(BOX);
    const before = readCanvasSurface();
    publishCanvasBox({ ...BOX });
    // Identity, not equality: `useSyncExternalStore` re-renders on a new object
    // and a ResizeObserver fires with the same rect routinely.
    expect(readCanvasSurface()).toBe(before);
  });

  it("notifies subscribers only when something changed", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeCanvasSurface(listener);
    publishCanvasBox(BOX);
    publishCanvasBox({ ...BOX });
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    publishCanvasBox(null);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe("canvas locale", () => {
  it("says nothing until the shell speaks", () => {
    expect(readCanvasLocale()).toBeNull();
    expect(canvasLocaleTag()).toBeNull();
  });

  it("carries the shell's language across to the canvas root", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeCanvasLocale(listener);
    publishCanvasLocale("zh");
    expect(readCanvasLocale()).toBe("zh");
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it("spells the tag out for a request parameter", () => {
    expect(canvasLocaleTag("zh")).toBe("zh-CN");
    expect(canvasLocaleTag("en")).toBe("en-US");
  });
});
