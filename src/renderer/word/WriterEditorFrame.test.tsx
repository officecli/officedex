import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WRITER_EMBED_PROTOCOL_VERSION, type WriterHostCommand } from "../../shared/writerProtocol";

vi.mock("../bridge", () => ({
  officecli: {
    readArtifactFile: vi.fn(async () => ({ data: new Uint8Array([80, 75, 3, 4]), sha256: "abc" })),
    openPath: vi.fn(async () => undefined),
  },
}));

import { WriterEditorFrame, type WriterAgentEditor } from "./WriterEditorFrame";
import { executeActiveEditorClientTool } from "../activeEditorClientTools";

function mockManifest() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, json: async () => ({ protocolVersion: WRITER_EMBED_PROTOCOL_VERSION }) }) as Response),
  );
}

/**
 * Stands in for the embed: records what the host posts into the frame, and
 * answers as the embed would.
 */
function captureFrame(container: HTMLElement) {
  const frame = container.querySelector<HTMLIFrameElement>("iframe.writer-embed-frame")!;
  const posted: WriterHostCommand[] = [];
  Object.defineProperty(frame, "contentWindow", {
    configurable: true,
    value: { postMessage: (message: WriterHostCommand) => posted.push(message) },
  });
  const fromEmbed = (data: unknown) =>
    window.dispatchEvent(new MessageEvent("message", { source: frame.contentWindow, data }));
  return { frame, posted, fromEmbed };
}

afterEach(() => {
  vi.useRealTimers();
  cleanup();
  vi.unstubAllGlobals();
});

describe("WriterEditorFrame agent tools", () => {
  it("exposes captured editing only after load and rejects pending edits on close", async () => {
    mockManifest();
    let editor: WriterAgentEditor | null = null;
    const { container, unmount } = render(<WriterEditorFrame previewToken="token" fileName="report.docx" onUnavailable={vi.fn()} onAgentReady={(value) => { editor = value; }} />);
    await waitFor(() => expect(container.querySelector("iframe")).not.toBeNull());
    const { posted, fromEmbed } = captureFrame(container);
    expect(editor).toBeNull();
    fromEmbed({ type: "writer:document-loaded", fileName: "report.docx" });
    const handle = editor as unknown as WriterAgentEditor;
    const pending = handle.capture("selection");
    const request = posted.at(-1)!;
    expect(request.type).toBe("writer:capture-edit");
    fromEmbed({ type: "writer:response", requestId: (request as { requestId: string }).requestId, ok: true, result: { id: "capture", text: "Hello", scope: "selection" } });
    await expect(pending).resolves.toMatchObject({ id: "capture", text: "Hello" });
    const applying = handle.apply("capture", [{ query: "Hello", replacement: "Hi" }]);
    const rejected = expect(applying).rejects.toThrow("closed");
    unmount();
    await rejected;
    expect(editor).toBeNull();
  });
  async function mount() {
    mockManifest();
    const { container } = render(
      <WriterEditorFrame previewToken="token" fileName="report.docx" onUnavailable={vi.fn()} />,
    );
    await waitFor(() => {
      expect(container.querySelector("iframe.writer-embed-frame")).not.toBeNull();
    });
    const captured = captureFrame(container);
    captured.fromEmbed({ type: "writer:embed-ready", protocolVersion: WRITER_EMBED_PROTOCOL_VERSION });
    // The tools register only after the host has read the artifact and loaded it.
    await waitFor(() => {
      expect(captured.posted.some((message) => message.type === "writer:load")).toBe(true);
    });
    return captured;
  }

  it("answers docx.editor.read_selection from a round trip to the embed", async () => {
    const { posted, fromEmbed } = await mount();

    const pending = executeActiveEditorClientTool("docx-editor", "docx.editor.read_selection", {});
    const request = await waitFor(() => {
      const found = posted.find((message) => message.type === "writer:read-selection");
      expect(found).toBeDefined();
      return found as Extract<WriterHostCommand, { type: "writer:read-selection" }>;
    });

    fromEmbed({
      type: "writer:response",
      requestId: request.requestId,
      ok: true,
      result: { empty: false, collapsed: false, paragraphs: 2 },
    });

    await expect(pending).resolves.toEqual({ empty: false, collapsed: false, paragraphs: 2 });
  });

  it("reports a missing paragraph count as null rather than dropping the field", async () => {
    const { posted, fromEmbed } = await mount();

    const pending = executeActiveEditorClientTool("docx-editor", "docx.editor.read_selection", {});
    const request = await waitFor(() => {
      const found = posted.find((message) => message.type === "writer:read-selection");
      expect(found).toBeDefined();
      return found as Extract<WriterHostCommand, { type: "writer:read-selection" }>;
    });

    fromEmbed({ type: "writer:response", requestId: request.requestId, ok: true, result: { empty: true, collapsed: true } });

    await expect(pending).resolves.toEqual({ empty: true, collapsed: true, paragraphs: null });
  });

  it("passes docx.editor.replace_text through with its scope and reports the count", async () => {
    const { posted, fromEmbed } = await mount();

    const pending = executeActiveEditorClientTool("docx-editor", "docx.editor.replace_text", {
      query: "损耗",
      replacement: "成本",
      scope: "selection",
    });
    const request = await waitFor(() => {
      const found = posted.find((message) => message.type === "writer:replace-text");
      expect(found).toBeDefined();
      return found as Extract<WriterHostCommand, { type: "writer:replace-text" }>;
    });

    expect(request.query).toBe("损耗");
    expect(request.replacement).toBe("成本");
    expect(request.scope).toBe("selection");

    fromEmbed({ type: "writer:response", requestId: request.requestId, ok: true, result: { replaced: 4 } });

    await expect(pending).resolves.toEqual({ replaced: 4, scope: "selection" });
  });

  it("refuses a replacement with no query instead of clearing the document", async () => {
    await mount();

    await expect(
      executeActiveEditorClientTool("docx-editor", "docx.editor.replace_text", { replacement: "x" }),
    ).rejects.toThrow(/non-empty query/);
  });

  it("surfaces an embed-side rejection to the agent", async () => {
    const { posted, fromEmbed } = await mount();

    const pending = executeActiveEditorClientTool("docx-editor", "docx.editor.replace_text", { query: "a", replacement: "b" });
    const request = await waitFor(() => {
      const found = posted.find((message) => message.type === "writer:replace-text");
      expect(found).toBeDefined();
      return found as Extract<WriterHostCommand, { type: "writer:replace-text" }>;
    });

    fromEmbed({ type: "writer:response", requestId: request.requestId, ok: false, error: "Writer 尚未装载文档。" });

    await expect(pending).rejects.toThrow("Writer 尚未装载文档。");
  });

  it("autosaves a manual edit after the shared idle window", async () => {
    mockManifest();
    const { container } = render(
      <WriterEditorFrame previewToken="token" fileName="report.docx" onUnavailable={vi.fn()} autosaveIdleMs={40} />,
    );
    await waitFor(() => {
      expect(container.querySelector("iframe.writer-embed-frame")).not.toBeNull();
    });
    const { posted, fromEmbed } = captureFrame(container);
    fromEmbed({ type: "writer:embed-ready", protocolVersion: WRITER_EMBED_PROTOCOL_VERSION });
    await waitFor(() => {
      expect(posted.some((message) => message.type === "writer:load")).toBe(true);
    });
    fromEmbed({ type: "writer:document-loaded", fileName: "report.docx" });

    vi.useFakeTimers();
    fromEmbed({ type: "writer:dirty-changed", dirty: true });
    expect(posted.some((message) => message.type === "writer:save-request")).toBe(false);
    await act(async () => { await vi.advanceTimersByTimeAsync(40); });
    expect(posted.filter((message) => message.type === "writer:save-request")).toHaveLength(1);
  });

  it("coalesces a burst of Writer edits into one idle autosave", async () => {
    mockManifest();
    const { container } = render(
      <WriterEditorFrame previewToken="token" fileName="report.docx" onUnavailable={vi.fn()} autosaveIdleMs={40} />,
    );
    await waitFor(() => {
      expect(container.querySelector("iframe.writer-embed-frame")).not.toBeNull();
    });
    const { posted, fromEmbed } = captureFrame(container);
    fromEmbed({ type: "writer:embed-ready", protocolVersion: WRITER_EMBED_PROTOCOL_VERSION });
    await waitFor(() => {
      expect(posted.some((message) => message.type === "writer:load")).toBe(true);
    });
    fromEmbed({ type: "writer:document-loaded", fileName: "report.docx" });

    vi.useFakeTimers();
    for (let index = 0; index < 4; index += 1) {
      fromEmbed({ type: "writer:dirty-changed", dirty: true });
    }
    await act(async () => { await vi.advanceTimersByTimeAsync(40); });
    expect(posted.filter((message) => message.type === "writer:save-request")).toHaveLength(1);
  });
});
