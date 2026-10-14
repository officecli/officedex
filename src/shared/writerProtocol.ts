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
 * Coarse summary of the caret or selection, pushed on every caret move. It
 * carries no text: what the embed reports for free is whether there is a
 * selection, whether it collapsed to a caret, and how many paragraphs it
 * touches — enough to say what an instruction applies to without shipping
 * document content out of the editor on every keystroke.
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

/**
 * The selection with its words, answered to `writer:read-selection`.
 *
 * A read, not a capture: the embed resolves the text in a request context of
 * its own and tracks nothing, so the one edit scope `writer:capture-edit`
 * leaves behind for a later `writer:apply-edit` is untouched. `text` is the
 * empty string for a caret or an unfocused document. A selection outside the
 * main story (a header or footer) is refused with `ok: false`, and the host
 * keeps whatever label it had.
 *
 * Also an optional extension within protocol version 1: an older embed
 * answers with the summary alone, and the host reads a missing `text` as "".
 */
export interface WriterSelectionContent extends WriterSelectionSummary {
  readonly text: string;
}

/**
 * How the embed lays out its toolbar, chosen by the host on the iframe URL
 * (`?toolbarProfile=compact`). `full` is Writer's own two-row ribbon; `compact`
 * is its single-line variant, for a document opened beside a conversation.
 * Unknown or absent reads as `full`, so an older embed ignores it.
 */
export type WriterToolbarProfile = "full" | "compact";

/**
 * How large Writer draws the page: a percentage, or one of its two fit modes.
 * A fit mode carries no percentage — the window decides that, not the user.
 *
 * Additive to protocol version 1, like the selection messages: an older embed
 * ignores `writer:set-zoom` and opens fitted to the page width as it always
 * did, and never sends `writer:zoom-changed`.
 */
export type WriterZoom =
  | { readonly mode: "percentage"; readonly percent: number }
  | { readonly mode: "fit-page-width" }
  | { readonly mode: "fit-whole-page" };

export type WriterHostCommand =
  | { type: "writer:toolbar-profile"; profile: "compact" | "full" }
  | {
      /**
       * The zoom the host wants. Sent before `writer:load` it is the zoom the
       * document opens at; sent later it applies at once.
       */
      type: "writer:set-zoom";
      zoom: WriterZoom;
    }
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
      /**
       * The host pulls the current selection, words included; the embed
       * answers with a `WriterSelectionContent`. Used by the
       * docx.editor.read_selection agent tool and by the composer's quote.
       */
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
  /** The user changed the zoom. Opening at the host's zoom is not reported. */
  | { type: "writer:zoom-changed"; zoom: WriterZoom }
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
