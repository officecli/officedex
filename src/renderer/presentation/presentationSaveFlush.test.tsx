import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DesktopApiProvider } from "../services/desktopApi";
import type { DesktopAPI } from "../../shared/types";
import type { PresentationEmbedEvent, PresentationHostCommand } from "../../shared/presentationProtocol";
import { PresentationEditorFrame, type PresentationEditorController } from "./PresentationEditorFrame";

afterEach(cleanup);

/**
 * Saving a deck the user edited by hand.
 *
 * The embedded editor journals edits in memory and writes a snapshot only on
 * an explicit save inside its own window. The host's export converts the
 * snapshot it holds, so an export that did not first ask the editor to flush
 * wrote the deck as it was opened — and then reported it saved. A title typed
 * into a slide and a note under it were both gone on the next open, while the
 * tab never showed a dot: the only dirty signal the host had was the snapshot
 * write that never happened.
 *
 * These tests pin the two halves of the fix: a save flushes first and refuses
 * to call the deck saved when the flush fails, and an edit is dirty the moment
 * the editor says so, not the moment it is flushed.
 */
function stubApi(overrides: Partial<DesktopAPI> = {}): DesktopAPI {
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
    savePptxEditorSnapshot: vi.fn(async (input: { revision: number }) => ({
      filePath: "/decks/deck.pptx",
      revision: input.revision,
    })),
    exportPptxEditor: vi.fn(async (input: { revision: number }) => ({
      filePath: "/decks/deck.pptx",
      revision: input.revision,
    })),
    closePptxEditor: vi.fn(async () => undefined),
    ...overrides,
  } as unknown as DesktopAPI;
}

interface Harness {
  api: DesktopAPI;
  controller: PresentationEditorController;
  onDirtyChange: ReturnType<typeof vi.fn>;
  /** Every command the host posted into the iframe, oldest first. */
  commands(): PresentationHostCommand[];
  /** The embed says something to the host. */
  embedSays(event: PresentationEmbedEvent): Promise<void>;
}

async function mountEditor(overrides: Partial<DesktopAPI> = {}): Promise<Harness> {
  const api = stubApi(overrides);
  const onDirtyChange = vi.fn();
  let controller: PresentationEditorController | null = null;
  render(
    <DesktopApiProvider api={api}>
      <PresentationEditorFrame
        previewToken="token"
        fileName="deck.pptx"
        onUnavailable={vi.fn()}
        onDirtyChange={onDirtyChange}
        onController={(next) => {
          controller = next;
        }}
      />
    </DesktopApiProvider>,
  );
  // The manifest check settles and the iframe mounts.
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
  const frame = document.querySelector<HTMLIFrameElement>("iframe.pptx-embed-frame");
  if (!frame?.contentWindow) throw new Error("the editor frame did not mount");
  const postMessage = vi.spyOn(frame.contentWindow, "postMessage");
  const embedSays = async (event: PresentationEmbedEvent) => {
    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", { data: event, source: frame.contentWindow }));
      await vi.advanceTimersByTimeAsync(0);
    });
  };
  await embedSays({ type: "presentation:embed-ready", protocolVersion: 1 });
  if (!controller) throw new Error("the editor never handed out its controller");
  return {
    api,
    controller,
    onDirtyChange,
    commands: () => postMessage.mock.calls.map((call) => call[0] as PresentationHostCommand),
    embedSays,
  };
}

const lastCommand = (harness: Harness) => harness.commands().at(-1);

describe("saving a hand-edited deck", () => {
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

  it("asks the editor to flush before exporting, and exports what the flush produced", async () => {
    const harness = await mountEditor();
    const exportPptxEditor = harness.api.exportPptxEditor as ReturnType<typeof vi.fn>;

    let saved: { filePath: string; revision: number } | undefined;
    const saving = harness.controller.save().then((result) => {
      saved = result;
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    const flush = lastCommand(harness);
    expect(flush?.type).toBe("presentation:flush");
    // Nothing is exported on the strength of asking alone.
    expect(exportPptxEditor).not.toHaveBeenCalled();
    if (flush?.type !== "presentation:flush") throw new Error("no flush was requested");

    // The editor flushes: its snapshot reaches the host, then the flush is confirmed.
    await harness.embedSays({
      type: "presentation:save-snapshot",
      requestId: "embed-1",
      sessionId: "session-1",
      content: new Uint8Array([9, 9]).buffer,
      baseRevision: 0,
      revision: 2,
    });
    expect(exportPptxEditor).not.toHaveBeenCalled();
    await harness.embedSays({ type: "presentation:flush-result", requestId: flush.requestId, ok: true, revision: 2 });
    await saving;

    expect(exportPptxEditor).toHaveBeenCalledOnce();
    expect(exportPptxEditor.mock.calls[0]?.[0]).toMatchObject({ sessionId: "session-1", revision: 2 });
    expect(saved).toEqual({ filePath: "/decks/deck.pptx", revision: 2 });
    // Dirty while the snapshot waited for its export; clean once it was written.
    expect(harness.onDirtyChange.mock.calls.map((call) => call[0])).toEqual([true, false]);
  });

  it("keeps the deck dirty and rejects the save when the flush fails", async () => {
    const harness = await mountEditor();
    const exportPptxEditor = harness.api.exportPptxEditor as ReturnType<typeof vi.fn>;
    await harness.embedSays({ type: "presentation:dirty-changed", dirty: true });
    expect(harness.onDirtyChange).toHaveBeenLastCalledWith(true);

    const saving = harness.controller.save();
    const rejected = saving.then(
      () => "resolved",
      (error: Error) => error.message,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    const flush = lastCommand(harness);
    if (flush?.type !== "presentation:flush") throw new Error("no flush was requested");

    await harness.embedSays({
      type: "presentation:flush-result",
      requestId: flush.requestId,
      ok: false,
      error: "the snapshot worker died",
    });

    expect(await rejected).toMatch(/snapshot worker died/);
    expect(exportPptxEditor).not.toHaveBeenCalled();
    expect(harness.onDirtyChange).not.toHaveBeenCalledWith(false);
  });

  it("gives up on a flush the editor never answers, without touching the flag", async () => {
    const harness = await mountEditor();
    await harness.embedSays({ type: "presentation:dirty-changed", dirty: true });

    const rejected = harness.controller.save().then(
      () => "resolved",
      (error: Error) => error.message,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(31_000);
    });

    expect(await rejected).toMatch(/did not confirm/);
    expect(harness.api.exportPptxEditor).not.toHaveBeenCalled();
    expect(harness.onDirtyChange).not.toHaveBeenCalledWith(false);
  });

  it("is dirty as soon as the editor holds an edit, and stays dirty until exported", async () => {
    const harness = await mountEditor();
    expect(harness.onDirtyChange).not.toHaveBeenCalled();

    // Typing into a slide: no flush has happened, the editor just says so.
    await harness.embedSays({ type: "presentation:dirty-changed", dirty: true });
    expect(harness.onDirtyChange.mock.calls.map((call) => call[0])).toEqual([true]);

    // The editor flushes on its own (⌘S inside the frame): its journal is
    // empty now, but the file on disk is still behind the snapshot.
    await harness.embedSays({
      type: "presentation:save-snapshot",
      requestId: "embed-2",
      sessionId: "session-1",
      content: new Uint8Array([7]).buffer,
      baseRevision: 0,
      revision: 1,
    });
    await harness.embedSays({ type: "presentation:dirty-changed", dirty: false });
    expect(harness.onDirtyChange.mock.calls.map((call) => call[0])).toEqual([true]);
  });
});
