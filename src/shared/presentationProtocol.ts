export const PRESENTATION_EMBED_PROTOCOL_VERSION = 1;

export type PresentationHostCommand =
  | {
      type: "presentation:load";
      protocolVersion: number;
      sessionId: string;
      fileId: string;
      title: string;
      sourceFileName: string;
      content: ArrayBuffer;
      documentRevision: number;
      assets: Array<{
        path: string;
        contentType: string;
        data: ArrayBuffer;
      }>;
    }
  | {
      type: "presentation:response";
      requestId: string;
      ok: boolean;
      result?: unknown;
      error?: string;
    }
  | {
      /**
       * Runs Office.js (`PowerPoint.run`) source inside the embedded editor
       * against the open presentation. The source is executed as the body of
       * an async function; its return value is JSON-cloned into the result.
       */
      type: "presentation:execute-script";
      requestId: string;
      source: string;
      /** How long to wait for the editor autosave to flush after the script ran. */
      awaitSnapshotMs?: number;
    }
  | {
      /**
       * Replaces the document the editor holds, keeping the running runtime.
       * Stepping through a deck's recorded history uses this: reopening the
       * file instead would boot the whole component again and read as a page
       * refresh.
       */
      type: "presentation:swap-document";
      requestId: string;
      content: ArrayBuffer;
      documentRevision: number;
      title?: string;
      /**
       * Whether edits to the swapped-in document may be saved back to the
       * file. A past state is browsed with this off, so nothing can write it
       * over the deck; restoring the session's own document turns it back on.
       */
      persist?: boolean;
      /**
       * The page the document should open on, 1-based. A document opens on its
       * first page, so without this a step on page 5 shows page 1 for a frame.
       */
      activeSlide?: number;
      assets: Array<{
        path: string;
        contentType: string;
        data: ArrayBuffer;
      }>;
    };

export type PresentationEmbedEvent =
  | {
      type: "presentation:embed-ready";
      protocolVersion: number;
    }
  | { type: "presentation:embed-error"; error?: string }
  | { type: "presentation:dirty-changed"; dirty: boolean }
  | {
      /**
       * The user clicked or typed inside the editor, so what is selected may
       * have changed. Carries nothing: reading the selection needs Office.js
       * and the host already owns that script, so the embed reports the
       * gesture and the host decides whether to spend a round trip on it.
       *
       * PowerPoint has no selection event to subscribe to, and polling for one
       * would be a script into the iframe forever. This is the cheap half of
       * that trade — debounced in the embed, so a drag is one message.
       */
      type: "presentation:selection-changed";
    }

  | {
      type: "presentation:save-snapshot";
      requestId: string;
      sessionId: string;
      content: ArrayBuffer;
      baseRevision: number;
      revision: number;
    }
  | {
      type: "presentation:save-asset";
      requestId: string;
      sessionId: string;
      relativePath: string;
      contentType?: string;
      data: ArrayBuffer;
    }
  | {
      type: "presentation:save-video";
      requestId: string;
      sessionId: string;
      revision: number;
      fileName: string;
      content: ArrayBuffer;
      contentType: "video/mp4";
    }
  | {
      type: "presentation:export-pptx";
      requestId: string;
      sessionId: string;
      revision: number;
    }
  | {
      type: "presentation:script-result";
      requestId: string;
      ok: boolean;
      result?: unknown;
      error?: string;
      /** True when the editor persisted a snapshot after the script ran. */
      snapshotSaved: boolean;
    }
  | {
      type: "presentation:swap-result";
      requestId: string;
      ok: boolean;
      /** The revision the editor now holds, when the swap succeeded. */
      documentRevision?: number;
      error?: string;
    };

export function isPresentationEmbedEvent(
  value: unknown,
): value is PresentationEmbedEvent {
  if (!value || typeof value !== "object") return false;
  const type = (value as { type?: unknown }).type;
  return typeof type === "string" && type.startsWith("presentation:");
}
