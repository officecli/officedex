/**
 * postMessage protocol for the embedded Writer editor. The embed side declares
 * the same shapes in `writer/apps/officedex-embed/src/host-channel.ts`; the two
 * must change together.
 *
 * Document bytes always travel as ArrayBuffer: a packaged WKWebView drops
 * Blob/File/FormData bodies, and only ArrayBuffer survives the bridge.
 */
export const WRITER_EMBED_PROTOCOL_VERSION = 1;

/**
 * Coarse summary of the caret or selection. Writer's public facade does not
 * expose the selected text, and what it does report reliably is whether there
 * is a selection, whether it collapsed to a caret, and how many paragraphs it
 * touches — enough to say what an instruction applies to without shipping
 * document content out of the editor.
 *
 * Selection is additive to protocol version 1: an embed built before this
 * simply never sends the event, and the host falls back to whole-document
 * scope rather than refusing to mount.
 */
export interface WriterSelectionSummary {
  /** No caret in the document at all — the editor has never been focused. */
  readonly empty: boolean;
  /** A caret rather than a range: nothing is actually selected. */
  readonly collapsed: boolean;
  /** Paragraphs the selection touches, once Writer has resolved it. */
  readonly paragraphs?: number;
}

export type WriterHostCommand =
  | { type: "writer:capture-edit"; requestId: string; scope: "selection" | "document" }
  | { type: "writer:apply-edit"; requestId: string; id: string; edits: { query: string; replacement: string }[] }
  | {
      type: "writer:load";
      protocolVersion: number;
      content: ArrayBuffer;
      fileName: string;
      sha256?: string;
      readOnly?: boolean;
    }
  | {
      /** The host (including the `docx.editor.save` agent tool) asks for a save. */
      type: "writer:save-request";
      requestId: string;
      saveAsCopy?: boolean;
    }
  | {
      type: "writer:replace-text";
      requestId: string;
      query: string;
      replacement: string;
      scope?: "selection" | "document";
    }
  | {
      /** The host pulls the current selection (the docx.editor.read_selection agent tool). */
      type: "writer:read-selection";
      requestId: string;
    }
  | {
      type: "writer:response";
      requestId: string;
      ok: boolean;
      result?: unknown;
      error?: string;
    };

export type WriterEmbedEvent =
  | { type: "writer:embed-ready"; protocolVersion: number }
  | { type: "writer:embed-error"; error?: string }
  | { type: "writer:document-loaded"; fileName: string }
  | { type: "writer:dirty-changed"; dirty: boolean }
  | { type: "writer:selection-changed"; selection: WriterSelectionSummary }
  | {
      type: "writer:save";
      requestId: string;
      content: ArrayBuffer;
      saveAsCopy?: boolean;
    }
  | { type: "writer:save-failed"; requestId: string; error: string }
  | { type: "writer:response"; requestId: string; ok: boolean; result?: unknown; error?: string };

export function isWriterEmbedEvent(value: unknown): value is WriterEmbedEvent {
  if (!value || typeof value !== "object") return false;
  const type = (value as { type?: unknown }).type;
  return typeof type === "string" && type.startsWith("writer:");
}
