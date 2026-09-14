import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import PptxViewer from "./PptxViewer";
import { PRESENTATION_PPTX_PROTOCOL, isPresentationPptxEditorContext } from "../../../shared/presentationPptxProtocol";
import type { PlanPptxJSResult } from "../../../shared/types";
import { executeActiveEditorClientTool } from "../../activeEditorClientTools";

const planPptxJS = vi.fn<(input: { prompt: string; context: unknown; history?: unknown[] }) => Promise<PlanPptxJSResult>>();
const savePptx = vi.fn<(data: Uint8Array, fileName: string, options?: { targetFilePath?: string }) => Promise<string>>();

vi.mock("../../bridge", () => ({
  officecli: {
    readArtifactFile: vi.fn(async () => ({ data: new Uint8Array([0x50, 0x4b, 3, 4]) })),
    openPath: vi.fn(async () => undefined),
    planPptxJS: (input: { prompt: string; context: unknown; history?: unknown[] }) => planPptxJS(input),
    savePptx: (data: Uint8Array, fileName: string, options?: { targetFilePath?: string }) => savePptx(data, fileName, options),
  },
}));

const EDITOR_URL = "http://127.0.0.1:4178/";

interface HostMessage {
  protocol: string;
  channel: string;
  type: string;
  requestId: string;
  buffer?: ArrayBuffer;
  fileName?: string;
  source?: string;
}

/**
 * Simulates the presentation compatibility iframe: captures host postMessage calls and
 * lets the test answer them as the editor would.
 */
function installFakeEditorFrame() {
  const received: HostMessage[] = [];
  const frame = document.querySelector<HTMLIFrameElement>(".pptx-workbench-frame");
  if (!frame) throw new Error("workbench iframe not rendered");
  const url = new URL(frame.getAttribute("src") ?? "");
  const channel = url.searchParams.get("channel") ?? "";
  const fakeWindow = {
    postMessage: (message: HostMessage) => {
      received.push(message);
    },
  } as unknown as Window;
  Object.defineProperty(frame, "contentWindow", { value: fakeWindow, configurable: true });
  const reply = (payload: Record<string, unknown>) => {
    const event = new MessageEvent("message", {
      data: { ...payload, protocol: PRESENTATION_PPTX_PROTOCOL, channel },
      source: fakeWindow as unknown as MessageEventSource,
    });
    window.dispatchEvent(event);
  };
  const waitForHostMessage = (type: string) =>
    waitFor(() => {
      const message = received.find((item) => item.type === type);
      expect(message, `host message ${type}`).toBeTruthy();
      return message as HostMessage;
    });
  return { url, channel, received, reply, waitForHostMessage, fakeWindow };
}

const CONTEXT = {
  slides: [
    {
      id: "slide-1",
      index: 0,
      shapes: [{ id: "title", name: "Title 1", type: "Placeholder", left: 1, top: 2, width: 3, height: 4, text: "Old title" }],
    },
  ],
  selectedSlideIds: ["slide-1"],
  selectedShapes: [{ id: "title", name: "Title 1", type: "Placeholder" }],
};

/**
 * Answers the inspect the workbench runs after a script to find out which slide
 * the edit landed on. Returns the message, so a caller can assert on it.
 */
async function answerFocusInspect(
  editor: { received: HostMessage[]; reply: (payload: Record<string, unknown>) => void },
  ordinal: number,
  context: unknown = CONTEXT,
) {
  const inspect = await waitFor(() => {
    const list = editor.received.filter((item) => item.type === "officedex:pptx-inspect");
    expect(list.length).toBe(ordinal);
    return list[ordinal - 1];
  });
  act(() => editor.reply({ type: "officedex:pptx-inspect-result", requestId: inspect.requestId, context }));
  return inspect;
}

async function bootWorkbench(
  filePath = "/tmp/deck.pptx",
  // The real idle window is 1.5s. Tests shorten it rather than disable it, so
  // the debounce is still on the path they exercise.
  extraProps: { onDirtyChange?: (dirty: boolean) => void; autosaveIdleMs?: number; onReplayDemo?: () => void } = {},
) {
  render(<PptxViewer previewToken="preview-token" fileName="deck.pptx" documentType="pptx" filePath={filePath} editorBaseUrl={EDITOR_URL} autosaveIdleMs={5} {...extraProps} />);
  const frame = await waitFor(() => {
    const node = document.querySelector<HTMLIFrameElement>(".pptx-workbench-frame");
    expect(node).toBeTruthy();
    return node as HTMLIFrameElement;
  });

  const editor = installFakeEditorFrame();
  expect(editor.url.origin).toBe("http://127.0.0.1:4178");
  expect(editor.url.searchParams.get("officedexEmbed")).toBe("1");
  expect(editor.url.searchParams.get("sessionMode")).toBe("browser-local");
  expect(editor.channel).toMatch(/^[0-9a-f]{32}$/);
  // Editor shell boots → host sends the bytes → editor imports and mounts.
  act(() => editor.reply({ type: "officedex:pptx-ready" }));
  const load = await editor.waitForHostMessage("officedex:pptx-load");
  expect(load.fileName).toBe("deck.pptx");
  expect(load.buffer).toBeInstanceOf(ArrayBuffer);
  act(() => editor.reply({ type: "officedex:pptx-loaded", requestId: load.requestId, fileId: "mop-1", fileName: "deck.pptx" }));
  act(() => editor.reply({ type: "officedex:pptx-editor-ready", fileId: "mop-1" }));
  // Initial selection inspect (advisory).
  const firstInspect = await editor.waitForHostMessage("officedex:pptx-inspect");
  act(() => editor.reply({ type: "officedex:pptx-inspect-result", requestId: firstInspect.requestId, context: CONTEXT }));
  await waitFor(() => expect(document.querySelector(".pptx-workbench")?.getAttribute("data-editor-status")).toBe("ready"));
  return { frame, editor };
}

beforeEach(() => {
  localStorage.clear();
  planPptxJS.mockReset();
  savePptx.mockReset();
  savePptx.mockResolvedValue("/tmp/deck.pptx");
});

afterEach(() => {
  cleanup();
});

describe("PptxViewer", () => {
  it("fills and focuses the composer from a suggestion without starting generation", async () => {
    await bootWorkbench();
    fireEvent.click(screen.getByRole("button", { name: "Simplify text" }));
    const input = screen.getByRole("textbox") as HTMLTextAreaElement;
    expect(input.value).toBe("Simplify the text on the selected slide while preserving its key information.");
    expect(document.activeElement).toBe(input);
    expect(planPptxJS).not.toHaveBeenCalled();
    expect(document.querySelector(".wb-panel__target")).toBeNull();
  });

  it("autosaves a manual editor change reported through the embed protocol", async () => {
    const dirtyChanges: boolean[] = [];
    const { editor } = await bootWorkbench("/tmp/deck.pptx", {
      onDirtyChange: (dirty) => dirtyChanges.push(dirty),
    });
    act(() => editor.reply({ type: "officedex:pptx-dirty-changed", fileId: "mop-1", dirty: true, revision: 1 }));
    const exportMessage = await editor.waitForHostMessage("officedex:pptx-export");
    act(() => editor.reply({ type: "officedex:pptx-export-result", requestId: exportMessage.requestId, buffer: new Uint8Array([0x50, 0x4b, 3, 4]).buffer, fileName: "deck.pptx", revision: 1 }));
    await waitFor(() => expect(savePptx).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(dirtyChanges).toContain(false));
  });

  // Every save exports the deck through mop-convert and rewrites the whole
  // file. Saving on each dirty transition meant a burst of edits queued one
  // conversion per change; only the last of them is worth running.
  it("coalesces a burst of edits into one save", async () => {
    const { editor } = await bootWorkbench("/tmp/deck.pptx", { autosaveIdleMs: 40 });
    for (let index = 0; index < 4; index += 1) {
      act(() => editor.reply({ type: "officedex:pptx-dirty-changed", fileId: "mop-1", dirty: true, revision: index + 1 }));
    }
    const exportMessage = await editor.waitForHostMessage("officedex:pptx-export");
    act(() => editor.reply({ type: "officedex:pptx-export-result", requestId: exportMessage.requestId, buffer: new Uint8Array([0x50, 0x4b, 3, 4]).buffer, fileName: "deck.pptx", revision: 4 }));
    await waitFor(() => expect(savePptx).toHaveBeenCalledTimes(1));
    // Give the idle window another chance to fire a second time.
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(savePptx).toHaveBeenCalledTimes(1);
    expect(editor.received.filter((item) => item.type === "officedex:pptx-export").length).toBe(1);
  });

  // The host refuses to overwrite a deck that changed on disk. That refusal used
  // to be invisible: the document stayed dirty, autosave retried on the next
  // keystroke, and the user learned about it from the close prompt.
  it("surfaces a save conflict and stops retrying until it is resolved", async () => {
    savePptx.mockRejectedValueOnce(new Error("save pptx: source file changed outside OfficeDex; reopen it before saving"));
    const { editor } = await bootWorkbench("/tmp/deck.pptx", { autosaveIdleMs: 5 });

    act(() => editor.reply({ type: "officedex:pptx-dirty-changed", fileId: "mop-1", dirty: true, revision: 1 }));
    const first = await editor.waitForHostMessage("officedex:pptx-export");
    act(() => editor.reply({ type: "officedex:pptx-export-result", requestId: first.requestId, buffer: new Uint8Array([0x50, 0x4b, 3, 4]).buffer, fileName: "deck.pptx", revision: 1 }));

    const bar = await waitFor(() => {
      const node = document.querySelector(".pptx-workbench-save-failure");
      expect(node).toBeTruthy();
      return node as HTMLElement;
    });
    expect(bar.className).toContain("is-conflict");
    expect(bar.textContent).toContain("changed outside OfficeDex");

    // Further edits must not queue another doomed conversion.
    act(() => editor.reply({ type: "officedex:pptx-dirty-changed", fileId: "mop-1", dirty: true, revision: 2 }));
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(editor.received.filter((item) => item.type === "officedex:pptx-export").length).toBe(1);

    // The way out keeps the edits: a copy, which never touches the changed file.
    fireEvent.click(screen.getByRole("button", { name: "Save a copy" }));
    const copyExport = await waitFor(() => {
      const list = editor.received.filter((item) => item.type === "officedex:pptx-export");
      expect(list.length).toBe(2);
      return list[1];
    });
    act(() => editor.reply({ type: "officedex:pptx-export-result", requestId: copyExport.requestId, buffer: new Uint8Array([0x50, 0x4b, 3, 4]).buffer, fileName: "deck.pptx", revision: 2 }));
    await waitFor(() => expect(savePptx).toHaveBeenCalledTimes(2));
    // A copy goes to Downloads: no target path, so the changed original stands.
    expect(savePptx.mock.calls[1][2]).toEqual({});
    await waitFor(() => expect(document.querySelector(".pptx-workbench-save-failure")).toBeNull());
  });

  it("registers the active PPTX editor save surface for Agent calls", async () => {
    const { editor } = await bootWorkbench();
    const save = executeActiveEditorClientTool("pptx-editor", "pptx.editor.save", {});
    const exportMessage = await editor.waitForHostMessage("officedex:pptx-export");
    act(() => editor.reply({ type: "officedex:pptx-export-result", requestId: exportMessage.requestId, buffer: new Uint8Array([0x50, 0x4b, 3, 4]).buffer, fileName: "deck.pptx", revision: 2 }));
    await expect(save).resolves.toMatchObject({ saved: true, file_path: "/tmp/deck.pptx" });
  });

  it("offers the debug replay only when the host can replay this deck, and hands the click back", async () => {
    const onReplayDemo = vi.fn();
    await bootWorkbench("/tmp/deck.pptx", { onReplayDemo });
    fireEvent.click(screen.getByRole("button", { name: "Replay drawing" }));
    expect(onReplayDemo).toHaveBeenCalledTimes(1);

    // Nothing to replay — no button at all, rather than one that does nothing.
    cleanup();
    await bootWorkbench("/tmp/deck.pptx");
    expect(screen.queryByRole("button", { name: "Replay drawing" })).toBeNull();
  });

  it("falls back to the read-only Presentation preview without an AI entry point when no editor URL is configured", async () => {
    render(<PptxViewer previewToken="preview-token" fileName="deck.pptx" documentType="pptx" editorBaseUrl={null} />);

    await waitFor(() => expect(document.querySelector(".pptx-workbench-frame")).toBeTruthy());
    const src = document.querySelector(".pptx-workbench-frame")?.getAttribute("src") ?? "";
    expect(src).toContain("/presentation/");
    expect(new URL(src).searchParams.get("mode")).toBe("preview");
    const legacyEditorPath = ["p", "p", "t", "i", "s", "t"].join("");
    expect(src).not.toContain("/" + legacyEditorPath);
    expect(document.querySelector(".pptx-workbench-readonly")).toBeTruthy();
    expect(document.querySelector(".wb-panel")).toBeNull();
    expect(document.querySelector(".pptx-readonly-notice")?.textContent).toContain("AI editor unavailable");
  });

  it("opens the presentation workbench, plans with editor context, executes in the editor and saves back to the file", async () => {
    const { editor } = await bootWorkbench();

    planPptxJS.mockResolvedValue({
      summary: "Changed the selected title to OfficeDex demo.",
      source: 'return await PowerPoint.run(async (context) => { await context.sync(); return { changed: 1 }; });',
      confidence: "high",
      requires_confirmation: false,
      warnings: [],
    });

    const input = screen.getByRole("textbox") as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "把选中的标题改为 OfficeDex 演示，但字体、颜色和位置不变" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    // Inspect for the actual turn.
    const inspects = await waitFor(() => {
      const list = editor.received.filter((item) => item.type === "officedex:pptx-inspect");
      expect(list.length).toBe(2);
      return list;
    });
    act(() => editor.reply({ type: "officedex:pptx-inspect-result", requestId: inspects[1].requestId, context: CONTEXT }));

    await waitFor(() => expect(planPptxJS).toHaveBeenCalledTimes(1));
    const plannerInput = planPptxJS.mock.calls[0][0];
    expect(plannerInput.prompt).toBe("把选中的标题改为 OfficeDex 演示，但字体、颜色和位置不变");
    expect(isPresentationPptxEditorContext(plannerInput.context)).toBe(true);
    expect((plannerInput.context as typeof CONTEXT).selectedShapes[0].id).toBe("title");

    // High-confidence plan executes without confirmation; the source travels to the editor verbatim.
    const execute = await editor.waitForHostMessage("officedex:pptx-execute-js");
    expect(execute.source).toContain("PowerPoint.run");
    expect(document.querySelector(".pptx-workbench-confirm")).toBeNull();
    act(() => editor.reply({ type: "officedex:pptx-execute-result", requestId: execute.requestId, result: { changed: 1 } }));

    // The deck came back unchanged, so the workbench does not move the view.
    await answerFocusInspect(editor, 3);

    const exportMessage = await editor.waitForHostMessage("officedex:pptx-export");
    const exported = new Uint8Array([0x50, 0x4b, 3, 4, 9, 9]).buffer;
    act(() =>
      editor.reply({
        type: "officedex:pptx-export-result",
        requestId: exportMessage.requestId,
        buffer: exported,
        fileName: "deck.pptx",
        revision: 3,
      }),
    );

    await waitFor(() => expect(savePptx).toHaveBeenCalledTimes(1));
    const [bytes, fileName, options] = savePptx.mock.calls[0];
    expect(Array.from(bytes.slice(0, 2))).toEqual([0x50, 0x4b]);
    expect(fileName).toBe("deck.pptx");
    expect(options?.targetFilePath).toBe("/tmp/deck.pptx");

    await waitFor(() => expect(screen.getByText("Saved to /tmp/deck.pptx")).toBeTruthy());
    expect(screen.getByText("Changed the selected title to OfficeDex demo.")).toBeTruthy();
    // The generated script is only available behind the collapsed debug details.
    const details = document.querySelector<HTMLDetailsElement>(".pptx-workbench-debug");
    expect(details?.open).toBe(false);
    expect(details?.querySelector("pre")?.textContent).toContain("PowerPoint.run");
    cleanup();
    const reopened = await bootWorkbench();
    expect(screen.getByText("Changed the selected title to OfficeDex demo.")).toBeTruthy();
    expect(screen.getByText("把选中的标题改为 OfficeDex 演示，但字体、颜色和位置不变")).toBeTruthy();
    expect(reopened.editor.received.some((item) => item.type === "officedex:pptx-execute-js")).toBe(false);
    expect(planPptxJS).toHaveBeenCalledTimes(1);
    cleanup();
    await bootWorkbench("/other/deck.pptx");
    expect(screen.queryByText("Changed the selected title to OfficeDex demo.")).toBeNull();

  });


  it("follows an edit that landed on a slide the reader was not looking at", async () => {
    const { editor } = await bootWorkbench();

    // Three slides, reader parked on the third; the prompt names the second.
    const shape = (id: string, text: string) => ({ id, name: "Title 1", type: "Placeholder", left: 1, top: 2, width: 3, height: 4, text });
    const deck = (secondTitle: string) => ({
      slides: [
        { id: "slide-1", index: 0, shapes: [shape("t1", "2026 Q3 overview")] },
        { id: "slide-2", index: 1, shapes: [shape("t2", secondTitle)] },
        { id: "slide-3", index: 2, shapes: [shape("t3", "East leads, West to fix")] },
      ],
      selectedSlideIds: ["slide-3"],
      selectedShapes: [],
    });

    planPptxJS.mockResolvedValue({
      summary: "Retitled the second slide.",
      source: "return await PowerPoint.run(async (context) => { await context.sync(); });",
      confidence: "high",
      requires_confirmation: false,
    });

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "把第二页的标题改为“最重要的三组数据”" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await answerFocusInspect(editor, 2, deck("Three things in this report"));

    const execute = await editor.waitForHostMessage("officedex:pptx-execute-js");
    act(() => editor.reply({ type: "officedex:pptx-execute-result", requestId: execute.requestId, result: null }));

    // The post-edit deck differs on slide 2 only, so that is where the view goes.
    await answerFocusInspect(editor, 3, deck("最重要的三组数据"));
    const scripts = await waitFor(() => {
      const list = editor.received.filter((item) => item.type === "officedex:pptx-execute-js");
      expect(list.length).toBe(2);
      return list;
    });
    expect(scripts[1].source).toContain("setSelectedSlides");
    expect(scripts[1].source).toContain('"slide-2"');
    act(() => editor.reply({ type: "officedex:pptx-execute-result", requestId: scripts[1].requestId, result: { selectedSlideId: "slide-2" } }));

    const exportMessage = await editor.waitForHostMessage("officedex:pptx-export");
    act(() =>
      editor.reply({
        type: "officedex:pptx-export-result",
        requestId: exportMessage.requestId,
        buffer: new Uint8Array([0x50, 0x4b, 1, 2]).buffer,
        fileName: "deck.pptx",
      }),
    );
    await waitFor(() => expect(savePptx).toHaveBeenCalledTimes(1));
  });

  it("requires confirmation for flagged plans and does not execute until confirmed; cancel leaves the deck untouched", async () => {
    const { editor } = await bootWorkbench();
    planPptxJS.mockResolvedValue({
      summary: "Delete the second slide.",
      source: "return await PowerPoint.run(async (context) => { context.presentation.slides.getItemAt(1).delete(); await context.sync(); });",
      confidence: "medium",
      requires_confirmation: true,
      confirmation: { title: "Confirm deletion", message: "This removes slide 2.", changes: ["Delete slide 2"], preserved: ["Other slides"] },
      warnings: ["Deleting cannot be undone from this panel."],
    });

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "删除第二页" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    const inspect = await waitFor(() => {
      const list = editor.received.filter((item) => item.type === "officedex:pptx-inspect");
      expect(list.length).toBe(2);
      return list[1];
    });
    act(() => editor.reply({ type: "officedex:pptx-inspect-result", requestId: inspect.requestId, context: CONTEXT }));

    await waitFor(() => expect(document.querySelector(".pptx-workbench-confirm")).toBeTruthy());
    expect(screen.getByText("Confirm deletion")).toBeTruthy();
    expect(screen.getByText("Delete slide 2")).toBeTruthy();
    expect(screen.getByText("Deleting cannot be undone from this panel.")).toBeTruthy();
    expect(editor.received.some((item) => item.type === "officedex:pptx-execute-js")).toBe(false);
    // The composer is blocked while a confirmation is pending.
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "another" } });
    expect((screen.getByRole("button", { name: "Send" }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.getByText("Cancelled — nothing was changed.")).toBeTruthy());
    expect(editor.received.some((item) => item.type === "officedex:pptx-execute-js")).toBe(false);
    expect(savePptx).not.toHaveBeenCalled();
    expect((screen.getByRole("button", { name: "Send" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("confirms and applies a flagged plan, and surfaces save failures without pretending success", async () => {
    const { editor } = await bootWorkbench();
    planPptxJS.mockResolvedValue({
      summary: "Guessing the title shape.",
      source: "return await PowerPoint.run(async (context) => { await context.sync(); });",
      confidence: "low",
      requires_confirmation: true,
      confirmation: { title: "Low confidence", message: "Please review." },
    });
    savePptx.mockRejectedValueOnce(new Error("disk full"));

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "改标题" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    const inspect = await waitFor(() => {
      const list = editor.received.filter((item) => item.type === "officedex:pptx-inspect");
      expect(list.length).toBe(2);
      return list[1];
    });
    act(() => editor.reply({ type: "officedex:pptx-inspect-result", requestId: inspect.requestId, context: CONTEXT }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Apply" })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));

    const execute = await editor.waitForHostMessage("officedex:pptx-execute-js");
    act(() => editor.reply({ type: "officedex:pptx-execute-result", requestId: execute.requestId, result: null }));
    await answerFocusInspect(editor, 3);
    const exportMessage = await editor.waitForHostMessage("officedex:pptx-export");
    act(() =>
      editor.reply({
        type: "officedex:pptx-export-result",
        requestId: exportMessage.requestId,
        buffer: new Uint8Array([0x50, 0x4b, 1, 2]).buffer,
        fileName: "deck.pptx",
      }),
    );
    await waitFor(() => expect(savePptx).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByText(/saving failed: disk full/)).toBeTruthy());
    expect(screen.getByText(/original file was not overwritten/)).toBeTruthy();

    // Retry save re-exports without re-executing the script.
    fireEvent.click(screen.getByRole("button", { name: "Retry save" }));
    const secondExport = await waitFor(() => {
      const list = editor.received.filter((item) => item.type === "officedex:pptx-export");
      expect(list.length).toBe(2);
      return list[1];
    });
    expect(editor.received.filter((item) => item.type === "officedex:pptx-execute-js").length).toBe(1);
    act(() =>
      editor.reply({
        type: "officedex:pptx-export-result",
        requestId: secondExport.requestId,
        buffer: new Uint8Array([0x50, 0x4b, 1, 2]).buffer,
        fileName: "deck.pptx",
      }),
    );
    await waitFor(() => expect(savePptx).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByText("Saved to /tmp/deck.pptx")).toBeTruthy());
  });

  it("ignores editor messages from another channel and reports load errors", async () => {
    render(<PptxViewer previewToken="preview-token" fileName="deck.pptx" documentType="pptx" filePath="/tmp/deck.pptx" editorBaseUrl={EDITOR_URL} />);
    await waitFor(() => expect(document.querySelector(".pptx-workbench-frame")).toBeTruthy());
    const editor = installFakeEditorFrame();

    // Wrong channel: not accepted as ready.
    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: { protocol: PRESENTATION_PPTX_PROTOCOL, channel: "other", type: "officedex:pptx-ready" },
          source: editor.fakeWindow as unknown as MessageEventSource,
        }),
      );
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(editor.received.some((item) => item.type === "officedex:pptx-load")).toBe(false);

    act(() => editor.reply({ type: "officedex:pptx-ready" }));
    const load = await editor.waitForHostMessage("officedex:pptx-load");
    act(() => editor.reply({ type: "officedex:pptx-load-error", requestId: load.requestId, error: "converter down" }));
    await waitFor(() => expect(document.querySelector(".pptx-workbench")?.getAttribute("data-editor-status")).toBe("error"));
    expect(screen.getByRole("alert").textContent).toContain("converter down");
    // A failed editor start offers the read-only fallback and never the AI composer.
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Show read-only preview" }));
    await waitFor(() => expect(document.querySelector(".pptx-workbench-readonly")).toBeTruthy());
    expect(document.querySelector(".wb-panel")).toBeNull();
    expect(document.querySelector(".pptx-workbench-frame")?.getAttribute("src")).toContain("mode=preview");
  });

  // A conversion gap means the deck is valid and the converter cannot represent
  // part of it yet. The backend has always classified it separately (422
  // PPTX_CONVERSION_GAP); it used to reach the user as the same red "could not
  // open" box as a corrupt file.
  it("tells a conversion gap apart from a file it could not read", async () => {
    render(<PptxViewer previewToken="preview-token" fileName="deck.pptx" documentType="pptx" filePath="/tmp/deck.pptx" editorBaseUrl={EDITOR_URL} />);
    await waitFor(() => expect(document.querySelector(".pptx-workbench-frame")).toBeTruthy());
    const editor = installFakeEditorFrame();

    act(() => editor.reply({ type: "officedex:pptx-ready" }));
    const load = await editor.waitForHostMessage("officedex:pptx-load");
    act(() =>
      editor.reply({
        type: "officedex:pptx-load-error",
        requestId: load.requestId,
        error: "structured gap(s): SmartArt",
        errorCode: "PPTX_CONVERSION_GAP",
      }),
    );

    await waitFor(() => expect(document.querySelector(".pptx-workbench")?.getAttribute("data-editor-status")).toBe("gap"));
    // Reported as a note, not an alert, and it does not offer a reload that
    // would produce the same outcome.
    expect(document.querySelector("[role=\"alert\"]")).toBeNull();
    // The fallback bar is a note too, so scope this to the overlay.
    expect(document.querySelector(".pptx-workbench-overlay")?.textContent).toContain("Some features are not supported yet");
    expect(screen.queryByRole("button", { name: "Reload editor" })).toBeNull();
    // The read-only fallback is still the way out.
    fireEvent.click(screen.getByRole("button", { name: "Show read-only preview" }));
    await waitFor(() => expect(document.querySelector(".pptx-workbench-readonly")).toBeTruthy());
  });

  it("clears the unavailable banner after an editor reload succeeds", async () => {
    render(<PptxViewer previewToken="preview-token" fileName="deck.pptx" documentType="pptx" filePath="/tmp/deck.pptx" editorBaseUrl={EDITOR_URL} />);
    await waitFor(() => expect(document.querySelector(".pptx-workbench-frame")).toBeTruthy());
    const failedEditor = installFakeEditorFrame();

    act(() => failedEditor.reply({ type: "officedex:pptx-ready" }));
    const failedLoad = await failedEditor.waitForHostMessage("officedex:pptx-load");
    act(() => failedEditor.reply({ type: "officedex:pptx-load-error", requestId: failedLoad.requestId, error: "route failed" }));
    await waitFor(() => expect(document.querySelector(".pptx-workbench-fallback-bar")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "Reload editor" }));
    await waitFor(() => expect(document.querySelector(".pptx-workbench")?.getAttribute("data-editor-status")).toBe("fetching"));
    const recoveredEditor = installFakeEditorFrame();
    act(() => recoveredEditor.reply({ type: "officedex:pptx-ready" }));
    const recoveredLoad = await recoveredEditor.waitForHostMessage("officedex:pptx-load");
    act(() => recoveredEditor.reply({ type: "officedex:pptx-loaded", requestId: recoveredLoad.requestId, fileId: "mop-2", fileName: "deck.pptx" }));
    act(() => recoveredEditor.reply({ type: "officedex:pptx-editor-ready", fileId: "mop-2" }));

    await waitFor(() => expect(document.querySelector(".pptx-workbench")?.getAttribute("data-editor-status")).toBe("ready"));
    expect(document.querySelector(".pptx-workbench-fallback-bar")).toBeNull();
  });
});

it("restores an unfinished PPT edit as history without exposing stale execution actions", async () => {
  localStorage.setItem("officedex.agent-history.v1:pptx:/tmp/deck.pptx", JSON.stringify([
    { id: "pending", prompt: "Delete the old slide", stage: "awaiting-confirmation", plan: { summary: "Delete slide 2", source: "dangerous old script" } },
    { id: "failed", prompt: "Save edits", stage: "failed", failedStage: "saving", error: "disk full" },
  ]));
  const { editor } = await bootWorkbench();
  expect(screen.getByText("Delete slide 2")).toBeTruthy();
  expect(screen.getByText(/This edit was interrupted/)).toBeTruthy();
  expect(document.querySelector(".pptx-workbench-confirm")).toBeNull();
  expect(document.querySelector(".pptx-workbench-turn-actions")).toBeNull();
  expect(editor.received.some((item) => item.type === "officedex:pptx-execute-js")).toBe(false);
  expect(planPptxJS).not.toHaveBeenCalled();
});
