import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WRITER_EMBED_PROTOCOL_VERSION, type WriterHostCommand } from "../../shared/writerProtocol";

vi.mock("../bridge", () => ({
  officecli: {
    readArtifactFile: vi.fn(async () => ({ data: new Uint8Array([80, 75, 3, 4]), sha256: "abc" })),
    openPath: vi.fn(async () => undefined),
  },
}));

import { WriterEditorFrame, discardPendingWriterExport, withWriterToolbarProfile, type WriterAgentEditor } from "./WriterEditorFrame";
import { DesktopApiProvider } from "../services/desktopApi";
import type { DesktopAPI } from "../../shared/types";
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
  it("switches toolbar profiles over the channel without reloading a dirty document", async () => {
    mockManifest();
    const props = { previewToken: "token", fileName: "report.docx", onUnavailable: vi.fn() };
    const view = render(<WriterEditorFrame {...props} toolbarProfile="compact" />);
    await waitFor(() => expect(view.container.querySelector("iframe")).not.toBeNull());
    const { frame, posted, fromEmbed } = captureFrame(view.container);
    const source = frame.src;
    fromEmbed({ type: "writer:embed-ready", protocolVersion: WRITER_EMBED_PROTOCOL_VERSION });
    await waitFor(() => expect(posted.some((entry) => entry.type === "writer:load")).toBe(true));
    fromEmbed({ type: "writer:document-loaded", fileName: "report.docx" });
    fromEmbed({ type: "writer:dirty-changed", dirty: true });
    view.rerender(<WriterEditorFrame {...props} toolbarProfile="full" />);
    expect(posted.at(-1)).toEqual({ type: "writer:toolbar-profile", profile: "full" });
    expect(frame.src).toBe(source);
    expect(posted.filter((entry) => entry.type === "writer:load")).toHaveLength(1);
  });
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
      result: { empty: false, collapsed: false, paragraphs: 2, text: "two paragraphs of it" },
    });

    await expect(pending).resolves.toEqual({ empty: false, collapsed: false, paragraphs: 2, text: "two paragraphs of it" });
  });

  // The words come from the same `writer:read-selection` the tool uses, and
  // not from `capture`: a read tracks nothing, so whatever scope a pending
  // apply is holding stays where it was.
  it("reads the selection with its words through the editor handle", async () => {
    mockManifest();
    let editor: WriterAgentEditor | null = null;
    const { container } = render(
      <WriterEditorFrame previewToken="token" fileName="report.docx" onUnavailable={vi.fn()} onAgentReady={(value) => { editor = value; }} />,
    );
    await waitFor(() => expect(container.querySelector("iframe")).not.toBeNull());
    const { posted, fromEmbed } = captureFrame(container);
    fromEmbed({ type: "writer:document-loaded", fileName: "report.docx" });

    const pending = (editor as unknown as WriterAgentEditor).readSelection();
    const request = posted.at(-1) as Extract<WriterHostCommand, { type: "writer:read-selection" }>;
    expect(request.type).toBe("writer:read-selection");
    expect(posted.some((message) => message.type === "writer:capture-edit")).toBe(false);

    fromEmbed({ type: "writer:response", requestId: request.requestId, ok: true, result: { empty: false, collapsed: false, paragraphs: 1, text: "the words" } });
    await expect(pending).resolves.toEqual({ empty: false, collapsed: false, paragraphs: 1, text: "the words" });
  });

  // An embed built before `text` existed answers with the summary alone.
  it("reads a missing text as no words rather than as a broken reply", async () => {
    mockManifest();
    let editor: WriterAgentEditor | null = null;
    const { container } = render(
      <WriterEditorFrame previewToken="token" fileName="report.docx" onUnavailable={vi.fn()} onAgentReady={(value) => { editor = value; }} />,
    );
    await waitFor(() => expect(container.querySelector("iframe")).not.toBeNull());
    const { posted, fromEmbed } = captureFrame(container);
    fromEmbed({ type: "writer:document-loaded", fileName: "report.docx" });

    const pending = (editor as unknown as WriterAgentEditor).readSelection();
    const request = posted.at(-1) as Extract<WriterHostCommand, { type: "writer:read-selection" }>;
    fromEmbed({ type: "writer:response", requestId: request.requestId, ok: true, result: { empty: false, collapsed: false, paragraphs: 1 } });
    await expect(pending).resolves.toEqual({ empty: false, collapsed: false, paragraphs: 1, text: "" });
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

    await expect(pending).resolves.toEqual({ empty: true, collapsed: true, paragraphs: null, text: "" });
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


/**
 * A save Writer runs on its own — ⌘S inside the frame, the idle autosave —
 * arrives as `writer:save` with no host request waiting for it. When the host
 * cannot write the file, the only party that used to hear about it was a
 * request that did not exist. The host now says so itself.
 */
describe("WriterEditorFrame save failures", () => {
  it("retains subsequent conflict edits as recovery drafts without marking the source saved", async () => {
    mockManifest();
    const onSaved = vi.fn();
    const saveDocx = vi.fn().mockRejectedValueOnce(new Error("changed outside OfficeDex"))
      .mockResolvedValue({ filePath: "/draft.docx", sha256: "draft" });
    const api = { saveDocx } as unknown as DesktopAPI;
    const view = render(<DesktopApiProvider api={api}><WriterEditorFrame previewToken="token" fileName="report.docx" onUnavailable={vi.fn()} onSaved={onSaved} /></DesktopApiProvider>);
    await waitFor(() => expect(view.container.querySelector("iframe")).not.toBeNull());
    const { posted, fromEmbed } = captureFrame(view.container);
    fromEmbed({ type: "writer:save", requestId: "first", content: new ArrayBuffer(4) });
    await waitFor(() => expect(posted.some((entry) => entry.type === "writer:response" && entry.requestId === "first")).toBe(true));
    fromEmbed({ type: "writer:save", requestId: "latest", content: new ArrayBuffer(8) });
    await waitFor(() => expect(saveDocx).toHaveBeenCalledTimes(2));
    expect(saveDocx.mock.calls[1][2]).toMatchObject({ recoveryOnly: true });
    expect(onSaved).not.toHaveBeenCalled();
    expect(posted.at(-1)).toMatchObject({ type: "writer:response", requestId: "latest", ok: false });
  });
  it("tells the host when a save the embed started could not be written", async () => {
    mockManifest();
    const onSaveFailed = vi.fn();
    const onSaved = vi.fn();
    const api = {
      saveDocx: vi.fn(async () => {
        throw new Error("save docx: write: open /Users/qa/readonly.docx: permission denied");
      }),
    } as unknown as DesktopAPI;
    const { container } = render(
      <DesktopApiProvider api={api}>
        <WriterEditorFrame previewToken="token" fileName="readonly.docx" onUnavailable={vi.fn()} onSaved={onSaved} onSaveFailed={onSaveFailed} />
      </DesktopApiProvider>,
    );
    await waitFor(() => expect(container.querySelector("iframe.writer-embed-frame")).not.toBeNull());
    const { fromEmbed } = captureFrame(container);

    // No requestId: this save was not asked for by the host.
    fromEmbed({ type: "writer:save", content: new ArrayBuffer(4) });

    await waitFor(() => expect(onSaveFailed).toHaveBeenCalledWith(expect.stringContaining("permission denied")));
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("tells the host when the embed itself could not export", async () => {
    mockManifest();
    const onSaveFailed = vi.fn();
    const { container } = render(
      <WriterEditorFrame previewToken="token" fileName="report.docx" onUnavailable={vi.fn()} onSaveFailed={onSaveFailed} />,
    );
    await waitFor(() => expect(container.querySelector("iframe.writer-embed-frame")).not.toBeNull());
    const { fromEmbed } = captureFrame(container);

    fromEmbed({ type: "writer:save-failed", requestId: "writer-9", error: "export: document has no body" });

    await waitFor(() => expect(onSaveFailed).toHaveBeenCalledWith("export: document has no body"));
  });
});

/**
 * The toolbar profile travels on the iframe URL, where Writer's embed reads
 * it at boot. `full` is Writer's own default, so asking for it leaves the URL
 * exactly as it was before profiles existed — an older embed sees nothing new.
 */
describe("WriterEditorFrame toolbar profile", () => {
  it("puts toolbarProfile=compact on the frame URL only when asked", async () => {
    mockManifest();
    const compact = render(
      <WriterEditorFrame previewToken="token-a" fileName="report.docx" onUnavailable={vi.fn()} toolbarProfile="compact" />,
    );
    await waitFor(() => expect(compact.container.querySelector("iframe")).not.toBeNull());
    expect(compact.container.querySelector("iframe")!.getAttribute("src")).toMatch(/[?&]toolbarProfile=compact(&|$)/);
    compact.unmount();

    const full = render(
      <WriterEditorFrame previewToken="token-b" fileName="report.docx" onUnavailable={vi.fn()} toolbarProfile="full" />,
    );
    await waitFor(() => expect(full.container.querySelector("iframe")).not.toBeNull());
    expect(full.container.querySelector("iframe")!.getAttribute("src")).not.toContain("toolbarProfile");
    full.unmount();

    const unspecified = render(
      <WriterEditorFrame previewToken="token-c" fileName="report.docx" onUnavailable={vi.fn()} />,
    );
    await waitFor(() => expect(unspecified.container.querySelector("iframe")).not.toBeNull());
    expect(unspecified.container.querySelector("iframe")!.getAttribute("src")).not.toContain("toolbarProfile");
  });

  // A changed URL reloads the document, so the profile is read once, at mount.
  it("keeps the URL it mounted with when the profile prop changes later", async () => {
    mockManifest();
    const view = render(
      <WriterEditorFrame previewToken="token" fileName="report.docx" onUnavailable={vi.fn()} toolbarProfile="full" />,
    );
    await waitFor(() => expect(view.container.querySelector("iframe")).not.toBeNull());
    const before = view.container.querySelector("iframe")!.getAttribute("src");

    view.rerender(
      <WriterEditorFrame previewToken="token" fileName="report.docx" onUnavailable={vi.fn()} toolbarProfile="compact" />,
    );
    await act(async () => {});

    expect(view.container.querySelector("iframe")!.getAttribute("src")).toBe(before);
    expect(before).not.toContain("toolbarProfile");
  });

  it("appends after the locale query and before the hash", () => {
    expect(withWriterToolbarProfile("/writer/index.html?lang=zh-CN", "compact")).toBe("/writer/index.html?lang=zh-CN&toolbarProfile=compact");
    expect(withWriterToolbarProfile("/writer/index.html#top", "compact")).toBe("/writer/index.html?toolbarProfile=compact#top");
    expect(withWriterToolbarProfile("/writer/index.html?lang=zh-CN", "full")).toBe("/writer/index.html?lang=zh-CN");
    expect(withWriterToolbarProfile("/writer/index.html", undefined)).toBe("/writer/index.html");
  });
});


it.each([false, true])("retains failed source bytes across recovery navigation; discard=%s", async (discard) => {
  mockManifest();
  const saved = vi.fn().mockRejectedValueOnce(new Error("permission denied")).mockResolvedValue({filePath: "/qa/source.docx", sha256: "saved"});
  const api = {readArtifactFile: vi.fn(async () => ({data: new Uint8Array([1,2]), sha256: "original"})), saveDocx: saved} as unknown as DesktopAPI;
  const failed = vi.fn(); const dirty = vi.fn();
  const mountSource = async (token: string, sourcePath = "/qa/source.docx") => {
    const view = render(<DesktopApiProvider api={api}><WriterEditorFrame previewToken={token} sourcePath={sourcePath} fileName="source.docx" onUnavailable={vi.fn()} onSaveFailed={failed} onDirtyChange={dirty} /></DesktopApiProvider>);
    await waitFor(() => expect(view.container.querySelector("iframe")).not.toBeNull());
    const channel = captureFrame(view.container);
    channel.fromEmbed({type: "writer:embed-ready", protocolVersion: WRITER_EMBED_PROTOCOL_VERSION});
    await waitFor(() => expect(channel.posted.some(x => x.type === "writer:load")).toBe(true));
    channel.fromEmbed({type: "writer:document-loaded", fileName: "source.docx"});
    return {...view, ...channel};
  };
  const first = await mountSource("first");
  first.fromEmbed({type: "writer:save", requestId: "save-failed", content: new Uint8Array([3,4]).buffer});
  await waitFor(() => expect(failed).toHaveBeenCalledWith("permission denied"));
  first.unmount();
  const copy = await mountSource("copy", "/qa/recovered.docx");
  expect(new Uint8Array((copy.posted.find(x => x.type === "writer:load") as any).content)).toEqual(new Uint8Array([1,2]));
  copy.unmount();
  if (discard) discardPendingWriterExport("/qa/source.docx");
  const again = await mountSource("fresh-source-token");
  if (discard) {
    expect(new Uint8Array((again.posted.find(x => x.type === "writer:load") as any).content)).toEqual(new Uint8Array([1,2]));
    expect(dirty).toHaveBeenLastCalledWith(false);
    return;
  }
  expect(new Uint8Array((again.posted.find(x => x.type === "writer:load") as any).content)).toEqual(new Uint8Array([3,4]));
  expect(dirty).toHaveBeenLastCalledWith(true);
  again.fromEmbed({type: "writer:save", requestId: "retry", content: new Uint8Array([3,4]).buffer});
  await waitFor(() => expect(saved).toHaveBeenCalledTimes(2));
  expect(saved.mock.calls[1][2]).toMatchObject({previewToken: "fresh-source-token", expectedSHA256: "original"});
  await waitFor(() => expect(dirty).toHaveBeenLastCalledWith(false));
});

it.each([true, false, undefined])("exports a copy after a source conflict even when the exporter echoes %s", async (echo) => {
  mockManifest();
  let editor: WriterAgentEditor | null = null;
  const saveDocx = vi.fn().mockRejectedValueOnce(new Error("source file changed outside OfficeDex"))
    .mockResolvedValue({ filePath: "/qa/conflict-copy.docx", sha256: "copy" });
  const api = { readArtifactFile: async () => ({ data: new Uint8Array([1, 2]), sha256: "original" }), saveDocx } as unknown as DesktopAPI;
  const dirty = vi.fn(); const saved = vi.fn(); const failed = vi.fn();
  const view = render(<DesktopApiProvider api={api}><WriterEditorFrame previewToken="conflict-copy-token" sourcePath="/qa/conflict-source.docx" fileName="source.docx"
    onUnavailable={vi.fn()} onDirtyChange={dirty} onSaved={saved} onSaveFailed={failed} onAgentReady={value => { editor = value; }} /></DesktopApiProvider>);
  await waitFor(() => expect(view.container.querySelector("iframe")).not.toBeNull());
  const channel = captureFrame(view.container);
  channel.fromEmbed({ type: "writer:embed-ready", protocolVersion: WRITER_EMBED_PROTOCOL_VERSION });
  await waitFor(() => expect(channel.posted.some(m => m.type === "writer:load")).toBe(true));
  channel.fromEmbed({ type: "writer:document-loaded", fileName: "source.docx" });
  channel.fromEmbed({ type: "writer:save", requestId: "first-fails", content: new Uint8Array([3, 4]).buffer });
  await waitFor(() => expect(failed).toHaveBeenCalled());
  dirty.mockClear();
  const copying = editor!.saveCopy!();
  const request = channel.posted.at(-1)!;
  expect(request.type).toBe("writer:save-request");
  expect((request as { saveAsCopy?: boolean }).saveAsCopy).toBe(true);
  channel.fromEmbed({ type: "writer:save", requestId: (request as { requestId: string }).requestId, saveAsCopy: echo, content: new Uint8Array([3, 4]).buffer });
  await expect(copying).resolves.toEqual({ filePath: "/qa/conflict-copy.docx", sha256: "copy" });
  expect(saveDocx.mock.calls[1][2]).toMatchObject({ saveAsCopy: true, expectedSHA256: "original" });
  expect(saveDocx.mock.calls[1][2].recoveryOnly).toBeUndefined();
  expect(dirty).not.toHaveBeenCalledWith(false);
  expect(saved).toHaveBeenCalledWith({ filePath: "/qa/conflict-copy.docx", sha256: "copy", saveAsCopy: true });
  channel.fromEmbed({ type: "writer:dirty-changed", dirty: false });
  expect(dirty).toHaveBeenLastCalledWith(true);
  discardPendingWriterExport("/qa/conflict-source.docx");
});
