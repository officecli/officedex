import { useCallback, useEffect, useRef, useState } from "react";
import { PendingRequests } from "../../shared/embedRequests";
import {
  isWriterEmbedEvent,
  WRITER_EMBED_PROTOCOL_VERSION,
  type WriterEmbedEvent,
  type WriterHostCommand,
  type WriterSelectionContent,
  type WriterSelectionSummary,
  type WriterToolbarProfile,
} from "../../shared/writerProtocol";
import { getCurrentLocale } from "../i18n";
import { useCanvasLocale, withEmbedLocaleQuery } from "../../shell/editor/canvasLocale";
import { useDesktopApi } from "../services/desktopApi";
import { registerActiveEditorClientTools } from "../activeEditorClientTools";
import { errorMessage } from "../utils/values";
import { EMBED_HANDSHAKE_TIMEOUT_MS } from "../constants/timing";
import { isSaveConflict, useIdleAutosave } from "../workbench/idleAutosave";

const DEFAULT_WRITER_URL = "/writer/index.html";
const WRITER_MANIFEST_URL = "/writer/officedex-component.json";

/**
 * How long the host waits for the embed to export a DOCX. Writer runs the
 * export through word2mow, whose own conversion budget is 120s.
 */
const SAVE_TIMEOUT_MS = 150_000;

/** Selection round-trips are a postMessage hop; a slow one means a wedged embed. */
const SELECTION_TIMEOUT_MS = 5_000;

/** What the host assumes before the embed has reported anything. */
const UNKNOWN_SELECTION: WriterSelectionSummary = { empty: true, collapsed: true };

export interface WriterEditorFrameProps {
  onAgentReady?: (editor: WriterAgentEditor | null) => void;
  previewToken: string;
  fileName: string;
  /**
   * Which toolbar Writer lays out, `full` (its two-row ribbon) unless said
   * otherwise. The initial profile travels on the URL; subsequent changes use
   * the host channel so switching Chat/Local preserves unsaved edits.
   */
  toolbarProfile?: WriterToolbarProfile;
  /** Opens the document without a save path; Writer hides its save action. */
  readOnly?: boolean;
  onDirtyChange?: (dirty: boolean) => void;
  /** Where the caret is, so the host can scope an instruction to it. */
  onSelectionChange?: (selection: WriterSelectionSummary) => void;
  /** The Writer component is missing or spoke an unsupported protocol. */
  onUnavailable: (error?: string) => void;
  onReady?: () => void;
  /** Fired after the host writes the document back to disk. */
  onSaved?: (result: { filePath: string; sha256: string; saveAsCopy: boolean }) => void;
  /**
   * The host could not write the document back, or the embed could not export
   * it. Fires for every save, not only the ones the host asked for: the idle
   * autosave and the save control inside Writer's own frame both land in
   * `writer:save`, and without this their refusals were visible to nobody —
   * the embed shows nothing, and the host's only answer went to a pending
   * request that, for those saves, does not exist.
   */
  onSaveFailed?: (error: string) => void;
  onFlushReady?: (flush: (() => Promise<void>) | null) => void;
  /** Forwarded to the shared idle autosave window; tests only. */
  autosaveIdleMs?: number;
}

export interface WriterAgentEditor {
  capture(scope: "selection" | "document"): Promise<{ id: string; text: string; scope: "selection" | "document" }>;
  apply(id: string, edits: { query: string; replacement: string }[]): Promise<{ replaced: number }>;
  save(): Promise<unknown>;
  /**
   * The selection with its words, without tracking anything: unlike
   * `capture("selection")` this leaves the scope a pending `apply` holds
   * exactly where it was, so it is safe to call on every selection.
   */
  readSelection(): Promise<WriterSelectionContent>;
}

/**
 * Puts the toolbar profile on the embed URL. `full` is Writer's default, so
 * it is left off and the URL stays exactly what it was before profiles existed.
 */
export function withWriterToolbarProfile(url: string, profile: WriterToolbarProfile | undefined): string {
  if (profile !== "compact") return url;
  const hashAt = url.indexOf("#");
  const hash = hashAt >= 0 ? url.slice(hashAt) : "";
  const withoutHash = hashAt >= 0 ? url.slice(0, hashAt) : url;
  const joiner = withoutHash.includes("?") ? "&" : "?";
  return `${withoutHash}${joiner}toolbarProfile=compact${hash}`;
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
  toolbarProfile = "full",
  readOnly = false,
  onDirtyChange,
  onSelectionChange,
  onUnavailable,
  onReady,
  onSaved,
  onSaveFailed,
  onAgentReady,
  onFlushReady,
  autosaveIdleMs,
}: WriterEditorFrameProps) {
  const api = useDesktopApi();
  const locale = useCanvasLocale() ?? getCurrentLocale();
  const frameRef = useRef<HTMLIFrameElement>(null);
  const fingerprintRef = useRef<string | undefined>(undefined);
  const unregisterClientToolsRef = useRef<(() => void) | undefined>(undefined);
  const disposedRef = useRef(false);
  /** The embed completed its handshake, so the boot deadline no longer applies. */
  const readyRef = useRef(false);
  const unavailableRef = useRef(false);
  const callbacksRef = useRef({ onDirtyChange, onSelectionChange, onUnavailable, onReady, onSaved, onSaveFailed, onAgentReady });
  const onFlushReadyRef = useRef(onFlushReady);
  const dirtyRef = useRef(false);
  const loadedRef = useRef(false);
  const conflictRef = useRef(false);
  // The agent's read_selection tool answers from here rather than a round trip:
  // the embed pushes every change already, so a pull would only add latency.
  const selectionRef = useRef<WriterSelectionSummary>(UNKNOWN_SELECTION);
  const toolbarProfileRef = useRef(toolbarProfile);
  toolbarProfileRef.current = toolbarProfile;
  // Host-initiated saves (the docx.editor.save agent tool) wait here until the
  // embed has exported and the host has written the file.
  const requestsRef = useRef(new PendingRequests({ idPrefix: "writer" }));
  const [componentURL, setComponentURL] = useState<string>();

  callbacksRef.current = { onDirtyChange, onSelectionChange, onUnavailable, onReady, onSaved, onSaveFailed, onAgentReady };
  onFlushReadyRef.current = onFlushReady;

  useEffect(() => {
    disposedRef.current = false;
    return () => {
      disposedRef.current = true;
    };
  }, []);

  const markUnavailable = useCallback((error?: string) => {
    if (unavailableRef.current) return;
    unavailableRef.current = true;
    callbacksRef.current.onAgentReady?.(null);
    callbacksRef.current.onUnavailable(error);
  }, []);

  const post = useCallback((message: WriterHostCommand, transfer: Transferable[] = []) => {
    frameRef.current?.contentWindow?.postMessage(message, "*", transfer);
  }, []);

  useEffect(() => {
    if (readyRef.current) post({ type: "writer:toolbar-profile", profile: toolbarProfile });
  }, [post, toolbarProfile]);

  useEffect(() => {
    let cancelled = false;
    unavailableRef.current = false;
    void hasWriterComponent().then((available) => {
      if (cancelled) return;
      if (!available) {
        markUnavailable("Writer component assets are not installed.");
        return;
      }
      const configured = import.meta.env.VITE_WRITER_EDITOR_URL?.trim();
      setComponentURL(
        withWriterToolbarProfile(
          withEmbedLocaleQuery(configured || DEFAULT_WRITER_URL, locale),
          toolbarProfileRef.current,
        ),
      );
    });
    return () => {
      cancelled = true;
    };
  }, [locale, markUnavailable]);

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

  const autosave = useIdleAutosave({
    idleMs: autosaveIdleMs,
    canSchedule: () => loadedRef.current && !readOnly,
    isDirty: () => dirtyRef.current,
    save: async () => {
      await requestSave(false);
    },
  });

  /**
   * Pulls the selection, words included, from the embed rather than trusting
   * the last push. An embed from before `text` was added answers with the
   * summary alone; that reads as no words rather than as a broken reply.
   */
  const requestSelection = useCallback(
    () =>
      new Promise<WriterSelectionContent>((resolve, reject) => {
        if (!frameRef.current?.contentWindow) {
          reject(new Error("The Writer editor is not mounted."));
          return;
        }
        const requestId = requestsRef.current.nextId();
        requestsRef.current
          .open<WriterSelectionSummary & { text?: unknown }>(
            requestId,
            SELECTION_TIMEOUT_MS,
            "Reading the selection timed out.",
          )
          .then(
            (result) => resolve({ ...result, text: typeof result.text === "string" ? result.text : "" }),
            reject,
          );
        post({ type: "writer:read-selection", requestId });
      }),
    [post],
  );

  /** Runs a find-and-replace inside the embed and reports how many it changed. */
  const requestReplaceText = useCallback(
    (query: string, replacement: string, scope: "selection" | "document") =>
      new Promise<{ replaced: number }>((resolve, reject) => {
        if (!frameRef.current?.contentWindow) {
          reject(new Error("The Writer editor is not mounted."));
          return;
        }
        const requestId = requestsRef.current.nextId();
        requestsRef.current
          .open<{ replaced?: number }>(
            requestId,
            SAVE_TIMEOUT_MS,
            "The replacement timed out.",
          )
          .then((result) => resolve({ replaced: result?.replaced ?? 0 }), reject);
        post({ type: "writer:replace-text", requestId, query, replacement, scope });
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
          readyRef.current = true;
          if (event.protocolVersion !== WRITER_EMBED_PROTOCOL_VERSION) {
            markUnavailable(`Unsupported Writer protocol ${event.protocolVersion}.`);
            return;
          }
          try {
            const artifact = await api.readArtifactFile(previewToken);
            if (disposedRef.current) return;
            fingerprintRef.current = artifact.sha256;
            unregisterClientToolsRef.current?.();
            unregisterClientToolsRef.current = registerActiveEditorClientTools("docx-editor", {
              "docx.editor.save": async (arguments_) => {
                const result = await requestSave(arguments_.save_as_copy === true);
                return { file_path: result.filePath, sha256: result.sha256, saved: true };
              },
              "docx.editor.read_selection": async () => {
                const selection = await requestSelection();
                return {
                  empty: selection.empty,
                  collapsed: selection.collapsed,
                  paragraphs: selection.paragraphs ?? null,
                  text: selection.text,
                };
              },
              "docx.editor.replace_text": async (arguments_) => {
                const query = typeof arguments_.query === "string" ? arguments_.query : "";
                const replacement =
                  typeof arguments_.replacement === "string" ? arguments_.replacement : "";
                if (!query) throw new Error("docx.editor.replace_text needs a non-empty query.");
                const scope = arguments_.scope === "selection" ? "selection" : "document";
                const result = await requestReplaceText(query, replacement, scope);
                return { replaced: result.replaced, scope };
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
          post({ type: "writer:toolbar-profile", profile: toolbarProfileRef.current });
          loadedRef.current = true;
          dirtyRef.current = false;
          conflictRef.current = false;
          onFlushReadyRef.current?.(readOnly ? null : autosave.flush);
          callbacksRef.current.onAgentReady?.({
            capture: (scope) => {
              const requestId = requestsRef.current.nextId();
              const result = requestsRef.current.open<{ id: string; text: string; scope: "selection" | "document" }>(requestId, 15_000, "Reading document content timed out. Update the Writer component and retry.");
              post({ type: "writer:capture-edit", requestId, scope });
              return result;
            },
            apply: (id, edits) => {
              if (readOnly) return Promise.reject(new Error("This document is read-only."));
              const requestId = requestsRef.current.nextId();
              const result = requestsRef.current.open<{ replaced: number }>(requestId, 30_000, "Applying document edits timed out.");
              post({ type: "writer:apply-edit", requestId, id, edits });
              return result;
            },
            save: () => requestSave(false),
            readSelection: requestSelection,
          });
          callbacksRef.current.onDirtyChange?.(false);
          callbacksRef.current.onReady?.();
          return;
        case "writer:embed-error":
          markUnavailable(event.error);
          return;
        case "writer:dirty-changed":
          dirtyRef.current = event.dirty;
          callbacksRef.current.onDirtyChange?.(event.dirty);
          if (event.dirty) autosave.schedule();
          else autosave.cancel();
          return;
        case "writer:selection-changed":
          selectionRef.current = event.selection;
          callbacksRef.current.onSelectionChange?.(event.selection);
          return;
        case "writer:save": {
          const saveAsCopy = event.saveAsCopy === true;
          const recoveryOnly = conflictRef.current && !saveAsCopy;
          try {
            // App.SaveDocx keeps its existing contract: it validates the ZIP
            // package, resolves the destination, and rejects the write when the
            // file changed underneath us since we read it.
            const result = await api.saveDocx(new Uint8Array(event.content), fileName, {
              previewToken,
              expectedSHA256: fingerprintRef.current,
              saveAsCopy,
              ...(recoveryOnly ? { recoveryOnly: true } : {}),
            });
            if (recoveryOnly) {
              const conflict = new Error("Edits retained in Settings > Files > View drafts. The source still has an external conflict.");
              respond(event.requestId, undefined, conflict);
              requestsRef.current.reject(event.requestId, conflict);
              return;
            }
            if (!saveAsCopy) {
              fingerprintRef.current = result.sha256;
              dirtyRef.current = false;
              conflictRef.current = false;
              autosave.cancel();
              callbacksRef.current.onDirtyChange?.(false);
            }
            callbacksRef.current.onSaved?.({ ...result, saveAsCopy });
            respond(event.requestId, result);
            requestsRef.current.resolve(event.requestId, result);
          } catch (error) {
            if (isSaveConflict(error)) conflictRef.current = true;
            // Told before the request is settled, so a host-initiated save sees
            // the file marked failed by the time its own rejection lands.
            if (!saveAsCopy) callbacksRef.current.onSaveFailed?.(errorMessage(error));
            respond(event.requestId, undefined, error);
            requestsRef.current.reject(event.requestId, new Error(errorMessage(error)));
          }
          return;
        }
        // Selection reads and replacements answer here; saves have their own
        // event because they carry document bytes.
        case "writer:response":
          if (event.ok) requestsRef.current.resolve(event.requestId, event.result);
          else {
            requestsRef.current.reject(
              event.requestId,
              new Error(event.error || "The Writer editor rejected the request."),
            );
          }
          return;
        case "writer:save-failed": {
          const error = event.error || "The Writer editor could not export the document.";
          callbacksRef.current.onSaveFailed?.(error);
          requestsRef.current.reject(event.requestId, new Error(error));
        }
      }
    };

    const onMessage = (event: MessageEvent) => {
      if (event.source !== frameRef.current?.contentWindow) return;
      if (!isWriterEmbedEvent(event.data)) return;
      void handleEvent(event.data);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [api, autosave.cancel, autosave.flush, autosave.schedule, fileName, markUnavailable, post, previewToken, readOnly, requestReplaceText, requestSave, requestSelection]);

  /**
   * The embed has to say hello, or say why not.
   *
   * Every failure this component reports is reached from a message the embed
   * sends, so an embed that never boots reports nothing at all: the iframe
   * loads an empty document and the page area sits blank with no error
   * anywhere. That is exactly how a missing host runtime read from the outside
   * — Writer threw during module evaluation, inside its own graph, where no
   * host callback can see it — and it cost a full investigation to find.
   *
   * What is wrong when this fires is not knowable from here, so the message
   * says what was observed rather than guessing a cause.
   */
  useEffect(() => {
    if (!componentURL || readyRef.current) return;
    const timer = window.setTimeout(() => {
      if (readyRef.current || disposedRef.current) return;
      markUnavailable(
        "The Word editor did not start. Its window loaded but never reported ready — "
          + "usually a missing or broken Writer runtime in this build.",
      );
    }, EMBED_HANDSHAKE_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [componentURL, markUnavailable]);

  useEffect(
    () => () => {
      fingerprintRef.current = undefined;
      loadedRef.current = false;
      dirtyRef.current = false;
      conflictRef.current = false;
      autosave.cancel();
      onFlushReadyRef.current?.(null);
      callbacksRef.current.onAgentReady?.(null);
      selectionRef.current = UNKNOWN_SELECTION;
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
