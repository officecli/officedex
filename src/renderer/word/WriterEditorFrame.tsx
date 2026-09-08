import { useCallback, useEffect, useRef, useState } from "react";
import { PendingRequests } from "../../shared/embedRequests";
import {
  isWriterEmbedEvent,
  WRITER_EMBED_PROTOCOL_VERSION,
  type WriterEmbedEvent,
  type WriterHostCommand,
} from "../../shared/writerProtocol";
import { officecli } from "../bridge";
import { registerActiveEditorClientTools } from "../activeEditorClientTools";
import { errorMessage } from "../utils/values";

const DEFAULT_WRITER_URL = "/writer/index.html";
const WRITER_MANIFEST_URL = "/writer/officedex-component.json";

/**
 * How long the host waits for the embed to export a DOCX. Writer runs the
 * export through word2mow, whose own conversion budget is 120s.
 */
const SAVE_TIMEOUT_MS = 150_000;

export interface WriterEditorFrameProps {
  previewToken: string;
  fileName: string;
  /** Opens the document without a save path; Writer hides its save action. */
  readOnly?: boolean;
  onDirtyChange?: (dirty: boolean) => void;
  /** The Writer component is missing or spoke an unsupported protocol. */
  onUnavailable: (error?: string) => void;
  onReady?: () => void;
  /** Fired after the host writes the document back to disk. */
  onSaved?: (result: { filePath: string; sha256: string; saveAsCopy: boolean }) => void;
}

function toTransferableBuffer(data: ArrayBuffer | Uint8Array): ArrayBuffer {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

/**
 * Whether the Writer embed build is installed and speaks our protocol version.
 * A source checkout without `npm run build:writer` has no public/writer, and a
 * stale one may speak an older protocol; both fall back rather than mounting a
 * frame that will never answer.
 */
export async function hasWriterComponent(fetcher: typeof fetch = fetch): Promise<boolean> {
  try {
    const response = await fetcher(WRITER_MANIFEST_URL, {
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    if (!response.ok) return false;
    const manifest = (await response.json()) as { protocolVersion?: unknown };
    return manifest.protocolVersion === WRITER_EMBED_PROTOCOL_VERSION;
  } catch {
    return false;
  }
}

/**
 * Hosts the Writer editor in an iframe. Writer is a paginated layout engine
 * built on React 18 and its own wasm runtime, so it runs as a separate
 * document and talks to the host over postMessage; document bytes cross as
 * ArrayBuffer because a packaged WKWebView drops every other body type.
 */
export function WriterEditorFrame({
  previewToken,
  fileName,
  readOnly = false,
  onDirtyChange,
  onUnavailable,
  onReady,
  onSaved,
}: WriterEditorFrameProps) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const fingerprintRef = useRef<string | undefined>(undefined);
  const unregisterClientToolsRef = useRef<(() => void) | undefined>(undefined);
  const disposedRef = useRef(false);
  const unavailableRef = useRef(false);
  const callbacksRef = useRef({ onDirtyChange, onUnavailable, onReady, onSaved });
  // Host-initiated saves (the docx.editor.save agent tool) wait here until the
  // embed has exported and the host has written the file.
  const requestsRef = useRef(new PendingRequests({ idPrefix: "writer" }));
  const [componentURL, setComponentURL] = useState<string>();

  callbacksRef.current = { onDirtyChange, onUnavailable, onReady, onSaved };

  const markUnavailable = useCallback((error?: string) => {
    if (unavailableRef.current) return;
    unavailableRef.current = true;
    callbacksRef.current.onUnavailable(error);
  }, []);

  const post = useCallback((message: WriterHostCommand, transfer: Transferable[] = []) => {
    frameRef.current?.contentWindow?.postMessage(message, "*", transfer);
  }, []);

  useEffect(() => {
    disposedRef.current = false;
    unavailableRef.current = false;
    void hasWriterComponent().then((available) => {
      if (disposedRef.current) return;
      if (!available) {
        markUnavailable("Writer component assets are not installed.");
        return;
      }
      const configured = import.meta.env.VITE_WRITER_EDITOR_URL?.trim();
      setComponentURL(configured || DEFAULT_WRITER_URL);
    });
    return () => {
      disposedRef.current = true;
    };
  }, [markUnavailable]);

  /** Asks the embed to export and save; resolves once the file is on disk. */
  const requestSave = useCallback(
    (saveAsCopy: boolean) =>
      new Promise<{ filePath: string; sha256: string }>((resolve, reject) => {
        if (!frameRef.current?.contentWindow) {
          reject(new Error("The Writer editor is not mounted."));
          return;
        }
        const requestId = requestsRef.current.nextId();
        requestsRef.current
          .open<{ filePath: string; sha256: string }>(
            requestId,
            SAVE_TIMEOUT_MS,
            "Saving the document timed out.",
          )
          .then(resolve, reject);
        post({ type: "writer:save-request", requestId, saveAsCopy });
      }),
    [post],
  );

  useEffect(() => {
    const respond = (requestId: string, result?: unknown, error?: unknown) => {
      post({
        type: "writer:response",
        requestId,
        ok: error === undefined,
        result,
        error: error === undefined ? undefined : errorMessage(error),
      });
    };

    const handleEvent = async (event: WriterEmbedEvent) => {
      switch (event.type) {
        case "writer:embed-ready": {
          if (event.protocolVersion !== WRITER_EMBED_PROTOCOL_VERSION) {
            markUnavailable(`Unsupported Writer protocol ${event.protocolVersion}.`);
            return;
          }
          try {
            const artifact = await officecli.readArtifactFile(previewToken);
            if (disposedRef.current) return;
            fingerprintRef.current = artifact.sha256;
            unregisterClientToolsRef.current?.();
            unregisterClientToolsRef.current = registerActiveEditorClientTools("docx-editor", {
              "docx.editor.save": async (arguments_) => {
                const result = await requestSave(arguments_.save_as_copy === true);
                return { file_path: result.filePath, sha256: result.sha256, saved: true };
              },
            });
            const content = toTransferableBuffer(artifact.data);
            post(
              {
                type: "writer:load",
                protocolVersion: WRITER_EMBED_PROTOCOL_VERSION,
                content,
                fileName,
                sha256: artifact.sha256,
                readOnly,
              },
              [content],
            );
          } catch (error) {
            markUnavailable(errorMessage(error));
          }
          return;
        }
        case "writer:document-loaded":
          callbacksRef.current.onDirtyChange?.(false);
          callbacksRef.current.onReady?.();
          return;
        case "writer:embed-error":
          markUnavailable(event.error);
          return;
        case "writer:dirty-changed":
          callbacksRef.current.onDirtyChange?.(event.dirty);
          return;
        case "writer:save": {
          const saveAsCopy = event.saveAsCopy === true;
          try {
            // App.SaveDocx keeps its existing contract: it validates the ZIP
            // package, resolves the destination, and rejects the write when the
            // file changed underneath us since we read it.
            const result = await officecli.saveDocx(new Uint8Array(event.content), fileName, {
              previewToken,
              expectedSHA256: fingerprintRef.current,
              saveAsCopy,
            });
            if (!saveAsCopy) {
              fingerprintRef.current = result.sha256;
              callbacksRef.current.onDirtyChange?.(false);
            }
            callbacksRef.current.onSaved?.({ ...result, saveAsCopy });
            respond(event.requestId, result);
            requestsRef.current.resolve(event.requestId, result);
          } catch (error) {
            respond(event.requestId, undefined, error);
            requestsRef.current.reject(event.requestId, new Error(errorMessage(error)));
          }
          return;
        }
        case "writer:save-failed":
          requestsRef.current.reject(
            event.requestId,
            new Error(event.error || "The Writer editor could not export the document."),
          );
      }
    };

    const onMessage = (event: MessageEvent) => {
      if (event.source !== frameRef.current?.contentWindow) return;
      if (!isWriterEmbedEvent(event.data)) return;
      void handleEvent(event.data);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [fileName, markUnavailable, post, previewToken, readOnly, requestSave]);

  useEffect(
    () => () => {
      fingerprintRef.current = undefined;
      unregisterClientToolsRef.current?.();
      unregisterClientToolsRef.current = undefined;
      requestsRef.current.rejectAll(new Error("The Writer editor was closed."));
      callbacksRef.current.onDirtyChange?.(false);
    },
    [previewToken],
  );

  if (!componentURL) return null;
  return (
    <iframe
      ref={frameRef}
      src={componentURL}
      className="writer-embed-frame"
      title={fileName}
      sandbox="allow-same-origin allow-scripts allow-downloads allow-forms allow-modals"
    />
  );
}
