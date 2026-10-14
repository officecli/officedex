/**
 * How the user left each document's view (UI-14): today, its zoom.
 *
 * Per file, because the editors' own memory is not: the Sheet SDK keeps one
 * zoom per signed-in user, across every workbook (and none offline, where
 * there is no user), and Writer and the deck editor keep none at all — each
 * opens on its own default every time. So the shell
 * keeps the choice here, keyed by the file id the port already uses, and hands
 * it to the editor with every `show`.
 *
 * A file with no entry opens at `DEFAULT_DOCUMENT_ZOOM`. Nothing is written
 * until the user changes something: the adapter reports only the user's
 * changes, never the zoom an editor opened at.
 *
 * Disposable view state like `libraryMeta.ts`, in this window's storage. The
 * oldest entries are dropped past `MAX_ENTRIES` so files that are long gone do
 * not accumulate forever.
 */

import type { CanvasZoom } from "../editor/canvasContract";

const KEY = "officedex.shell.documentView.v1";

/** What a document's page opens at before the user has chosen anything. */
export const DEFAULT_DOCUMENT_ZOOM: CanvasZoom = 80;

const MAX_ENTRIES = 500;

interface DocumentView {
  zoom: CanvasZoom;
  /** Epoch ms of the last change, for dropping the oldest entries. */
  updatedAt: number;
}

type DocumentViews = Record<string, DocumentView>;

function isZoom(value: unknown): value is CanvasZoom {
  if (value === "fit-width" || value === "fit-page") return true;
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function readViews(): DocumentViews {
  if (typeof localStorage === "undefined") return {};
  try {
    const raw = localStorage.getItem(KEY);
    const value = raw ? (JSON.parse(raw) as unknown) : null;
    return value && typeof value === "object" ? (value as DocumentViews) : {};
  } catch {
    return {};
  }
}

/** The zoom a file opens at: what the user last chose for it, or the default. */
export function readDocumentZoom(fileId: string): CanvasZoom {
  const zoom = readViews()[fileId]?.zoom;
  return isZoom(zoom) ? zoom : DEFAULT_DOCUMENT_ZOOM;
}

export function writeDocumentZoom(fileId: string, zoom: CanvasZoom, now = Date.now()): void {
  if (typeof localStorage === "undefined" || !isZoom(zoom)) return;
  const views = { ...readViews(), [fileId]: { zoom, updatedAt: now } };
  const ids = Object.keys(views);
  if (ids.length > MAX_ENTRIES) {
    ids
      .sort((left, right) => (views[left]?.updatedAt ?? 0) - (views[right]?.updatedAt ?? 0))
      .slice(0, ids.length - MAX_ENTRIES)
      .forEach((id) => delete views[id]);
  }
  try {
    localStorage.setItem(KEY, JSON.stringify(views));
  } catch {
    // View state is disposable; a full quota must not break the session.
  }
}
