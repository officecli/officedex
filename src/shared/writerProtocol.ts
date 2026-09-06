/**
 * postMessage protocol for the embedded Writer editor. The embed side declares
 * the same shapes in `writer/apps/officedex-embed/src/host-channel.ts`; the two
 * must change together.
 *
 * Document bytes always travel as ArrayBuffer: a packaged WKWebView drops
 * Blob/File/FormData bodies, and only ArrayBuffer survives the bridge.
 */
export const WRITER_EMBED_PROTOCOL_VERSION = 1;

export type WriterHostCommand =
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
