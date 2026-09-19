import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DesktopAPI, DocumentRecord } from "../shared/types";
import type { FileMeta } from "../shared/uiPort";
import type { WriterEditorFrameProps } from "../renderer/word/WriterEditorFrame";

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
afterEach(cleanup);

describe("DocxCanvas", () => {
  // FileMeta has no path and the embed authenticates with a per-artifact token,
  // so the document record is the necessary middle step.
  it("turns a file id into a preview token by way of the document record", async () => {
    const api = stubApi();
    render(
      <DocxCanvas api={api} file={file()} onSelectionChange={noop} onResolveSelection={noop} onDirtyChange={noop} onEditor={noop} onUnavailable={noop} />,
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
      <DocxCanvas api={api} file={file()} onSelectionChange={noop} onResolveSelection={noop} onDirtyChange={noop} onEditor={noop} onUnavailable={noop} />,
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
      <DocxCanvas api={api} file={file()} onSelectionChange={noop} onResolveSelection={noop} onDirtyChange={noop} onEditor={noop} onUnavailable={noop} />,
    );
    await waitFor(() => expect(frameProps).toHaveLength(1));

    view.rerender(
      <DocxCanvas api={api} file={file("document:two")} onSelectionChange={noop} onResolveSelection={noop} onDirtyChange={noop} onEditor={noop} onUnavailable={noop} />,
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
      <DocxCanvas api={api} file={target} onSelectionChange={noop} onResolveSelection={noop} onDirtyChange={noop} onEditor={noop} onUnavailable={noop} />,
    );
    await waitFor(() => expect(frameProps).toHaveLength(1));

    view.rerender(
      <DocxCanvas api={api} file={target} onSelectionChange={noop} onResolveSelection={noop} onDirtyChange={() => {}} onEditor={() => {}} onUnavailable={() => {}} />,
    );

    expect(api.issuePreviewToken).toHaveBeenCalledTimes(1);
  });

  it("hands the editor out as soon as Writer reports it", async () => {
    const onEditor = vi.fn();
    const onResolveSelection = vi.fn();
    render(
      <DocxCanvas api={stubApi()} file={file()} onSelectionChange={noop} onResolveSelection={onResolveSelection} onDirtyChange={noop} onEditor={onEditor} onUnavailable={noop} />,
    );
    await waitFor(() => expect(frameProps).toHaveLength(1));

    // Asserted by behaviour rather than by function identity: Writer's ready
    // report now feeds two things — the save handle and the way to read a
    // selection — so it can no longer be the caller's callback itself.
    const editor = { capture: vi.fn(), apply: vi.fn(), save: vi.fn() };
    frameProps[0].onAgentReady?.(editor as never);

    // The dispatcher turns this into its save handle.
    expect(onEditor).toHaveBeenCalledWith(editor);
    expect(onResolveSelection).toHaveBeenCalledWith(expect.any(Function));
  });

  it("reads the selected text only when asked, not on every caret move", async () => {
    const capture = vi.fn(async () => ({ id: "capture-1", text: "the selected words", scope: "selection" as const }));
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
        onEditor={noop}
        onUnavailable={noop}
      />,
    );
    await waitFor(() => expect(frameProps).toHaveLength(1));
    frameProps[0].onAgentReady?.({ capture, apply: vi.fn(), save: vi.fn() } as never);

    // A caret is not a selection.
    frameProps[0].onSelectionChange?.({ empty: false, collapsed: true });
    expect(onSelectionChange).toHaveBeenLastCalledWith(null);

    frameProps[0].onSelectionChange?.({ empty: false, collapsed: false, paragraphs: 3 });
    expect(onSelectionChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ label: "interviews.docx · 3 paragraphs", text: "" }),
    );
    // Reporting the selection must not have touched the editor's edit scope.
    expect(capture).not.toHaveBeenCalled();

    const quoted = await resolve!();
    expect(capture).toHaveBeenCalledWith("selection");
    expect(quoted).toEqual(
      expect.objectContaining({ text: "the selected words", label: "interviews.docx · 3 paragraphs" }),
    );
  });

  it("passes the editor's dirty flag straight through", async () => {
    const onDirtyChange = vi.fn();
    render(
      <DocxCanvas api={stubApi()} file={file()} onSelectionChange={noop} onResolveSelection={noop} onDirtyChange={onDirtyChange} onEditor={noop} onUnavailable={noop} />,
    );
    await waitFor(() => expect(frameProps).toHaveLength(1));

    expect(frameProps[0].onDirtyChange).toBe(onDirtyChange);
  });

  // A document that cannot be opened has to say why. Nothing renders in the
  // meantime, so without this the user sees the skeleton forever.
  it("reports a document it could not open", async () => {
    const onUnavailable = vi.fn();
    const api = stubApi({
      issuePreviewToken: vi.fn(async () => {
        throw new Error("the file is gone");
      }),
    } as unknown as Partial<DesktopAPI>);

    render(
      <DocxCanvas api={api} file={file()} onSelectionChange={noop} onResolveSelection={noop} onDirtyChange={noop} onEditor={noop} onUnavailable={onUnavailable} />,
    );

    await waitFor(() => expect(onUnavailable).toHaveBeenCalledWith("the file is gone"));
    expect(frameProps).toHaveLength(0);
  });

  // The Writer build is an optional asset: a source checkout without
  // `npm run build:writer` has no public/writer at all.
  it("explains a missing Word editor build", async () => {
    const onUnavailable = vi.fn();
    render(
      <DocxCanvas api={stubApi()} file={file()} onSelectionChange={noop} onResolveSelection={noop} onDirtyChange={noop} onEditor={noop} onUnavailable={onUnavailable} />,
    );
    await waitFor(() => expect(frameProps).toHaveLength(1));

    frameProps[0].onUnavailable("");

    expect(onUnavailable).toHaveBeenCalledWith(expect.stringMatching(/not installed/i));
  });

  it("passes on what Writer said when it could not start", async () => {
    const onUnavailable = vi.fn();
    render(
      <DocxCanvas api={stubApi()} file={file()} onSelectionChange={noop} onResolveSelection={noop} onDirtyChange={noop} onEditor={noop} onUnavailable={onUnavailable} />,
    );
    await waitFor(() => expect(frameProps).toHaveLength(1));

    frameProps[0].onUnavailable("protocol 2 is not supported");

    expect(onUnavailable).toHaveBeenCalledWith(expect.stringContaining("protocol 2 is not supported"));
  });
});
