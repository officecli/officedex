import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DesktopApiProvider } from "../services/desktopApi";
import type { DesktopAPI } from "../../shared/types";
import { publishCanvasLocale } from "../../shell/editor/canvasLocale";
import { PresentationEditorFrame } from "./PresentationEditorFrame";

afterEach(cleanup);

/**
 * An embed that never says hello is still an answer.
 *
 * Every failure this component can report is reached from a message the embed
 * sends, so an embed that never boots reported nothing at all: the iframe
 * loaded an empty document and the deck area stayed blank — no toast, no
 * console line, no log entry, nothing to take to a bug report. A packaged build
 * sat in that state and it could not be reproduced from the outside, because
 * from the outside there was nothing to see.
 *
 * This is the deadline that ends it. It is the only test that can catch this
 * class of failure: everything else in the suite drives the component by
 * sending it the very messages whose absence is the bug.
 */
function stubApi(): DesktopAPI {
  return {} as DesktopAPI;
}

function renderFrame(onUnavailable: (error?: string) => void) {
  return render(
    <DesktopApiProvider api={stubApi()}>
      <PresentationEditorFrame previewToken="token" fileName="deck.pptx" onUnavailable={onUnavailable} />
    </DesktopApiProvider>,
  );
}

describe("presentation embed handshake", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // The component asks for its manifest before it will mount an iframe at all.
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({ protocolVersion: 1 }),
    })) as unknown as typeof fetch);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    publishCanvasLocale(null);
  });

  it("reports an embed that loads but never reports ready", async () => {
    const onUnavailable = vi.fn();
    renderFrame(onUnavailable);

    // Let the manifest check settle so the iframe is mounted.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(onUnavailable).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(31_000);
    });

    // Asserted directly rather than through `waitFor`, which needs a real clock
    // and hangs against the fake one this test installs.
    expect(onUnavailable).toHaveBeenCalledOnce();
    expect(String(onUnavailable.mock.calls[0]?.[0])).toMatch(/never reported ready/i);
  });

  // A slow cold start is not a failure. The runtime is a large WASM bundle and
  // seconds are normal; the deadline exists to be finite, not quick.
  it("says nothing while the embed is still within its deadline", async () => {
    const onUnavailable = vi.fn();
    renderFrame(onUnavailable);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });

    expect(onUnavailable).not.toHaveBeenCalled();
  });

  it("tells the embed the shell's language", async () => {
    publishCanvasLocale("zh");
    renderFrame(vi.fn());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    const frame = document.querySelector("iframe.pptx-embed-frame");
    expect(frame?.getAttribute("src")).toContain("lang=zh-CN");
    expect(frame?.getAttribute("src")).toContain("mode=embed");
  });
});
