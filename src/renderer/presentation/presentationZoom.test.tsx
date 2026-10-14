import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DesktopApiProvider } from "../services/desktopApi";
import type { DesktopAPI } from "../../shared/types";
import type { PresentationHostCommand } from "../../shared/presentationProtocol";
import { PresentationEditorFrame } from "./PresentationEditorFrame";

afterEach(cleanup);

/**
 * The deck's zoom crosses the frame in both directions (UI-14): the host's
 * opening zoom goes in ahead of the deck, and the user's later choice comes
 * back out to be remembered for the file.
 */
function stubApi(): DesktopAPI {
  return {
    preparePptxEditor: vi.fn(async () => ({
      sessionId: "session-1",
      fileId: "file-1",
      title: "deck",
      sourceFileName: "deck.pptx",
      content: new Uint8Array([1, 2, 3]),
      documentRevision: 0,
      assets: [],
    })),
    closePptxEditor: vi.fn(async () => undefined),
  } as unknown as DesktopAPI;
}

describe("presentation zoom", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({ protocolVersion: 1 }),
    })) as unknown as typeof fetch);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("sends the opening zoom before the deck and reports the user's zoom", async () => {
    const onZoomChange = vi.fn();
    render(
      <DesktopApiProvider api={stubApi()}>
        <PresentationEditorFrame
          previewToken="token"
          fileName="deck.pptx"
          onUnavailable={vi.fn()}
          zoom={80}
          onZoomChange={onZoomChange}
        />
      </DesktopApiProvider>,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    const frame = document.querySelector<HTMLIFrameElement>("iframe.pptx-embed-frame");
    if (!frame?.contentWindow) throw new Error("the editor frame did not mount");
    const postMessage = vi.spyOn(frame.contentWindow, "postMessage");
    const embedSays = async (data: unknown) => {
      await act(async () => {
        window.dispatchEvent(new MessageEvent("message", { data, source: frame.contentWindow }));
        await vi.advanceTimersByTimeAsync(0);
      });
    };

    await embedSays({ type: "presentation:embed-ready", protocolVersion: 1 });
    const commands = postMessage.mock.calls.map((call) => call[0] as PresentationHostCommand);
    const zoomAt = commands.findIndex((command) => command.type === "presentation:set-zoom");
    expect(commands[zoomAt]).toEqual({ type: "presentation:set-zoom", zoom: 80 });
    expect(zoomAt).toBeLessThan(commands.findIndex((command) => command.type === "presentation:load"));

    await embedSays({ type: "presentation:zoom-changed", zoom: "fit" });
    expect(onZoomChange).toHaveBeenCalledWith("fit");
  });
});
