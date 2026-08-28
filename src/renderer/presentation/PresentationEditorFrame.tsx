import { useCallback, useEffect, useRef, useState } from "react";
import {
  isPresentationEmbedEvent,
  PRESENTATION_EMBED_PROTOCOL_VERSION,
  type PresentationEmbedEvent,
  type PresentationHostCommand,
} from "../../shared/presentationProtocol";
import { officecli } from "../bridge";
import { registerActiveEditorClientTools } from "../activeEditorClientTools";
import {
  PRESENTATION_INSPECT_SOURCE,
  type PresentationEditorContext,
} from "../../shared/presentationInspect";
import { errorMessage } from "../utils/values";

const DEFAULT_PRESENTATION_URL = "/presentation/index.html?mode=embed";
const PRESENTATION_MANIFEST_URL = "/presentation/officedex-component.json";

export interface PresentationScriptResult {
  result: unknown;
  /** True when the editor autosaved a snapshot after the script ran. */
  snapshotSaved: boolean;
}

/**
 * Imperative handle over the embedded editor, handed to the parent through
 * `onController` once the presentation is loaded (and `null` on teardown).
 */
export interface PresentationEditorController {
  /** Runs Office.js source (async function body) inside the editor. */
  executeScript(source: string, options?: { awaitSnapshotMs?: number; timeoutMs?: number }): Promise<PresentationScriptResult>;
  /** Snapshots slides/shapes/selection for the AI planner. */
  inspect(): Promise<PresentationEditorContext>;
  /** Exports the current editor state back to the .pptx on disk. */
  save(): Promise<{ filePath: string; revision: number }>;
  /**
   * Identifies the host-side editing session. Recording a timeline node reads
   * the document the host holds for this session, so the caller has to be able
   * to name it.
   */
  session(): { previewToken: string; sessionId: string };
  /**
   * Replaces the open document without reloading the editor. Stepping through
   * a deck's history this way keeps the runtime, the canvas and the scroll
   * position; reopening the file would boot the whole component again.
   */
  swapDocument(input: {
    content: ArrayBuffer;
    assets: PresentationAsset[];
    documentRevision: number;
    title?: string;
    /** True only for the document this session may save back to its file. */
    persist?: boolean;
    /** The page to open on, so a step on page 5 never flashes page 1. */
    activeSlide?: number;
  }): Promise<number>;
}

/** One media file of a MOP package, as the embed protocol carries it. */
export interface PresentationAsset {
  path: string;
  contentType: string;
  data: ArrayBuffer;
}

export interface PresentationEditorFrameProps {
  previewToken: string;
  fileName: string;
  onDirtyChange?: (dirty: boolean) => void;
  onUnavailable: (error?: string) => void;
  onReady?: () => void;
  onController?: (controller: PresentationEditorController | null) => void;
  /** Fired after the editor writes the deck back to disk. */
  onSaved?: (result: { filePath: string; revision: number }) => void;
}

const SCRIPT_TIMEOUT_MS = 120_000;
/** A document swap re-attaches an already-running editor; it is not a boot. */
const SWAP_TIMEOUT_MS = 30_000;

function toTransferableBuffer(data: ArrayBuffer | Uint8Array): ArrayBuffer {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

async function hasPresentationComponent(
  fetcher: typeof fetch = fetch,
): Promise<boolean> {
  try {
    const response = await fetcher(PRESENTATION_MANIFEST_URL, {
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    if (!response.ok) return false;
    const manifest = (await response.json()) as { protocolVersion?: unknown };
    return manifest.protocolVersion === PRESENTATION_EMBED_PROTOCOL_VERSION;
  } catch {
    return false;
  }
}

export function PresentationEditorFrame({
  previewToken,
  fileName,
  onDirtyChange,
  onUnavailable,
  onReady,
  onController,
  onSaved,
}: PresentationEditorFrameProps) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const sessionIdRef = useRef("");
  const revisionRef = useRef(0);
  const unregisterClientToolsRef = useRef<(() => void) | undefined>(undefined);
  const disposedRef = useRef(false);
  const unavailableRef = useRef(false);
  const callbacksRef = useRef({ onDirtyChange, onUnavailable, onReady, onController, onSaved });
  const scriptRequestsRef = useRef(
    new Map<string, { resolve(value: PresentationScriptResult): void; reject(error: Error): void; timeout: number }>(),
  );
  const swapRequestsRef = useRef(
    new Map<string, { resolve(value: number): void; reject(error: Error): void; timeout: number }>(),
  );
  const scriptSequenceRef = useRef(0);
  const [componentURL, setComponentURL] = useState<string>();

  callbacksRef.current = { onDirtyChange, onUnavailable, onReady, onController, onSaved };

  const markUnavailable = useCallback((error?: string) => {
    if (unavailableRef.current) return;
    unavailableRef.current = true;
    callbacksRef.current.onUnavailable(error);
  }, []);

  const post = useCallback((message: PresentationHostCommand, transfer: Transferable[] = []) => {
    frameRef.current?.contentWindow?.postMessage(message, "*", transfer);
  }, []);

  useEffect(() => {
    disposedRef.current = false;
    unavailableRef.current = false;
    void hasPresentationComponent().then((available) => {
      if (disposedRef.current) return;
      if (!available) {
        markUnavailable("Presentation component assets are not installed.");
        return;
      }
      const configured = import.meta.env.VITE_PRESENTATION_EDITOR_URL?.trim();
      setComponentURL(configured || DEFAULT_PRESENTATION_URL);
    });
    return () => {
      disposedRef.current = true;
    };
  }, [markUnavailable]);

  const executeScript = useCallback(
    (source: string, options: { awaitSnapshotMs?: number; timeoutMs?: number } = {}) =>
      new Promise<PresentationScriptResult>((resolve, reject) => {
        if (!frameRef.current?.contentWindow) {
          reject(new Error("The presentation editor is not mounted."));
          return;
        }
        const requestId = `presentation-script-${Date.now()}-${++scriptSequenceRef.current}`;
        const timeout = window.setTimeout(() => {
          scriptRequestsRef.current.delete(requestId);
          reject(new Error("The presentation script timed out."));
        }, Math.max(options.timeoutMs ?? SCRIPT_TIMEOUT_MS, 1_000));
        scriptRequestsRef.current.set(requestId, { resolve, reject, timeout });
        post({
          type: "presentation:execute-script",
          requestId,
          source,
          awaitSnapshotMs: options.awaitSnapshotMs,
        });
      }),
    [post],
  );

  const swapDocument = useCallback(
    (input: {
      content: ArrayBuffer;
      assets: PresentationAsset[];
      documentRevision: number;
      title?: string;
      persist?: boolean;
      activeSlide?: number;
    }) =>
      new Promise<number>((resolve, reject) => {
        if (!frameRef.current?.contentWindow) {
          reject(new Error("The presentation editor is not mounted."));
          return;
        }
        const requestId = `presentation-swap-${Date.now()}-${++scriptSequenceRef.current}`;
        const timeout = window.setTimeout(() => {
          swapRequestsRef.current.delete(requestId);
          reject(new Error("Swapping the presentation document timed out."));
        }, SWAP_TIMEOUT_MS);
        swapRequestsRef.current.set(requestId, { resolve, reject, timeout });
        post(
          {
            type: "presentation:swap-document",
            requestId,
            content: input.content,
            assets: input.assets,
            // The session's revision is this frame's to know: a document that
            // may be saved has to come back in at the revision the host holds,
            // or its first save is rejected as a conflict.
            documentRevision: input.persist ? revisionRef.current : input.documentRevision,
            title: input.title,
            persist: input.persist,
            activeSlide: input.activeSlide,
          },
          [input.content, ...input.assets.map((asset) => asset.data)],
        );
      }),
    [post],
  );

  const saveToDisk = useCallback(async () => {
    const sessionId = sessionIdRef.current;
    if (!sessionId) throw new Error("PPTX editor session is not ready.");
    const result = await officecli.exportPptxEditor({
      previewToken,
      sessionId,
      revision: revisionRef.current,
    });
    revisionRef.current = result.revision;
    callbacksRef.current.onDirtyChange?.(false);
    const saved = { filePath: result.filePath, revision: result.revision };
    callbacksRef.current.onSaved?.(saved);
    return saved;
  }, [previewToken]);

  useEffect(() => {
    const respond = (
      requestId: string,
      result?: unknown,
      error?: unknown,
      transfer: Transferable[] = [],
    ) => {
      post(
        {
          type: "presentation:response",
          requestId,
          ok: error === undefined,
          result,
          error: error === undefined ? undefined : errorMessage(error),
        },
        transfer,
      );
    };

    const handleRequest = async (event: PresentationEmbedEvent) => {
      switch (event.type) {
        case "presentation:embed-ready": {
          if (event.protocolVersion !== PRESENTATION_EMBED_PROTOCOL_VERSION) {
            markUnavailable(
              `Unsupported Presentation protocol ${event.protocolVersion}.`,
            );
            return;
          }
          try {
            const prepared = await officecli.preparePptxEditor(previewToken);
            if (disposedRef.current) return;
            sessionIdRef.current = prepared.sessionId;
            revisionRef.current = prepared.documentRevision;
            unregisterClientToolsRef.current?.();
            unregisterClientToolsRef.current = registerActiveEditorClientTools("pptx-editor", {
              "pptx.editor.save": async () => {
                const result = await saveToDisk();
                return { file_path: result.filePath, revision: result.revision, saved: true };
              },
            });
            const content = toTransferableBuffer(prepared.content);
            const assets = (prepared.assets ?? []).map((asset) => ({
              path: asset.path,
              contentType: asset.contentType,
              data: toTransferableBuffer(asset.data),
            }));
            post(
              {
                type: "presentation:load",
                protocolVersion: PRESENTATION_EMBED_PROTOCOL_VERSION,
                sessionId: prepared.sessionId,
                fileId: prepared.fileId,
                title: prepared.title || fileName,
                sourceFileName: prepared.sourceFileName || fileName,
                content,
                documentRevision: prepared.documentRevision,
                assets,
              },
              [content, ...assets.map((asset) => asset.data)],
            );
            callbacksRef.current.onReady?.();
            callbacksRef.current.onController?.({
              executeScript,
              inspect: async () => {
                const { result } = await executeScript(PRESENTATION_INSPECT_SOURCE, { awaitSnapshotMs: 0 });
                return result as PresentationEditorContext;
              },
              save: saveToDisk,
              session: () => ({ previewToken, sessionId: sessionIdRef.current }),
              swapDocument,
            });
          } catch (error) {
            markUnavailable(errorMessage(error));
          }
          return;
        }
        case "presentation:script-result": {
          const pending = scriptRequestsRef.current.get(event.requestId);
          if (!pending) return;
          scriptRequestsRef.current.delete(event.requestId);
          window.clearTimeout(pending.timeout);
          if (event.ok) pending.resolve({ result: event.result, snapshotSaved: event.snapshotSaved });
          else pending.reject(new Error(event.error || "The presentation script failed."));
          return;
        }
        case "presentation:swap-result": {
          const pending = swapRequestsRef.current.get(event.requestId);
          if (!pending) return;
          swapRequestsRef.current.delete(event.requestId);
          window.clearTimeout(pending.timeout);
          if (event.ok) {
            revisionRef.current = event.documentRevision ?? revisionRef.current;
            pending.resolve(revisionRef.current);
          } else {
            pending.reject(new Error(event.error || "Swapping the presentation document failed."));
          }
          return;
        }
        case "presentation:embed-error":
          markUnavailable(event.error);
          return;
        case "presentation:dirty-changed":
          callbacksRef.current.onDirtyChange?.(event.dirty);
          return;
        case "presentation:save-snapshot":
          try {
            const result = await officecli.savePptxEditorSnapshot({
              previewToken,
              sessionId: event.sessionId,
              content: new Uint8Array(event.content),
              baseRevision: event.baseRevision,
              revision: event.revision,
            });
            revisionRef.current = result.revision;
            respond(event.requestId, result);
          } catch (error) {
            respond(event.requestId, undefined, error);
          }
          return;
        case "presentation:save-asset":
          try {
            const result = await officecli.savePptxEditorAsset({
              previewToken,
              sessionId: event.sessionId,
              relativePath: event.relativePath,
              contentType: event.contentType,
              data: new Uint8Array(event.data),
            });
            respond(event.requestId, result);
          } catch (error) {
            respond(event.requestId, undefined, error);
          }
          return;
        case "presentation:export-pptx":
          try {
            const result = await officecli.exportPptxEditor({
              previewToken,
              sessionId: event.sessionId,
              revision: event.revision,
            });
            revisionRef.current = result.revision;
            const artifact = await officecli.readArtifactFile(previewToken);
            const data = toTransferableBuffer(artifact.data);
            callbacksRef.current.onDirtyChange?.(false);
            respond(
              event.requestId,
              { ...result, fileName, data },
              undefined,
              [data],
            );
          } catch (error) {
            respond(event.requestId, undefined, error);
          }
      }
    };

    const onMessage = (event: MessageEvent) => {
      if (event.source !== frameRef.current?.contentWindow) return;
      if (!isPresentationEmbedEvent(event.data)) return;
      void handleRequest(event.data);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [executeScript, fileName, markUnavailable, post, previewToken, saveToDisk]);

  useEffect(
    () => () => {
      const sessionId = sessionIdRef.current;
      sessionIdRef.current = "";
      revisionRef.current = 0;
      unregisterClientToolsRef.current?.();
      unregisterClientToolsRef.current = undefined;
      callbacksRef.current.onController?.(null);
      for (const pending of scriptRequestsRef.current.values()) {
        window.clearTimeout(pending.timeout);
        pending.reject(new Error("The presentation editor was closed."));
      }
      scriptRequestsRef.current.clear();
      if (sessionId) {
        void officecli
          .closePptxEditor({ previewToken, sessionId })
          .catch(() => undefined);
      }
    },
    [previewToken],
  );

  if (!componentURL) return null;
  return (
    <iframe
      ref={frameRef}
      src={componentURL}
      className="pptx-embed-frame"
      title={fileName}
      sandbox="allow-same-origin allow-scripts allow-downloads allow-forms allow-modals"
    />
  );
}
