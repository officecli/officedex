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

async function bootWorkbench(filePath = "/tmp/deck.pptx", extraProps: { onDirtyChange?: (dirty: boolean) => void } = {}) {
  render(<PptxViewer previewToken="preview-token" fileName="deck.pptx" documentType="pptx" filePath={filePath} editorBaseUrl={EDITOR_URL} {...extraProps} />);
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
  planPptxJS.mockReset();
  savePptx.mockReset();
  savePptx.mockResolvedValue("/tmp/deck.pptx");
});

afterEach(() => {
  cleanup();
});

describe("PptxViewer", () => {
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

  it("registers the active PPTX editor save surface for Agent calls", async () => {
    const { editor } = await bootWorkbench();
    const save = executeActiveEditorClientTool("pptx-editor", "pptx.editor.save", {});
    const exportMessage = await editor.waitForHostMessage("officedex:pptx-export");
    act(() => editor.reply({ type: "officedex:pptx-export-result", requestId: exportMessage.requestId, buffer: new Uint8Array([0x50, 0x4b, 3, 4]).buffer, fileName: "deck.pptx", revision: 2 }));
    await expect(save).resolves.toMatchObject({ saved: true, file_path: "/tmp/deck.pptx" });
  });

  it("falls back to the read-only PPTist preview without an AI entry point when no editor URL is configured", () => {
    render(<PptxViewer previewToken="preview-token" fileName="deck.pptx" documentType="pptx" editorBaseUrl={null} />);

    expect(document.querySelector(".pptx-embed-frame")?.getAttribute("src")).toContain("mode=embed");
    expect(document.querySelector(".pptx-workbench")).toBeNull();
    expect(document.querySelector(".pptx-workbench-panel")).toBeNull();
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
    await waitFor(() => expect(document.querySelector(".pptx-embed-frame")).toBeTruthy());
    expect(document.querySelector(".pptx-workbench")).toBeNull();
  });
});
