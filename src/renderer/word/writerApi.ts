import type { WriterEmbedEvent, WriterHostCommand, WriterSelectionSummary } from "../../shared/writerProtocol";

export const WRITER_API_PROTOCOL_VERSION = 1;

export type WriterApiErrorCode =
  | "WRITER_UNAVAILABLE"
  | "WRITER_NOT_OPEN"
  | "UNSUPPORTED_OPERATION"
  | "INVALID_ARGUMENT"
  | "REQUEST_TIMEOUT"
  | "REQUEST_CANCELLED"
  | "WRITER_REJECTED";

export interface WriterApiError { code: WriterApiErrorCode; message: string; }
export interface WriterCapabilities {
  open: boolean; readContent: boolean; readSelection: boolean;
  insertText: boolean; replaceSelection: boolean; replaceText: boolean; save: boolean;
  exportDocx: boolean; exportPdf: boolean;
}
export interface WriterApiTransport {
  post(message: WriterHostCommand): void;
  onEvent(listener: (event: WriterEmbedEvent) => void): () => void;
}

/** Stable facade over the existing Writer embed protocol. It never reaches into Writer internals. */
export class WriterApi {
  constructor(private readonly transport: WriterApiTransport) {}

  capabilities(): WriterCapabilities {
    return { open: true, readContent: false, readSelection: true, insertText: false,
      replaceSelection: false, replaceText: true, save: true, exportDocx: true, exportPdf: false };
  }

  onEvent(listener: (event: WriterEmbedEvent) => void): () => void { return this.transport.onEvent(listener); }

  save(saveAsCopy = false): Promise<unknown> {
    const requestId = `writer-api-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    return new Promise((resolve, reject) => {
      const off = this.transport.onEvent((event) => {
        if (event.type === "writer:save" && event.requestId === requestId) { off(); resolve(event); }
        if (event.type === "writer:save-failed" && event.requestId === requestId) { off(); reject(this.error("WRITER_REJECTED", event.error)); }
      });
      this.transport.post({ type: "writer:save-request", requestId, saveAsCopy });
    });
  }

  /** Coarse caret/selection summary. Writer does not expose the selected text. */
  readSelection(): Promise<WriterSelectionSummary> {
    const requestId = `writer-selection-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    return new Promise((resolve, reject) => {
      const off = this.transport.onEvent((event) => {
        if (event.type !== "writer:response" || event.requestId !== requestId) return;
        off();
        if (event.ok) resolve(event.result as WriterSelectionSummary);
        else reject(this.error("WRITER_REJECTED", event.error || "Writer rejected the selection read."));
      });
      this.transport.post({ type: "writer:read-selection", requestId });
    });
  }

  insertText(): Promise<never> { return Promise.reject(this.error("UNSUPPORTED_OPERATION", "Writer does not expose insertText yet.")); }
  replaceSelection(): Promise<never> { return Promise.reject(this.error("UNSUPPORTED_OPERATION", "Writer does not expose replaceSelection yet.")); }

  replaceText(query: string, replacement: string, scope: "selection" | "document" = "document"): Promise<unknown> {
    if (!query.trim()) return Promise.reject(this.error("INVALID_ARGUMENT", "Replacement query cannot be empty."));
    const requestId = `writer-replace-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    return new Promise((resolve, reject) => {
      const off = this.transport.onEvent((event) => {
        if (event.type === "writer:response" && event.requestId === requestId) { off(); event.ok ? resolve(event.result) : reject(this.error("WRITER_REJECTED", event.error || "Writer rejected text replacement.")); }
      });
      this.transport.post({ type: "writer:replace-text", requestId, query, replacement, scope });
    });
  }

  private error(code: WriterApiErrorCode, message: string): WriterApiError { return { code, message }; }
}

export function createWriterApi(transport: WriterApiTransport): WriterApi { return new WriterApi(transport); }
