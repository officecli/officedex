import { vi } from "vitest";

import { SEED_ACTIVE_FILE_ID } from "../port/fake/seed";
import type { FileFailure } from "../../shared/fileFailure";
import type { FileMeta } from "../../shared/uiPort";
import type {
  CanvasAdapter,
  CanvasDraft,
  CanvasSelection,
  CanvasZoom,
  DocumentEditRequest,
  DocumentEditResult,
} from "./canvasContract";

/**
 * A stand-in for an embedded editor, with a handle on both directions of the seam.
 *
 * No editor mounts in jsdom, and the behaviour worth asserting is exactly what
 * crosses between the two sides: the shell asks the adapter to mount, show and
 * save, and the adapter reports back that the document is dirty, that something
 * is selected, or that Apply was pressed inside the document. So the fake
 * records the first set of calls and exposes the second as functions a test can
 * call when the user would.
 *
 * Shared by `canvasSeam.test.tsx` and `EditorCanvasHost.test.tsx`, which assert
 * the two halves of the same contract.
 */
export interface TestCanvasAdapter {
  adapter: CanvasAdapter;
  mount: ReturnType<typeof vi.fn>;
  show: ReturnType<typeof vi.fn>;
  hide: ReturnType<typeof vi.fn>;
  unmount: ReturnType<typeof vi.fn>;
  save: ReturnType<typeof vi.fn>;
  reopen: ReturnType<typeof vi.fn>;
  showDraft: ReturnType<typeof vi.fn>;
  resolveSelection: ReturnType<typeof vi.fn>;
  editDocument: ReturnType<typeof vi.fn>;
  /** The editor saying the document has, or no longer has, unsaved changes. */
  report: (dirty: boolean) => void;
  /** The editor reporting what the user has selected. */
  select: (selection: CanvasSelection | null) => void;
  /** Apply pressed on the draft drawn inside the document. */
  applyFromDocument: () => void;
  /** The editor reporting that its file failed to open or to save itself — or recovered. */
  failFile: (fileId: string, failure: FileFailure | null) => void;
  /** The user zooming a document inside its editor. */
  zoom: (fileId: string, zoom: CanvasZoom) => void;
}

export interface TestCanvasAdapterOptions {
  /**
   * Turn on the in-place edit path.
   *
   * With it the adapter answers `canEditDocument()` the way a mounted Word or
   * PowerPoint editor does, so an instruction aimed at the open file is routed
   * to `editDocument` rather than to the generation runtime. The value is what
   * `editDocument` resolves to, over the defaults below.
   */
  inPlace?: Partial<DocumentEditResult>;
  /** What `resolveSelection` answers when the message goes out. */
  selectionText?: string;
}

export function createTestCanvasAdapter(options: TestCanvasAdapterOptions = {}): TestCanvasAdapter {
  let dirtyListener: ((dirty: boolean) => void) | null = null;
  let selectionListener: ((selection: CanvasSelection | null) => void) | null = null;
  let draftListener: ((action: "apply") => void) | null = null;
  let failureListener: ((fileId: string, failure: FileFailure | null) => void) | null = null;
  let zoomListener: ((fileId: string, zoom: CanvasZoom) => void) | null = null;

  const mount = vi.fn((_host: HTMLElement) => {});
  const show = vi.fn((_file: FileMeta) => {});
  const hide = vi.fn(() => {});
  const unmount = vi.fn(() => {});
  const save = vi.fn(async () => {});
  const reopen = vi.fn((_file: FileMeta) => {});
  const showDraft = vi.fn((_draft: CanvasDraft | null) => {});
  const resolveSelection = vi.fn(async (): Promise<CanvasSelection | null> => ({
    fileId: SEED_ACTIVE_FILE_ID,
    label: "MO launch plan.docx · Heading",
    text: options.selectionText ?? "A better everyday workspace",
  }));
  const editDocument = vi.fn(
    async (_request: DocumentEditRequest): Promise<DocumentEditResult> => ({
      summary: "Shortened the second paragraph.",
      applied: 1,
      saveError: null,
      undo: null,
      scope: "document",
      ...options.inPlace,
    }),
  );

  const adapter: CanvasAdapter = {
    mount,
    show,
    hide,
    unmount,
    onSelection(listener) {
      selectionListener = listener;
      return () => {
        selectionListener = null;
      };
    },
    resolveSelection,
    onDirtyChange(listener) {
      dirtyListener = listener;
      return () => {
        dirtyListener = null;
      };
    },
    showDraft,
    onDraftAction(listener) {
      draftListener = listener;
      return () => {
        draftListener = null;
      };
    },
    save,
    reopen,
    onFileFailure(listener) {
      failureListener = listener;
      return () => {
        failureListener = null;
      };
    },
    onZoomChange(listener) {
      zoomListener = listener;
      return () => {
        zoomListener = null;
      };
    },
    ...(options.inPlace ? { canEditDocument: () => true, editDocument } : {}),
  };

  return {
    adapter,
    mount,
    show,
    hide,
    unmount,
    save,
    reopen,
    showDraft,
    resolveSelection,
    editDocument,
    report: (dirty) => dirtyListener?.(dirty),
    select: (selection) => selectionListener?.(selection),
    applyFromDocument: () => draftListener?.("apply"),
    failFile: (fileId, failure) => failureListener?.(fileId, failure),
    zoom: (fileId, zoom) => zoomListener?.(fileId, zoom),
  };
}
