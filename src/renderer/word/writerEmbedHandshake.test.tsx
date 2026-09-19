import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DesktopApiProvider } from "../services/desktopApi";
import type { DesktopAPI } from "../../shared/types";
import { WriterEditorFrame } from "./WriterEditorFrame";

afterEach(cleanup);

/**
 * An embed that never says hello is still an answer.
 *
 * Writer throws during module evaluation when the host has not installed
 * `globalThis.s18n` — inside its own module graph, where no host callback can
 * see it. The iframe loads an empty document, `writer:embed-ready` never
 * arrives, and every error path in this component is downstream of that
 * message. So every .docx opened to a blank page with nothing said anywhere:
 * not on screen, not in a console the user could reach, not in the log.
 *
 * The bootstrap is fixed in scripts/sync-writer-component.mjs. This is the
 * other half — the frame no longer waits forever for an embed that will never
 * answer. It is the only test that can catch this shape of failure, because
 * every other one drives the component by sending it the very messages whose
 * absence is the bug.
 */
function stubApi(): DesktopAPI {
  return {} as DesktopAPI;
}

function renderFrame(onUnavailable: (error?: string) => void) {
  return render(
    <DesktopApiProvider api={stubApi()}>
      <WriterEditorFrame previewToken="token" fileName="notes.docx" onUnavailable={onUnavailable} />
    </DesktopApiProvider>,
  );
}

describe("writer embed handshake", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // The component checks its manifest before it will mount an iframe at all.
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({ protocolVersion: 1 }),
    })) as unknown as typeof fetch);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("reports an embed that loads but never reports ready", async () => {
    const onUnavailable = vi.fn();
    renderFrame(onUnavailable);

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

  it("says nothing while the embed is still within its deadline", async () => {
    const onUnavailable = vi.fn();
    renderFrame(onUnavailable);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });

    expect(onUnavailable).not.toHaveBeenCalled();
  });
});
