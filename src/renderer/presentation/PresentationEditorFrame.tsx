import type { PptxEditorAsset } from "../../shared/types";
import { useCallback, useEffect, useRef, useState } from "react";
import { PendingRequests } from "../../shared/embedRequests";
import {
  isPresentationEmbedEvent,
  PRESENTATION_EMBED_PROTOCOL_VERSION,
  type PresentationEmbedEvent,
  type PresentationHostCommand,
} from "../../shared/presentationProtocol";
import { getCurrentLocale } from "../i18n";
import { useCanvasLocale, withEmbedLocaleQuery } from "../../shell/editor/canvasLocale";
import { useDesktopApi } from "../services/desktopApi";
import { registerActiveEditorClientTools } from "../activeEditorClientTools";
import {
  PRESENTATION_INSPECT_SOURCE,
  type PresentationEditorContext,
} from "../../shared/presentationInspect";
import { errorMessage } from "../utils/values";
import { EDITOR_PROBE_TIMEOUT_MS, EDITOR_SCRIPT_TIMEOUT_MS, EDITOR_SWAP_TIMEOUT_MS, EMBED_HANDSHAKE_TIMEOUT_MS } from "../constants/timing";

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
  /**
   * Writes the editor's in-memory edits to the host's snapshot without
   * exporting. `save` does this first; it is separate for callers that read
   * the snapshot (the timeline) and need it current.
   */
  flush(): Promise<{ revision: number }>;
  /**
   * Flushes the editor's edits and exports the result back to the .pptx on
   * disk. A flush that fails leaves the document dirty and rejects: nothing was
   * written, so nothing may be called saved.
   */
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
  /**
   * The user clicked or typed in the editor, so the selection may have moved.
   * Debounced by the embed; the caller decides whether to go and read it.
   */
  onSelectionChanged?: () => void;
  onUnavailable: (error?: string) => void;
  onReady?: () => void;
  onController?: (controller: PresentationEditorController | null) => void;
  /** Fired after the editor writes the deck back to disk. */
  onSaved?: (result: { filePath: string; revision: number }) => void;
}

const SCRIPT_TIMEOUT_MS = EDITOR_SCRIPT_TIMEOUT_MS;
/** A document swap re-attaches an already-running editor; it is not a boot. */
const SWAP_TIMEOUT_MS = EDITOR_SWAP_TIMEOUT_MS;
/**
 * A flush is one snapshot PUT, but the embed may still be mounting its
 * workbench when the first one is asked for, and it waits for that.
 */
const FLUSH_TIMEOUT_MS = EDITOR_PROBE_TIMEOUT_MS;

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

export function PresentationEditorFrame(props: PresentationEditorFrameProps) {
  const locale = useCanvasLocale() ?? getCurrentLocale();
  // The embed handshakes only on boot. Reusing its window for another token
  // closed the old host session but left the old deck visible and editable.
  return <PresentationEditorSession key={`${props.previewToken}:${locale}`} {...props} />;
}

function PresentationEditorSession({
  previewToken,
  fileName,
  onDirtyChange,
  onSelectionChanged,
  onUnavailable,
  onReady,
  onController,
  onSaved,
}: PresentationEditorFrameProps) {
  const api = useDesktopApi();
  // Canvas channel is silent until the shell host publishes. The app language
  // is already in localStorage; waiting for the channel left the first iframe
  // URL without `lang=`, so a Chinese shell still loaded an English ribbon.
  const locale = useCanvasLocale() ?? getCurrentLocale();
  const frameRef = useRef<HTMLIFrameElement>(null);
  const sessionIdRef = useRef("");
  const revisionRef = useRef(0);
  /*
   * Two reasons the deck on disk is behind, tracked apart because they clear
   * apart. The editor holds edits it has not flushed (its own save state,
   * forwarded by the embed); the host holds a snapshot it has not exported
   * (every snapshot PUT, until an export succeeds). Either one is "unsaved".
   */
  const editorHoldsEditsRef = useRef(false);
  const unexportedSnapshotRef = useRef(false);
  const reportedDirtyRef = useRef<boolean | undefined>(undefined);
  const unregisterClientToolsRef = useRef<(() => void) | undefined>(undefined);
  const disposedRef = useRef(false);
  /** The embed completed its handshake, so the boot deadline no longer applies. */
  const readyRef = useRef(false);
  const unavailableRef = useRef(false);
  const callbacksRef = useRef({ onDirtyChange, onSelectionChanged, onUnavailable, onReady, onController, onSaved });
  // One ledger for every request/reply pair with the frame (scripts, swaps);
  // see shared/embedRequests.ts.
  const requestsRef = useRef(new PendingRequests({ idPrefix: "presentation" }));
  const [componentURL, setComponentURL] = useState<string>();

  callbacksRef.current = { onDirtyChange, onSelectionChanged, onUnavailable, onReady, onController, onSaved };

  useEffect(() => {
    disposedRef.current = false;
    return () => {
      disposedRef.current = true;
    };
  }, []);

  const markUnavailable = useCallback((error?: string) => {
    if (disposedRef.current || unavailableRef.current) return;
    unavailableRef.current = true;
    callbacksRef.current.onUnavailable(error);
  }, []);

  const post = useCallback((message: PresentationHostCommand, transfer: Transferable[] = []) => {
    if (disposedRef.current) return;
    frameRef.current?.contentWindow?.postMessage(message, "*", transfer);
  }, []);

  /** Tells the parent whenever the answer to "is this deck saved?" changes. */
  const reportDirty = useCallback(() => {
    const dirty = editorHoldsEditsRef.current || unexportedSnapshotRef.current;
    if (reportedDirtyRef.current === dirty) return;
    reportedDirtyRef.current = dirty;
    callbacksRef.current.onDirtyChange?.(dirty);
  }, []);

  useEffect(() => {
    let cancelled = false;
    unavailableRef.current = false;
    void hasPresentationComponent().then((available) => {
      if (cancelled) return;
      if (!available) {
        markUnavailable("Presentation component assets are not installed.");
        return;
      }
      const configured = import.meta.env.VITE_PRESENTATION_EDITOR_URL?.trim();
      setComponentURL(withEmbedLocaleQuery(configured || DEFAULT_PRESENTATION_URL, locale));
    });
    return () => {
      cancelled = true;
    };
  }, [locale, markUnavailable]);

  const executeScript = useCallback(
    (source: string, options: { awaitSnapshotMs?: number; timeoutMs?: number } = {}) =>
      new Promise<PresentationScriptResult>((resolve, reject) => {
        if (!frameRef.current?.contentWindow) {
          reject(new Error("The presentation editor is not mounted."));
          return;
        }
        const requestId = requestsRef.current.nextId();
        requestsRef.current
          .open<PresentationScriptResult>(requestId, Math.max(options.timeoutMs ?? SCRIPT_TIMEOUT_MS, 1_000), "The presentation script timed out.")
          .then(resolve, reject);
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
        const requestId = requestsRef.current.nextId();
        requestsRef.current
          .open<number>(requestId, SWAP_TIMEOUT_MS, "Swapping the presentation document timed out.")
          .then(resolve, reject);
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

  const flushEdits = useCallback(
    () =>
      new Promise<{ revision: number }>((resolve, reject) => {
        if (!frameRef.current?.contentWindow) {
          reject(new Error("The presentation editor is not mounted."));
          return;
        }
        const requestId = requestsRef.current.nextId();
        requestsRef.current
          .open<{ revision: number }>(requestId, FLUSH_TIMEOUT_MS, "The presentation editor did not confirm the save.")
          .then(resolve, reject);
        post({ type: "presentation:flush", requestId });
      }),
    [post],
  );

  /*
   * Flush, then export. The export converts the snapshot the host holds, which
   * is only as new as the editor's last flush — and the local editor session
   * flushes on ⌘S inside its own window and on nothing else. Exporting
   * without this step wrote the deck as it was opened and then reported it
   * saved; the title the user had just typed was gone on the next open.
   *
   * A flush that fails rejects before the export. The dirty flag is not
   * touched on any failure: nothing reached the disk, so the tab keeps its dot.
   */
  const saveToDisk = useCallback(async () => {
    const sessionId = sessionIdRef.current;
    if (!sessionId) throw new Error("PPTX editor session is not ready.");
    await flushEdits();
    if (disposedRef.current) throw new Error("The presentation editor was closed.");
    const result = await api.exportPptxEditor({
      previewToken,
      sessionId,
      revision: revisionRef.current,
    });
    if (disposedRef.current) throw new Error("The presentation editor was closed.");
    revisionRef.current = result.revision;
    unexportedSnapshotRef.current = false;
    reportDirty();
    const saved = { filePath: result.filePath, revision: result.revision };
    callbacksRef.current.onSaved?.(saved);
    return saved;
  }, [flushEdits, previewToken, reportDirty]);

  useEffect(() => {
    let active = true;
    const respond = (
      requestId: string,
      result?: unknown,
      error?: unknown,
      transfer: Transferable[] = [],
    ) => {
      if (!active || disposedRef.current) return;
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
      if ("sessionId" in event && event.sessionId !== sessionIdRef.current) {
        if ("requestId" in event) respond(event.requestId, undefined, new Error("The presentation session has changed."));
        return;
      }
      switch (event.type) {
        case "presentation:embed-ready": {
          readyRef.current = true;
          if (event.protocolVersion !== PRESENTATION_EMBED_PROTOCOL_VERSION) {
            markUnavailable(
              `Unsupported Presentation protocol ${event.protocolVersion}.`,
            );
            return;
          }
          try {
            const prepared = await api.preparePptxEditor(previewToken);
            if (!active || disposedRef.current) {
              void api.closePptxEditor({ previewToken, sessionId: prepared.sessionId }).catch(() => undefined);
              return;
            }
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
            const assets = (prepared.assets ?? []).map((asset: PptxEditorAsset) => ({
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
              [content, ...assets.map((asset: { data: ArrayBuffer }) => asset.data)],
            );
            callbacksRef.current.onReady?.();
            callbacksRef.current.onController?.({
              executeScript,
              inspect: async () => {
                const { result } = await executeScript(PRESENTATION_INSPECT_SOURCE, { awaitSnapshotMs: 0 });
                return result as PresentationEditorContext;
              },
              flush: flushEdits,
              save: saveToDisk,
              session: () => ({ previewToken, sessionId: sessionIdRef.current }),
              swapDocument,
            });
          } catch (error) {
            if (active) markUnavailable(errorMessage(error));
          }
          return;
        }
        case "presentation:script-result": {
          if (event.ok) requestsRef.current.resolve(event.requestId, { result: event.result, snapshotSaved: event.snapshotSaved });
          else requestsRef.current.reject(event.requestId, new Error(event.error || "The presentation script failed."));
          return;
        }
        case "presentation:flush-result": {
          if (event.ok) requestsRef.current.resolve(event.requestId, { revision: event.revision ?? revisionRef.current });
          else requestsRef.current.reject(event.requestId, new Error(event.error || "The presentation editor could not save its edits."));
          return;
        }
        case "presentation:swap-result": {
          if (event.ok) {
            revisionRef.current = event.documentRevision ?? revisionRef.current;
            requestsRef.current.resolve(event.requestId, revisionRef.current);
          } else {
            requestsRef.current.reject(event.requestId, new Error(event.error || "Swapping the presentation document failed."));
          }
          return;
        }
        case "presentation:embed-error":
          markUnavailable(event.error);
          return;
        case "presentation:dirty-changed":
          editorHoldsEditsRef.current = event.dirty;
          reportDirty();
          return;
        case "presentation:selection-changed":
          callbacksRef.current.onSelectionChanged?.();
          return;
        case "presentation:save-snapshot":
          try {
            const result = await api.savePptxEditorSnapshot({
              previewToken,
              sessionId: event.sessionId,
              content: new Uint8Array(event.content),
              baseRevision: event.baseRevision,
              revision: event.revision,
            });
            if (!active || disposedRef.current) return;
            revisionRef.current = result.revision;
            // The snapshot is newer than the file now; only an export catches
            // the file up. The embed used to say dirty here and the host
            // trusted it, which was the one path a user's edit had to the tab
            // dot — and it only ran on a flush the user had to trigger.
            unexportedSnapshotRef.current = true;
            reportDirty();
            respond(event.requestId, result);
          } catch (error) {
            respond(event.requestId, undefined, error);
          }
          return;
        case "presentation:save-asset":
          try {
            const result = await api.savePptxEditorAsset({
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
        case "presentation:save-video":
          try {
            const result = await api.savePptxEditorVideo({
              previewToken,
              sessionId: event.sessionId,
              revision: event.revision,
              fileName: event.fileName,
              content: new Uint8Array(event.content),
            });
            respond(event.requestId, {
              fileName: result.fileName,
              path: result.filePath,
            });
          } catch (error) {
            respond(event.requestId, undefined, error);
          }
          return;
        case "presentation:export-pptx":
          try {
            const result = await api.exportPptxEditor({
              previewToken,
              sessionId: event.sessionId,
              revision: event.revision,
            });
            if (!active || disposedRef.current) return;
            revisionRef.current = result.revision;
            const artifact = await api.readArtifactFile(previewToken);
            if (!active || disposedRef.current) return;
            const data = toTransferableBuffer(artifact.data);
            unexportedSnapshotRef.current = false;
            reportDirty();
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
      if (!active || disposedRef.current) return;
      if (event.source !== frameRef.current?.contentWindow) return;
      if (!isPresentationEmbedEvent(event.data)) return;
      void handleRequest(event.data);
    };
    window.addEventListener("message", onMessage);
    return () => {
      active = false;
      window.removeEventListener("message", onMessage);
    };
  }, [executeScript, fileName, flushEdits, markUnavailable, post, previewToken, reportDirty, saveToDisk]);

  /**
   * The embed has to say hello, or say why not.
   *
   * Every failure this component reports is reached from a message the embed
   * sends — so an embed that never boots reports nothing at all. The frame
   * mounts, the iframe loads an empty document, and the deck area sits blank
   * with no error anywhere: not on screen, not in the console, not in the log.
   * That is the state a packaged build was stuck in, and it is invisible
   * precisely because every code path that could have spoken up is downstream
   * of the handshake that never happened.
   *
   * So the handshake itself gets a deadline. What is wrong when this fires is
   * not knowable from here — a missing asset, a runtime that threw on boot, an
   * HTTP endpoint the packaged app does not serve — so the message says what
   * was observed rather than guessing a cause.
   */
  useEffect(() => {
    if (!componentURL || readyRef.current) return;
    const timer = window.setTimeout(() => {
      if (readyRef.current || disposedRef.current) return;
      markUnavailable(
        "The presentation editor did not start. Its window loaded but never reported ready — "
          + "usually a missing or broken presentation runtime in this build.",
      );
    }, EMBED_HANDSHAKE_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [componentURL, markUnavailable]);

  useEffect(
    () => () => {
      const sessionId = sessionIdRef.current;
      sessionIdRef.current = "";
      revisionRef.current = 0;
      editorHoldsEditsRef.current = false;
      unexportedSnapshotRef.current = false;
      reportedDirtyRef.current = undefined;
      unregisterClientToolsRef.current?.();
      unregisterClientToolsRef.current = undefined;
      callbacksRef.current.onController?.(null);
      // Swap requests used to be left dangling here; both kinds now settle.
      requestsRef.current.rejectAll(new Error("The presentation editor was closed."));
      if (sessionId) {
        void api
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
