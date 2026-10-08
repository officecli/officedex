import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DesktopAPI, DocumentRecord } from "../shared/types";
import type { FileMeta } from "../shared/uiPort";
import type { WriterEditorFrameProps } from "../renderer/word/WriterEditorFrame";
import { publishCanvasLocale } from "../shell/editor/canvasLocale";
import * as docxEditRun from "./docxEditRun";

/**
 * The Word leaf's own work, and nothing above it.
 *
 * `createDesktopCanvas.test.tsx` covers the dispatcher (which type renders,
 * what survives Home, how save is routed) and `canvasSeam.test.tsx` covers the
 * shell wiring. What is left — and what lives only here — is the translation
 * between a `FileMeta` and a running editor: a file id has no path, an embed
 * cannot open anything without a preview token, and a token is issued per
 * artifact.
 *
 * The Writer frame itself is an iframe running a separate build with its own
 * tests, so it is stubbed. The stub is typed as the real component, which makes
 * it the guard on the prop contract: a signature change upstream fails here
 * rather than at runtime.
 */

const frameProps: WriterEditorFrameProps[] = [];

vi.mock("../renderer/word/WriterEditorFrame", () => ({
  WriterEditorFrame: (props: WriterEditorFrameProps) => {
    frameProps.push(props);
    return <div data-testid="writer-frame" data-token={props.previewToken} />;
  },
}));

const { DocxCanvas } = await import("./DocxCanvas");

function record(overrides: Partial<DocumentRecord> = {}): DocumentRecord {
  return {
    id: "document:one",
    filePath: "/tmp/officedex/interviews.docx",
    fileName: "interviews.docx",
    documentType: "docx",
    workspaceId: "",
    createdAt: "2026-09-10T09:00:00Z",
    updatedAt: "2026-09-10T09:00:00Z",
    migrationSource: "user",
    pinned: false,
    ...overrides,
  };
}

function file(id = "document:one"): FileMeta {
  return {
    id, name: "interviews.docx", type: "doc", folderId: "folder:default",
    createdAt: 1, updatedAt: 1, lastOpenedAt: 1, dirty: false, pinned: false,
  };
}

function stubApi(overrides: Partial<DesktopAPI> = {}): DesktopAPI {
  let issued = 0;
  return {
    getDocument: vi.fn(async (id: string) => record({ id })),
    issuePreviewToken: vi.fn(async () => {
      issued += 1;
      return { token: `token-${issued}`, fileName: "interviews.docx", documentType: "docx" };
    }),
    ...overrides,
  } as unknown as DesktopAPI;
}

const noop = () => {};

beforeEach(() => {
  frameProps.length = 0;
});
afterEach(() => {
  cleanup();
  publishCanvasLocale(null);
});

describe("DocxCanvas", () => {
  // FileMeta has no path and the embed authenticates with a per-artifact token,
  // so the document record is the necessary middle step.
  it("turns a file id into a preview token by way of the document record", async () => {
    const api = stubApi();
    render(
      <DocxCanvas api={api} file={file()} onSelectionChange={noop} onResolveSelection={noop} onDirtyChange={noop} onEditor={noop} onEditRunner={noop} onUnavailable={noop} onFileFailure={noop} />,
    );

    await waitFor(() => expect(frameProps).toHaveLength(1));
    expect(api.getDocument).toHaveBeenCalledWith("document:one");
    expect(api.issuePreviewToken).toHaveBeenCalledWith(
      expect.objectContaining({
        filePath: "/tmp/officedex/interviews.docx",
        fileName: "interviews.docx",
        documentType: "docx",
      }),
    );
    expect(frameProps[0].previewToken).toBe("token-1");
    expect(frameProps[0].fileName).toBe("interviews.docx");
  });

  // A run that produced the document is part of what the token grants against.
  it("carries the originating task when the document has one", async () => {
    const api = stubApi({
      getDocument: vi.fn(async () => record({ currentArtifactTaskId: "task-7" })),
    } as unknown as Partial<DesktopAPI>);
    render(
      <DocxCanvas api={api} file={file()} onSelectionChange={noop} onResolveSelection={noop} onDirtyChange={noop} onEditor={noop} onEditRunner={noop} onUnavailable={noop} onFileFailure={noop} />,
    );

    await waitFor(() => expect(frameProps).toHaveLength(1));
    expect(api.issuePreviewToken).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: "task-7" }),
    );
  });

  // A different document is a different editor, not the same one pointed
  // somewhere else — which is what keying the frame on the token buys.
  it("rebuilds the frame for a different file", async () => {
    const api = stubApi();
    const view = render(
      <DocxCanvas api={api} file={file()} onSelectionChange={noop} onResolveSelection={noop} onDirtyChange={noop} onEditor={noop} onEditRunner={noop} onUnavailable={noop} onFileFailure={noop} />,
    );
    await waitFor(() => expect(frameProps).toHaveLength(1));

    view.rerender(
      <DocxCanvas api={api} file={file("document:two")} onSelectionChange={noop} onResolveSelection={noop} onDirtyChange={noop} onEditor={noop} onEditRunner={noop} onUnavailable={noop} onFileFailure={noop} />,
    );

    await waitFor(() => expect(frameProps.at(-1)?.previewToken).toBe("token-2"));
    expect(api.issuePreviewToken).toHaveBeenCalledTimes(2);
  });

  // Re-rendering for any other reason must not re-issue a token: that would
  // rebuild the editor and throw away the scroll position and undo stack.
  it("does not re-issue a token when only the callbacks change", async () => {
    const api = stubApi();
    const target = file();
    const view = render(
      <DocxCanvas api={api} file={target} onSelectionChange={noop} onResolveSelection={noop} onDirtyChange={noop} onEditor={noop} onEditRunner={noop} onUnavailable={noop} onFileFailure={noop} />,
    );
    await waitFor(() => expect(frameProps).toHaveLength(1));

    view.rerender(
      <DocxCanvas api={api} file={target} onSelectionChange={noop} onResolveSelection={noop} onDirtyChange={() => {}} onEditor={() => {}} onEditRunner={() => {}} onUnavailable={() => {}} onFileFailure={noop} />,
    );

    expect(api.issuePreviewToken).toHaveBeenCalledTimes(1);
  });

  it("hands the editor out as soon as Writer reports it", async () => {
    const onEditor = vi.fn();
    const onResolveSelection = vi.fn();
    render(
      <DocxCanvas api={stubApi()} file={file()} onSelectionChange={noop} onResolveSelection={onResolveSelection} onDirtyChange={noop} onEditor={onEditor} onEditRunner={noop} onUnavailable={noop} onFileFailure={noop} />,
    );
    await waitFor(() => expect(frameProps).toHaveLength(1));

    // Asserted by behaviour rather than by function identity: Writer's ready
    // report now feeds two things — the save handle and the way to read a
    // selection — so it can no longer be the caller's callback itself.
    const editor = { capture: vi.fn(), apply: vi.fn(), save: vi.fn(), readSelection: vi.fn() };
    frameProps[0].onAgentReady?.(editor as never);

    // The dispatcher turns this into its save handle.
    expect(onEditor).toHaveBeenCalledWith(editor);
    expect(onResolveSelection).toHaveBeenCalledWith(expect.any(Function));
  });

  // The words come from `readSelection`, a read that tracks nothing, so the
  // edit scope a pending agent `apply` holds from `capture` is never touched —
  // not by the chip, and not by the quote fetched at Send.
  it("reads the selected text through readSelection, never through capture", async () => {
    const capture = vi.fn();
    const readSelection = vi.fn(async () => ({ empty: false, collapsed: false, paragraphs: 3, text: "the selected words" }));
    const onSelectionChange = vi.fn();
    let resolve: (() => Promise<unknown>) | null = null;
    render(
      <DocxCanvas
        api={stubApi()}
        file={file()}
        onSelectionChange={onSelectionChange}
        onResolveSelection={(next) => {
          resolve = next;
        }}
        onDirtyChange={noop}
        onEditor={noop} onEditRunner={noop}
        onUnavailable={noop}
        onFileFailure={noop}
      />,
    );
    await waitFor(() => expect(frameProps).toHaveLength(1));
    frameProps[0].onAgentReady?.({ capture, apply: vi.fn(), save: vi.fn(), readSelection } as never);

    // A caret is not a selection.
    frameProps[0].onSelectionChange?.({ empty: false, collapsed: true });
    expect(onSelectionChange).toHaveBeenLastCalledWith(null);

    frameProps[0].onSelectionChange?.({ empty: false, collapsed: false, paragraphs: 3 });
    // The label is up at once; the words arrive once the range has settled.
    expect(onSelectionChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ label: "interviews.docx · 3 paragraphs", text: "", block: true }),
    );
    await waitFor(() =>
      expect(onSelectionChange).toHaveBeenLastCalledWith(
        expect.objectContaining({ label: "interviews.docx · 3 paragraphs", text: "the selected words", block: true }),
      ),
    );
    expect(readSelection).toHaveBeenCalledOnce();

    const quoted = await resolve!();
    expect(readSelection).toHaveBeenCalledTimes(2);
    expect(quoted).toEqual(
      expect.objectContaining({ text: "the selected words", label: "interviews.docx · 3 paragraphs" }),
    );
    expect(capture).not.toHaveBeenCalled();
  });

  it("quotes nothing when the read comes back blank", async () => {
    const readSelection = vi.fn(async () => ({ empty: false, collapsed: false, paragraphs: 1, text: "   " }));
    let resolve: (() => Promise<unknown>) | null = null;
    render(
      <DocxCanvas
        api={stubApi()}
        file={file()}
        onSelectionChange={noop}
        onResolveSelection={(next) => {
          resolve = next;
        }}
        onDirtyChange={noop}
        onEditor={noop} onEditRunner={noop}
        onUnavailable={noop}
        onFileFailure={noop}
      />,
    );
    await waitFor(() => expect(frameProps).toHaveLength(1));
    frameProps[0].onAgentReady?.({ capture: vi.fn(), apply: vi.fn(), save: vi.fn(), readSelection } as never);

    expect(await resolve!()).toBeNull();
  });

  // A drag is a burst of pushes. One read, for the range that is still there
  // when it settles; a read that lands after the user moved on is dropped.
  it("reads the words once per settled range and drops a read for a range that is gone", async () => {
    let answer: ((text: string) => void) | null = null;
    const readSelection = vi.fn(
      () => new Promise<{ empty: boolean; collapsed: boolean; paragraphs: number; text: string }>((resolveRead) => {
        answer = (text) => resolveRead({ empty: false, collapsed: false, paragraphs: 1, text });
      }),
    );
    const onSelectionChange = vi.fn();
    render(
      <DocxCanvas
        api={stubApi()}
        file={file()}
        onSelectionChange={onSelectionChange}
        onResolveSelection={noop}
        onDirtyChange={noop}
        onEditor={noop} onEditRunner={noop}
        onUnavailable={noop}
        onFileFailure={noop}
      />,
    );
    await waitFor(() => expect(frameProps).toHaveLength(1));
    frameProps[0].onAgentReady?.({ capture: vi.fn(), apply: vi.fn(), save: vi.fn(), readSelection } as never);

    frameProps[0].onSelectionChange?.({ empty: false, collapsed: false, paragraphs: 1 });
    frameProps[0].onSelectionChange?.({ empty: false, collapsed: false, paragraphs: 2 });
    frameProps[0].onSelectionChange?.({ empty: false, collapsed: false, paragraphs: 3 });
    await waitFor(() => expect(readSelection).toHaveBeenCalledOnce());

    // The user collapsed the range before the read came back.
    frameProps[0].onSelectionChange?.({ empty: false, collapsed: true });
    expect(onSelectionChange).toHaveBeenLastCalledWith(null);
    answer!("stale words");
    await act(async () => {});

    expect(onSelectionChange).toHaveBeenLastCalledWith(null);
    expect(onSelectionChange.mock.calls.some(([selection]) => selection?.text === "stale words")).toBe(false);
  });

  it("hands the toolbar profile to the frame", async () => {
    render(
      <DocxCanvas api={stubApi()} file={file()} toolbarProfile="compact" onSelectionChange={noop} onResolveSelection={noop} onDirtyChange={noop} onEditor={noop} onEditRunner={noop} onUnavailable={noop} onFileFailure={noop} />,
    );
    await waitFor(() => expect(frameProps).toHaveLength(1));
    expect(frameProps[0].toolbarProfile).toBe("compact");
  });

  it("passes the editor's dirty flag straight through", async () => {
    const onDirtyChange = vi.fn();
    render(
      <DocxCanvas api={stubApi()} file={file()} onSelectionChange={noop} onResolveSelection={noop} onDirtyChange={onDirtyChange} onEditor={noop} onEditRunner={noop} onUnavailable={noop} onFileFailure={noop} />,
    );
    await waitFor(() => expect(frameProps).toHaveLength(1));

    expect(frameProps[0].onDirtyChange).toBe(onDirtyChange);
  });

  // A document that cannot be opened has to say why. Nothing renders in the
  // meantime, so without this the user sees the skeleton forever. It is a
  // fact about the file, so it is reported against the file and carries the
  // host's words as detail.
  it("reports a document it could not open", async () => {
    const onFileFailure = vi.fn();
    const api = stubApi({
      issuePreviewToken: vi.fn(async () => {
        throw new Error("the file is gone");
      }),
    } as unknown as Partial<DesktopAPI>);

    render(
      <DocxCanvas api={api} file={file()} onSelectionChange={noop} onResolveSelection={noop} onDirtyChange={noop} onEditor={noop} onEditRunner={noop} onUnavailable={noop} onFileFailure={onFileFailure} />,
    );

    await waitFor(() =>
      expect(onFileFailure).toHaveBeenCalledWith("document:one", expect.objectContaining({ kind: "open", detail: "the file is gone" })),
    );
    expect(frameProps).toHaveLength(0);
  });

  // Writer uses onUnavailable(undefined) only as a missing reason, and already
  // names a missing build itself. Filling one in here toasts "Not built yet"
  // over an editor that is already up.
  it("does not treat a cleared unavailable as a start failure", async () => {
    const onUnavailable = vi.fn();
    render(
      <DocxCanvas api={stubApi()} file={file()} onSelectionChange={noop} onResolveSelection={noop} onDirtyChange={noop} onEditor={noop} onEditRunner={noop} onUnavailable={onUnavailable} onFileFailure={noop} />,
    );
    await waitFor(() => expect(frameProps).toHaveLength(1));

    frameProps[0].onUnavailable("");
    frameProps[0].onUnavailable(undefined);
    frameProps[0].onUnavailable("   ");

    expect(onUnavailable).not.toHaveBeenCalled();
  });

  it("passes on what Writer said when it could not start", async () => {
    const onUnavailable = vi.fn();
    render(
      <DocxCanvas api={stubApi()} file={file()} onSelectionChange={noop} onResolveSelection={noop} onDirtyChange={noop} onEditor={noop} onEditRunner={noop} onUnavailable={onUnavailable} onFileFailure={noop} />,
    );
    await waitFor(() => expect(frameProps).toHaveLength(1));

    frameProps[0].onUnavailable("protocol 2 is not supported");

    expect(onUnavailable).toHaveBeenCalledWith(expect.stringContaining("protocol 2 is not supported"));
  });

  it("tells the planner the shell's language", async () => {
    publishCanvasLocale("zh");
    const spy = vi.spyOn(docxEditRun, "createDocxEditRunner");
    const onEditRunner = vi.fn();
    render(
      <DocxCanvas
        api={stubApi()}
        file={file()}
        onSelectionChange={noop}
        onResolveSelection={noop}
        onDirtyChange={noop}
        onEditor={noop}
        onEditRunner={onEditRunner}
        onUnavailable={noop}
        onFileFailure={noop}
      />,
    );
    await waitFor(() => expect(frameProps).toHaveLength(1));
    frameProps[0].onAgentReady?.({ capture: vi.fn(), apply: vi.fn(), save: vi.fn(), readSelection: vi.fn() } as never);
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ locale: "zh-CN" }));
    spy.mockRestore();
  });
});

/**
 * Where a Writer failure goes.
 *
 * The embed reports every way it can fail through one string. A runtime that
 * is not staged is a gap about the build and goes up as "unavailable"; the
 * converter refusing *this* document is a fact about the file and goes up
 * against it, in words, with the converter's own text kept as detail rather
 * than shown.
 */
describe("DocxCanvas failures", () => {
  it("reports a rejected import against the file, not as a missing editor", async () => {
    const onUnavailable = vi.fn();
    const onFileFailure = vi.fn();
    render(
      <DocxCanvas api={stubApi()} file={file()} onSelectionChange={noop} onResolveSelection={noop} onDirtyChange={noop} onEditor={noop} onEditRunner={noop} onUnavailable={onUnavailable} onFileFailure={onFileFailure} />,
    );
    await waitFor(() => expect(frameProps).toHaveLength(1));

    const raw = 'DOCX import failed with HTTP 400: {"error":"DOCX_CONVERSION_FAILED","detail":"/var/folders/x/T/writer-docx-import-1/input.docx"}';
    frameProps[0].onUnavailable(raw);

    expect(onUnavailable).not.toHaveBeenCalled();
    expect(onFileFailure).toHaveBeenCalledWith("document:one", expect.objectContaining({ kind: "open", reason: "invalid-docx", detail: raw }));
  });

  it("still reports a missing Writer runtime as the editor being unavailable", async () => {
    const onUnavailable = vi.fn();
    const onFileFailure = vi.fn();
    render(
      <DocxCanvas api={stubApi()} file={file()} onSelectionChange={noop} onResolveSelection={noop} onDirtyChange={noop} onEditor={noop} onEditRunner={noop} onUnavailable={onUnavailable} onFileFailure={onFileFailure} />,
    );
    await waitFor(() => expect(frameProps).toHaveLength(1));

    frameProps[0].onUnavailable("Writer component assets are not installed.");

    expect(onFileFailure).not.toHaveBeenCalled();
    expect(onUnavailable).toHaveBeenCalledWith(expect.stringContaining("Writer component assets are not installed."));
  });

  it("records a save Writer ran itself and failed, and clears it when one lands", async () => {
    const onFileFailure = vi.fn();
    render(
      <DocxCanvas api={stubApi()} file={file()} onSelectionChange={noop} onResolveSelection={noop} onDirtyChange={noop} onEditor={noop} onEditRunner={noop} onUnavailable={noop} onFileFailure={onFileFailure} />,
    );
    await waitFor(() => expect(frameProps).toHaveLength(1));

    frameProps[0].onSaveFailed?.("save docx: write: open /Users/qa/readonly.docx: permission denied");
    expect(onFileFailure).toHaveBeenLastCalledWith("document:one", expect.objectContaining({ kind: "save", reason: "permission-denied" }));

    frameProps[0].onSaved?.({ filePath: "/Users/qa/readonly.docx", sha256: "abc", saveAsCopy: false });
    expect(onFileFailure).toHaveBeenLastCalledWith("document:one", null);
  });

  it("reports a token the host refused against the file", async () => {
    const onUnavailable = vi.fn();
    const onFileFailure = vi.fn();
    const api = stubApi({ issuePreviewToken: vi.fn(async () => { throw new Error("preview token refused: outside the workspace"); }) });
    render(
      <DocxCanvas api={api} file={file()} onSelectionChange={noop} onResolveSelection={noop} onDirtyChange={noop} onEditor={noop} onEditRunner={noop} onUnavailable={onUnavailable} onFileFailure={onFileFailure} />,
    );
    await waitFor(() => expect(onFileFailure).toHaveBeenCalled());
    expect(onFileFailure).toHaveBeenCalledWith("document:one", expect.objectContaining({ kind: "open" }));
    expect(onUnavailable).not.toHaveBeenCalled();
  });
});
