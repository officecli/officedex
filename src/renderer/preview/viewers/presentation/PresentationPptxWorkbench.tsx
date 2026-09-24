import { agentHistoryKey, useAgentHistory, type HistoryCodec } from "../../../workbench/useAgentHistory";
import { AgentMessage } from "../../../workbench/AgentMessage";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { Button, Tooltip } from "@vo-ui/backend";
import {
  AlertCircle,
  Check,
  Loader2,
  History,
  ArrowUp,
  FolderClosed,
  AlignLeft,
  LayoutTemplate,
  Palette,
  Presentation,
} from "lucide-react";
import { toast } from "../../../ui";
import { useDesktopApi } from "../../../services/desktopApi";
import { useT } from "../../../i18n";
import type {
  PlanPptxJSResult,
  PlanPptxJSTurn,
} from "../../../../shared/types";
import {
  buildPresentationPptxEmbedUrl,
  createPresentationPptxChannel,
  PPTX_CONVERSION_GAP_CODE,
  PRESENTATION_PPTX_PROTOCOL,
  type PresentationPptxEditorContext,
} from "../../../../shared/presentationPptxProtocol";
import {
  PresentationPptxEmbedClient,
  PresentationPptxEmbedError,
  type PresentationPptxEmbedState,
} from "./PresentationPptxEmbedClient";
import {
  VibeReplaySequencer,
  type VibeReplayFeed,
  type VibeReplayStatus,
} from "../../../presentation/vibeReplay";
import { imageProgressFromOps } from "../../../presentation/pptxProgress";
import {
  buildSelectSlideScript,
  focusSlideAfterEdit,
} from "../../../presentation/pptxEditFocus";
import type {
  PresentationEditorController,
  PresentationScriptResult,
} from "../../../presentation/PresentationEditorFrame";
import { registerActiveEditorClientTools } from "../../../activeEditorClientTools";
import { OfficeWorkbenchLayout } from "../../../workbench/OfficeWorkbenchLayout";
import {
  AUTOSAVE_IDLE_MS,
  SOURCE_CHANGED_MARKER,
  useIdleAutosave,
} from "../../../workbench/idleAutosave";

export interface PresentationPptxWorkbenchProps {
  editorBaseUrl: string;
  previewToken: string;
  fileName: string;
  /** Mount the Presentation editor in its embedded read-only preview mode. */
  readOnly?: boolean;
  /** Absolute path of the artifact; edits are saved back here. */
  filePath?: string;
  /** Live generation feed executed inside this editor through PowerPoint.run. */
  live?: VibeReplayFeed;
  /** Called when the editor cannot be started; the parent may fall back to a read-only preview. */
  onEditorUnavailable?: (reason: string) => void;
  /** Overrides AUTOSAVE_IDLE_MS. Tests use it; production leaves it unset. */
  autosaveIdleMs?: number;
  /** Clears any parent-level failure state after a retry opens the editor. */
  onEditorReady?: () => void;
  onDirtyChange?: (dirty: boolean) => void;
  onFlushReady?: (flush: (() => Promise<void>) | null) => void;
  /**
   * Debug affordance: replay this deck's generation from a blank draft. The
   * host owns it because restarting a replay means a new live draft and a new
   * preview grant, which live above this workbench. Omitted when the deck on
   * screen has no op stream to replay.
   */
  onReplayDemo?: () => void;
  /** Closes the surface this workbench is embedded in. */
  onRequestClose?: () => void;
  onOpenExternal?: () => void;
  /** Degraded-mode strip the parent owns, rendered under the title bar. */
  notice?: ReactNode;
  /** Injected for tests. */
  createClient?: (options: {
    channel: string;
    getTargetWindow: () => Window | null;
  }) => PresentationPptxEmbedClient;
}

type EditorStatus =
  | { kind: "fetching" }
  | { kind: "booting" }
  | { kind: "importing" }
  | { kind: "ready"; fileId: string }
  | { kind: "detached" }
  // `gap` is a valid deck the converter cannot fully represent yet. It is not
  // an error in the file, and reloading will not change the outcome, so it
  // reads differently and offers a different way out.
  | { kind: "gap"; message: string }
  | { kind: "error"; message: string };

/**
 * A save that did not land. `conflict` means the file on disk is no longer the
 * one this editor opened -- the host refuses to overwrite it, and no retry will
 * change that -- so it reads differently and offers a different way out.
 */
type SaveFailure = { message: string; conflict: boolean; detail?: string };

function saveErrorDetail(error: unknown): string | undefined {
  const detail = (error as { detail?: unknown } | null)?.detail;
  return typeof detail === "string" ? detail : undefined;
}

type TurnStage =
  | "inspecting"
  | "planning"
  | "awaiting-confirmation"
  | "executing"
  | "exporting"
  | "saving"
  | "done"
  | "failed"
  | "cancelled"
  | "interrupted";

interface ConversationTurn {
  archived?: boolean;
  id: string;
  prompt: string;
  stage: TurnStage;
  plan?: PlanPptxJSResult;
  context?: PresentationPptxEditorContext;
  error?: string;
  /** Stage in which the failure happened; drives what "retry" means. */
  failedStage?: Exclude<TurnStage, "done" | "failed" | "cancelled" | "interrupted">;
  savedPath?: string;
}

const turnHistoryCodec: HistoryCodec<ConversationTurn> = {
  read: (value) => Array.isArray(value) ? value.filter((turn) => turn && typeof turn.id === "string" && typeof turn.prompt === "string").map((turn) => ({
    id: turn.id, prompt: turn.prompt, archived: true,
    stage: ["done", "failed", "cancelled"].includes(turn.stage) ? turn.stage : "interrupted",
    error: typeof turn.error === "string" ? turn.error : undefined,
    savedPath: typeof turn.savedPath === "string" ? turn.savedPath : undefined,
    plan: turn.plan && typeof turn.plan.summary === "string" ? { summary: turn.plan.summary, source: "", warnings: [], requires_confirmation: false } : undefined,
  })) : [],
  write: (turns) => turns.map(({ id, prompt, stage, plan, error, savedPath }) => ({
    id, prompt, stage, error, savedPath, ...(plan ? { plan: { summary: plan.summary } } : {}),
  })),
};

const MAX_HISTORY_TURNS = 6;

function describeSelection(
  context: PresentationPptxEditorContext | null,
  t: (key: string, vars?: Record<string, string | number>) => string,
): string {
  if (!context) return t("pptx.agent.selectionUnknown");
  if (context.selectedShapes.length > 0) {
    const shapeById = new Map<string, string>();
    for (const slide of context.slides) {
      for (const shape of slide.shapes) {
        const text = (shape.text ?? "").trim();
        shapeById.set(
          shape.id,
          text
            ? `${shape.name || shape.type}: “${text.slice(0, 40)}${text.length > 40 ? "…" : ""}”`
            : shape.name || shape.type,
        );
      }
    }
    const items = context.selectedShapes
      .map((shape) => shapeById.get(shape.id) ?? shape.name ?? shape.type)
      .slice(0, 4);
    const suffix =
      context.selectedShapes.length > 4
        ? ` +${context.selectedShapes.length - 4}`
        : "";
    return t("pptx.agent.selectionShapes", {
      items: items.join("、") + suffix,
    });
  }
  if (context.selectedSlideIds.length > 0) {
    return t("pptx.agent.selectionSlides", {
      count: context.selectedSlideIds.length,
    });
  }
  return t("pptx.agent.selectionNone");
}

export default function PresentationPptxWorkbench({
  editorBaseUrl,
  previewToken,
  fileName,
  readOnly = false,
  filePath,
  live,
  onEditorUnavailable,
  autosaveIdleMs,
  onEditorReady,
  onDirtyChange,
  onFlushReady,
  onReplayDemo,
  onRequestClose,
  onOpenExternal,
  notice,
  createClient,
}: PresentationPptxWorkbenchProps) {
  const api = useDesktopApi();
  const t = useT();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const channel = useMemo(() => createPresentationPptxChannel(), []);
  const embedUrl = useMemo(
    () => buildPresentationPptxEmbedUrl(editorBaseUrl, channel, readOnly ? "preview" : undefined),
    [editorBaseUrl, channel, readOnly],
  );
  const clientRef = useRef<PresentationPptxEmbedClient | null>(null);
  const replayRef = useRef<VibeReplaySequencer | null>(null);
  // Which (task, document, editor session) the live sequencer was built for.
  const replayIdentityRef = useRef<string | undefined>(undefined);
  const [reloadToken, setReloadToken] = useState(0);
  const [editorStatus, setEditorStatus] = useState<EditorStatus>({
    kind: "fetching",
  });
  const [selectionContext, setSelectionContext] =
    useState<PresentationPptxEditorContext | null>(null);
  const [turns, setTurns] = useAgentHistory(agentHistoryKey("pptx", filePath), turnHistoryCodec);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [replayStatus, setReplayStatus] = useState<VibeReplayStatus>();
  const imageProgress = useMemo(
    () => (live ? imageProgressFromOps(live.ops) : undefined),
    [live],
  );
  const busyRef = useRef(false);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const dirtyRef = useRef(false);
  // The ref drives the save queue (it has to read the latest value inside
  // callbacks); this mirrors it for the title bar's save indicator.
  const [dirty, setDirty] = useState(false);
  const saveInFlightRef = useRef(false);
  const savePendingRef = useRef(false);
  const savePromiseRef = useRef<Promise<void> | null>(null);
  // A conflict does not resolve itself, so retrying on every keystroke only
  // burns a mop-convert run per character. Autosave stays parked until the
  // document is reopened, which is what clears this state by remounting.
  const conflictRef = useRef(false);
  const [saveFailure, setSaveFailure] = useState<SaveFailure | null>(null);
  const [savingCopy, setSavingCopy] = useState(false);
  const dirtyVersionRef = useRef(0);
  const unregisterClientToolsRef = useRef<(() => void) | null>(null);
  const filePathRef = useRef(filePath);
  const fileNameRef = useRef(fileName);
  const editorStatusRef = useRef(editorStatus);
  const onDirtyChangeRef = useRef(onDirtyChange);
  const onEditorReadyRef = useRef(onEditorReady);
  const onFlushReadyRef = useRef(onFlushReady);
  filePathRef.current = filePath;
  fileNameRef.current = fileName;
  editorStatusRef.current = editorStatus;
  onDirtyChangeRef.current = onDirtyChange;
  onEditorReadyRef.current = onEditorReady;
  onFlushReadyRef.current = onFlushReady;

  const updateTurn = useCallback(
    (id: string, patch: Partial<ConversationTurn>) => {
      setTurns((prev) =>
        prev.map((turn) => (turn.id === id ? { ...turn, ...patch } : turn)),
      );
    },
    [setTurns],
  );

  const setBusyState = useCallback((value: boolean) => {
    busyRef.current = value;
    setBusy(value);
  }, []);

  /**
   * `allowMissingPath` lets a deck that has no local file go to Downloads;
   * `asCopy` sends it there even when it does have one, which is how a
   * conflicted deck keeps its edits without overwriting the changed original.
   */
  const saveCurrentToDisk = useCallback(async ({
    allowMissingPath = false,
    asCopy = false,
  }: { allowMissingPath?: boolean; asCopy?: boolean } = {}) => {
    const client = clientRef.current;
    if (!client || editorStatusRef.current.kind !== "ready")
      throw new Error("The presentation editor is not ready.");
    const targetPath = asCopy ? undefined : filePathRef.current;
    if (!targetPath && !allowMissingPath && !asCopy)
      throw new Error("The presentation has no local target path.");
    const version = dirtyVersionRef.current;
    const exported = await client.export();
    const savedPath = await api.savePptx(
      new Uint8Array(exported.buffer),
      fileNameRef.current,
      targetPath ? { targetFilePath: targetPath } : {},
    );
    // A copy leaves the original untouched, so the document is still unsaved
    // with respect to the file it was opened from.
    if (!asCopy && version === dirtyVersionRef.current) {
      dirtyRef.current = false;
      setDirty(false);
      onDirtyChangeRef.current?.(false);
    }
    if (!asCopy) setSaveFailure(null);
    const recordLog = api.recordRendererLog;
    if (typeof recordLog === "function") {
      void recordLog({
        source: "presentation-pptx-autosave",
        event: "saved",
        details: { filePath: savedPath, revision: exported.revision ?? 0 },
      }).catch(() => {});
    }
  }, []);

  const enqueueSave = useCallback(
    (allowMissingPath = false): Promise<void> => {
      savePendingRef.current = true;
      if (!saveInFlightRef.current) {
        saveInFlightRef.current = true;
        savePromiseRef.current = (async () => {
          do {
            savePendingRef.current = false;
            try {
              await saveCurrentToDisk({ allowMissingPath });
            } catch (error) {
              const message =
                error instanceof Error ? error.message : String(error);
              const conflict = message.includes(SOURCE_CHANGED_MARKER);
              // A failed save used to leave nothing on screen: the document
              // simply stayed dirty until the close prompt mentioned it. With
              // the host refusing conflicting writes that silence became a
              // deck that never saves and never says why.
              if (conflict) conflictRef.current = true;
              setSaveFailure({ message, conflict, detail: saveErrorDetail(error) });
              const recordLog = api.recordRendererLog;
              if (typeof recordLog === "function") {
                void recordLog({
                  source: "presentation-pptx-autosave",
                  event: "failed",
                  details: { error: message, conflict, detail: saveErrorDetail(error) },
                }).catch(() => {});
              }
              throw error;
            }
          } while (savePendingRef.current);
        })().finally(() => {
          saveInFlightRef.current = false;
          savePromiseRef.current = null;
        });
      }
      return savePromiseRef.current ?? Promise.resolve();
    },
    [saveCurrentToDisk],
  );

  const {
    schedule: scheduleSave,
    cancel: cancelScheduledSave,
    flush: flushPendingSave,
  } = useIdleAutosave({
    idleMs: autosaveIdleMs ?? AUTOSAVE_IDLE_MS,
    canSchedule: () => Boolean(filePathRef.current) && !conflictRef.current,
    isDirty: () => dirtyRef.current || savePendingRef.current,
    save: () => enqueueSave(),
  });

  /**
   * Writes the current deck to Downloads. It is the way out of a conflict: the
   * edits survive without overwriting whatever now sits at the original path.
   */
  const saveAsCopy = useCallback(async () => {
    setSavingCopy(true);
    try {
      await saveCurrentToDisk({ asCopy: true });
      conflictRef.current = false;
      setSaveFailure(null);
    } catch (error) {
      setSaveFailure({
        message: error instanceof Error ? error.message : String(error),
        conflict: conflictRef.current,
        detail: saveErrorDetail(error),
      });
    } finally {
      setSavingCopy(false);
    }
  }, [saveCurrentToDisk]);

  // Boot: create the client, fetch the bytes, wait for the editor shell, load, wait for the editor.
  useLayoutEffect(() => {
    if (!embedUrl) {
      setEditorStatus({
        kind: "error",
        message: t("pptx.agent.editorUnavailableNotConfigured"),
      });
      onEditorUnavailable?.("not-configured");
      return;
    }
    let cancelled = false;
    const factory =
      createClient ??
      ((options: { channel: string; getTargetWindow: () => Window | null }) =>
        new PresentationPptxEmbedClient(options));
    const client = factory({
      channel,
      getTargetWindow: () => iframeRef.current?.contentWindow ?? null,
    });
    clientRef.current = client;
    const detach = client.attach();
    const announceHost = () =>
      iframeRef.current?.contentWindow?.postMessage(
        {
      protocol: PRESENTATION_PPTX_PROTOCOL,
          channel,
          type: "officedex:pptx-host-ready",
        },
        "*",
      );
    const hostReadyTimer = window.setInterval(announceHost, 500);
    announceHost();
    const unsubscribe = client.subscribe((state: PresentationPptxEmbedState) => {
      if (cancelled) return;
      if (state.phase === "editor-ready" && state.fileId)
        setEditorStatus({ kind: "ready", fileId: state.fileId });
      else if (state.phase === "detached")
        setEditorStatus({ kind: "detached" });
    });
    const unsubscribeDirty = client.subscribeDirty((dirty) => {
      if (cancelled) return;
      dirtyRef.current = dirty;
      setDirty(dirty);
      dirtyVersionRef.current += 1;
      if (!readOnly) {
        onDirtyChange?.(dirty);
        if (dirty) scheduleSave();
      }
    });
    setEditorStatus({ kind: "fetching" });
    setSelectionContext(null);

    (async () => {
      const result = await api.readArtifactFile(previewToken);
      const data = result?.data;
      if (!data || data.byteLength === 0)
        throw new Error("The presentation file is empty.");
      const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
      const copy = new Uint8Array(bytes.byteLength);
      copy.set(bytes);
      if (cancelled) return;
      setEditorStatus({ kind: "booting" });
      await client.waitForReady();
      window.clearInterval(hostReadyTimer);
      if (cancelled) return;
      setEditorStatus({ kind: "importing" });
      await client.load(copy.buffer, fileName);
      if (cancelled) return;
      const fileId = await client.waitForEditorReady();
      if (cancelled) return;
      setEditorStatus({ kind: "ready", fileId });
      onEditorReadyRef.current?.();
      dirtyRef.current = false;
      setDirty(false);
      dirtyVersionRef.current = 0;
      if (!readOnly) onDirtyChangeRef.current?.(false);
      unregisterClientToolsRef.current?.();
      unregisterClientToolsRef.current = readOnly
        ? null
        : registerActiveEditorClientTools("pptx-editor", {
            "pptx.editor.save": async () => {
              await enqueueSave(true);
              return {
                saved: true,
                file_path: filePathRef.current ?? fileNameRef.current,
                revision: client.getState().revision ?? 0,
              };
            },
          });
      onFlushReadyRef.current?.(readOnly ? null : flushPendingSave);
      try {
        setSelectionContext(await client.inspect());
      } catch {
        // Selection is advisory; the send flow inspects again.
      }
    })().catch((error: unknown) => {
      if (cancelled) return;
      const message = error instanceof Error ? error.message : String(error);
      const isGap =
        error instanceof PresentationPptxEmbedError &&
        error.code === PPTX_CONVERSION_GAP_CODE;
      setEditorStatus({ kind: isGap ? "gap" : "error", message });
      onEditorUnavailable?.(isGap ? "conversion-gap" : message);
    });

    return () => {
      cancelled = true;
      cancelScheduledSave();
      unsubscribe();
      unsubscribeDirty();
      unregisterClientToolsRef.current?.();
      unregisterClientToolsRef.current = null;
      onFlushReadyRef.current?.(null);
      detach();
      window.clearInterval(hostReadyTimer);
      client.dispose();
      if (clientRef.current === client) clientRef.current = null;
    };
    // `t` is stable per locale; a locale switch must not restart the editor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [embedUrl, channel, previewToken, fileName, reloadToken, createClient, readOnly]);

  useEffect(() => {
    const client = clientRef.current;
    if (
      readOnly ||
      !live ||
      !client ||
      editorStatus.kind !== "ready" ||
      client.getState().phase !== "editor-ready"
    )
      return;
    // One sequencer belongs to one (task, document, editor session). Any of the
    // three changing invalidates the controller closure below — it captures
    // this client and this file id — and mixing two tasks' op streams in one
    // sequencer draws the wrong deck. Retire the old one instead of reusing it.
    const identity = `${live.taskId}::${filePath ?? fileName}::${editorStatus.fileId}`;
    if (replayRef.current && replayIdentityRef.current !== identity) {
      replayRef.current.dispose();
      replayRef.current = null;
    }
    if (!replayRef.current) {
      replayIdentityRef.current = identity;
      const controller: PresentationEditorController = {
        async executeScript(source): Promise<PresentationScriptResult> {
          const value = await client.executeJs(source);
          if (value && typeof value === "object" && "result" in value) {
            return value as PresentationScriptResult;
          }
          return { result: value, snapshotSaved: false };
        },
        async inspect() {
          return (await client.inspect()) as never;
        },
        async save() {
          const exported = await client.export();
          const savedPath = await api.savePptx(
            new Uint8Array(exported.buffer),
            fileName,
            filePath ? { targetFilePath: filePath } : {},
          );
          return { filePath: savedPath, revision: exported.revision ?? 0 };
        },
        session() {
          return { previewToken, sessionId: editorStatus.fileId };
        },
        async swapDocument() {
          throw new Error(
            "Document swapping is not available in the presentation live editor.",
          );
        },
      };
      replayRef.current = new VibeReplaySequencer({
        api,
        controller,
        onStatus: (status) => {
          setReplayStatus(status);
          void api
            .recordRendererLog({
              source: "presentation-live-replay",
              event: status.state,
              details: {
                taskId: live.taskId,
                slide: status.slide,
                total: status.total,
                error: status.error,
              },
            })
            .catch(() => {});
        },
      });
    }
    replayRef.current.update(live);
  }, [editorStatus, fileName, filePath, live, previewToken, readOnly]);

  useEffect(
    () => () => {
      replayRef.current?.dispose();
      replayRef.current = null;
      replayIdentityRef.current = undefined;
      unregisterClientToolsRef.current?.();
      unregisterClientToolsRef.current = null;
      onFlushReadyRef.current?.(null);
    },
    [],
  );

  useEffect(() => {
    const node = transcriptRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [turns]);

  const refreshSelection = useCallback(async () => {
    const client = clientRef.current;
    if (!client || editorStatus.kind !== "ready" || busyRef.current) return;
    try {
      setSelectionContext(await client.inspect());
    } catch {
      // Selection is advisory only (the send flow inspects again); ignore
      // failures such as the editor being closed mid-refresh.
    }
  }, [editorStatus.kind]);

  const buildHistory = useCallback(
    (excludeId: string): PlanPptxJSTurn[] => {
      const history: PlanPptxJSTurn[] = [];
      for (const turn of turns) {
        if (turn.id === excludeId) continue;
        history.push({ role: "user", content: turn.prompt });
        if (turn.plan?.summary)
          history.push({ role: "assistant", content: turn.plan.summary });
      }
      return history.slice(-MAX_HISTORY_TURNS * 2);
    },
    [turns],
  );

  /**
   * Moves the editor to the slide the edit actually changed and reports whether
   * the selection state on screen was re-read.
   *
   * An agent edit is usually aimed somewhere other than the slide on screen --
   * "change the second slide's title" while the reader sits on the third. The
   * plan does not say where it landed, so the deck is inspected again and
   * compared with the shot taken before the script ran. Without this the edit
   * happens off-screen and reads as if nothing happened at all.
   */
  const focusEditedSlide = useCallback(
    async (
      client: PresentationPptxEmbedClient,
      before: PresentationPptxEditorContext | null | undefined,
    ): Promise<boolean> => {
      let after: PresentationPptxEditorContext;
      try {
        after = await client.inspect();
      } catch {
        // The edit itself landed; only the follow-the-edit courtesy is lost.
        return false;
      }
      setSelectionContext(after);
      const target = focusSlideAfterEdit(before, after);
      if (!target) return true;
      try {
        await client.executeJs(buildSelectSlideScript(target));
        setSelectionContext({
          ...after,
          selectedSlideIds: [target],
          selectedShapes: [],
        });
      } catch {
        // Same: a deck that will not navigate is not a failed edit.
      }
      return true;
    },
    [],
  );

  /** Execute → focus → export → save. `plan` must already be confirmed or auto-approved. */
  const applyPlan = useCallback(
    async (
      turnId: string,
      plan: PlanPptxJSResult,
      options: {
        skipExecute?: boolean;
        /** The deck as it stood before the script ran; used to find the edit. */
        before?: PresentationPptxEditorContext | null;
      } = {},
    ) => {
      const client = clientRef.current;
      if (!client) {
        updateTurn(turnId, {
          stage: "failed",
          error: t("pptx.agent.editorNotReady"),
          failedStage: "executing",
        });
        return;
      }
      setBusyState(true);
      let refreshed = false;
      try {
        if (!options.skipExecute) {
          updateTurn(turnId, { stage: "executing", error: undefined });
          await client.executeJs(plan.source);
          refreshed = await focusEditedSlide(client, options.before);
        }
        updateTurn(turnId, { stage: "exporting", error: undefined });
        updateTurn(turnId, { stage: "saving" });
        try {
          await enqueueSave(true);
          updateTurn(turnId, {
            stage: "done",
            savedPath: filePathRef.current ?? fileNameRef.current,
            error: undefined,
          });
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          updateTurn(turnId, {
            stage: "failed",
            failedStage: "saving",
            error: t("pptx.agent.saveFailed", { msg: message }),
          });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        updateTurn(turnId, {
          stage: "failed",
          failedStage: "executing",
          error: message,
        });
      } finally {
        setBusyState(false);
        if (!refreshed) void refreshSelection();
      }
    },
    [
      fileName,
      filePath,
      focusEditedSlide,
      refreshSelection,
      setBusyState,
      t,
      updateTurn,
    ],
  );

  /** Inspect → plan; then either wait for confirmation or apply immediately. */
  const planTurn = useCallback(
    async (turnId: string, prompt: string) => {
      const client = clientRef.current;
      if (!client || editorStatus.kind !== "ready") {
        updateTurn(turnId, {
          stage: "failed",
          error: t("pptx.agent.editorNotReady"),
          failedStage: "inspecting",
        });
        return;
      }
      setBusyState(true);
      let plan: PlanPptxJSResult;
      // Kept out of the try so the plan can be applied against the deck as it
      // stood when the planner saw it.
      let context: PresentationPptxEditorContext;
      try {
        updateTurn(turnId, { stage: "inspecting", error: undefined });
        context = await client.inspect();
        setSelectionContext(context);
        updateTurn(turnId, { stage: "planning", context });
        plan = await api.planPptxJS({
          prompt,
          context,
          history: buildHistory(turnId),
        });
        if (!plan || typeof plan.source !== "string" || !plan.source.trim()) {
          throw new Error("The AI planner returned no script.");
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        updateTurn(turnId, {
          stage: "failed",
          failedStage: "planning",
          error: message,
        });
        setBusyState(false);
        return;
      }
      updateTurn(turnId, { plan });
      const needsConfirmation =
        Boolean(plan.requires_confirmation) || plan.confidence === "low";
      if (needsConfirmation) {
        updateTurn(turnId, { stage: "awaiting-confirmation" });
        setBusyState(false);
        return;
      }
      setBusyState(false);
      await applyPlan(turnId, plan, { before: context });
    },
    [applyPlan, buildHistory, editorStatus.kind, setBusyState, updateTurn],
  );

  const submit = useCallback(
    (event?: FormEvent) => {
      event?.preventDefault();
      const prompt = draft.trim();
      if (!prompt || busyRef.current || editorStatus.kind !== "ready") return;
      if (turns.some((turn) => turn.stage === "awaiting-confirmation")) return;
      const id = `turn-${Date.now().toString(36)}-${turns.length}`;
      setTurns((prev) => [...prev, { id, prompt, stage: "inspecting" }]);
      setDraft("");
      void planTurn(id, prompt);
    },
    [draft, editorStatus.kind, planTurn, turns, setTurns],
  );

  const confirmTurn = useCallback(
    (turn: ConversationTurn) => {
      if (!turn.plan || busyRef.current) return;
      void applyPlan(turn.id, turn.plan, { before: turn.context });
    },
    [applyPlan],
  );

  const cancelTurn = useCallback(
    (turn: ConversationTurn) => {
      updateTurn(turn.id, { stage: "cancelled" });
    },
    [updateTurn],
  );

  const retryTurn = useCallback(
    (turn: ConversationTurn) => {
      if (busyRef.current) return;
      if (
        (turn.failedStage === "exporting" || turn.failedStage === "saving") &&
        turn.plan
      ) {
        // The edit already landed in the editor; only the export/save must be redone.
        void applyPlan(turn.id, turn.plan, { skipExecute: true });
        return;
      }
      if (turn.failedStage === "executing" && turn.plan) {
        void applyPlan(turn.id, turn.plan, { before: turn.context });
        return;
      }
      void planTurn(turn.id, turn.prompt);
    },
    [applyPlan, planTurn],
  );

  const awaitingConfirmation = turns.some(
    (turn) => turn.stage === "awaiting-confirmation",
  );
  const canSend =
    editorStatus.kind === "ready" &&
    !busy &&
    !awaitingConfirmation &&
    draft.trim().length > 0;

  const renderStage = (turn: ConversationTurn) => {
    switch (turn.stage) {
      case "inspecting":
        return <StatusLine spinning text={t("pptx.agent.status.inspecting")} />;
      case "planning":
        return <StatusLine spinning text={t("pptx.agent.status.planning")} />;
      case "awaiting-confirmation":
        return (
          <StatusLine text={t("pptx.agent.status.awaitingConfirmation")} />
        );
      case "executing":
        return <StatusLine spinning text={t("pptx.agent.status.executing")} />;
      case "exporting":
        return <StatusLine spinning text={t("pptx.agent.status.exporting")} />;
      case "saving":
        return (
          <StatusLine
            spinning
            text={t("pptx.agent.status.saving", { file: fileName })}
          />
        );
      case "done":
        return (
          <StatusLine
            done
            text={t("pptx.agent.status.done", {
              path: turn.savedPath ?? fileName,
            })}
          />
        );
      case "failed":
        return (
          <StatusLine
            error
            text={t("pptx.agent.status.failed", { msg: turn.error ?? "" })}
          />
        );
      case "interrupted":
        return <StatusLine text={t("pptx.agent.status.interrupted")} />;
      case "cancelled":
        return <StatusLine text={t("pptx.agent.status.cancelled")} />;
      default:
        return null;
    }
  };

  const conversation = (
    <>
      <div className="pptx-workbench-transcript" ref={transcriptRef}>
        {turns.length === 0 && (
          <div className="pptx-workbench-empty">
            <p>{t("pptx.agent.emptyTitle")}</p>
            <div className="pptx-workbench-suggestions">
              {(["simplify", "layout", "style"] as const).map((suggestion) => (
                <button key={suggestion} data-suggestion={suggestion} type="button" disabled={editorStatus.kind !== "ready" || busy} onClick={() => {
                  setDraft(t(`pptx.agent.suggestion.${suggestion}.prompt`));
                  inputRef.current?.focus();
                }}><span className="pptx-workbench-suggestion-icon" aria-hidden="true">{suggestion === "simplify" ? <AlignLeft /> : suggestion === "layout" ? <LayoutTemplate /> : <Palette />}</span><span className="pptx-workbench-suggestion-label">{t(`pptx.agent.suggestion.${suggestion}`)}</span><span aria-hidden="true">↗</span></button>
              ))}
            </div>
          </div>
        )}
        {turns.map((turn) => (
          <div
            key={turn.id}
            className="pptx-workbench-turn"
            data-stage={turn.stage}
          >
            <AgentMessage role="user">{turn.prompt}</AgentMessage>
            <AgentMessage role="assistant">
                {turn.plan?.summary && (
                  <div className="pptx-workbench-message-text">
                    {turn.plan.summary}
                  </div>
                )}
                {turn.plan?.confidence && (
                  <div className="pptx-workbench-confidence">
                    {t("pptx.agent.confidence", {
                      level: turn.plan.confidence,
                    })}
                  </div>
                )}
                {turn.plan?.warnings && turn.plan.warnings.length > 0 && (
                  <div className="pptx-workbench-warnings">
                    <strong>{t("pptx.agent.warnings")}</strong>
                    <ul>
                      {turn.plan.warnings.map((warning, index) => (
                        <li key={index}>{warning}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {turn.stage === "awaiting-confirmation" && turn.plan && (
                  <div
                    className="pptx-workbench-confirm"
                    role="group"
                    aria-label={t("pptx.agent.confirmTitle")}
                  >
                    <div className="pptx-workbench-confirm-title">
                      {turn.plan.confirmation?.title ||
                        t("pptx.agent.confirmTitle")}
                    </div>
                    {turn.plan.confirmation?.message && (
                      <p>{turn.plan.confirmation.message}</p>
                    )}
                    {turn.plan.confirmation?.target && (
                      <p>
                        {t("pptx.agent.confirmTarget", {
                          target: turn.plan.confirmation.target,
                        })}
                      </p>
                    )}
                    {turn.plan.confirmation?.changes &&
                      turn.plan.confirmation.changes.length > 0 && (
                        <div>
                          <strong>{t("pptx.agent.confirmChanges")}</strong>
                          <ul>
                            {turn.plan.confirmation.changes.map(
                              (item, index) => (
                                <li key={index}>{item}</li>
                              ),
                            )}
                          </ul>
                        </div>
                      )}
                    {turn.plan.confirmation?.preserved &&
                      turn.plan.confirmation.preserved.length > 0 && (
                        <div>
                          <strong>{t("pptx.agent.confirmPreserved")}</strong>
                          <ul>
                            {turn.plan.confirmation.preserved.map(
                              (item, index) => (
                                <li key={index}>{item}</li>
                              ),
                            )}
                          </ul>
                        </div>
                      )}
                    <div className="pptx-workbench-confirm-actions">
                      <Button
                        size="small"
                        onClick={() => cancelTurn(turn)}
                        disabled={busy}
                      >
                        {t("pptx.agent.cancel")}
                      </Button>
                      <Button
                        size="small"
                        type="primary"
                        onClick={() => confirmTurn(turn)}
                        disabled={busy}
                      >
                        {t("pptx.agent.apply")}
                      </Button>
                    </div>
                  </div>
                )}
                {renderStage(turn)}
                {turn.stage === "failed" && !turn.archived && (
                  <div className="pptx-workbench-turn-actions">
                    <Button
                      size="small"
                      onClick={() => retryTurn(turn)}
                      disabled={busy}
                    >
                      {turn.failedStage === "exporting" ||
                      turn.failedStage === "saving"
                        ? t("pptx.agent.retrySave")
                        : t("pptx.agent.retry")}
                    </Button>
                  </div>
                )}
                {turn.plan?.source && (
                  <details className="pptx-workbench-debug">
                    <summary>{t("pptx.agent.debugSource")}</summary>
                    <pre>{turn.plan.source}</pre>
                  </details>
                )}
            </AgentMessage>
          </div>
        ))}
      </div>
      <form className="pptx-workbench-composer" onSubmit={submit}>
        <div className="pptx-workbench-compose-box">
        <textarea
          ref={inputRef}
          className="pptx-workbench-input"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (
              event.key === "Enter" &&
              !event.shiftKey &&
              !event.nativeEvent.isComposing
            ) {
              event.preventDefault();
              submit();
            }
          }}
          placeholder={t("pptx.agent.placeholder")}
          rows={3}
          disabled={editorStatus.kind !== "ready"}
          aria-label={t("pptx.agent.placeholder")}
        />
        <div className="pptx-workbench-composer-actions">
        <div className="pptx-workbench-selection" title={describeSelection(selectionContext, t)}><Presentation size={14} aria-hidden="true" /><span>{describeSelection(selectionContext, t)}</span></div>
          {busy && (
            <span className="pptx-workbench-composer-hint">
              {t("pptx.agent.busy")}
            </span>
          )}
          <Button
            className="od-button--icon-submit"
            type="primary"
            size="small"
            htmlType="submit"
            aria-label={t("pptx.agent.send")}
            title={t("pptx.agent.send")}
            icon={<ArrowUp />}
            disabled={!canSend}
          />
        </div>
        </div>
      </form>
    </>
  );

  // The panel's chrome (title, target, selection chip, close) belongs to the
  // workbench frame; only the conversation itself is presentation-specific.
  const panel = readOnly
    ? undefined
    : {
        title: t("pptx.agent.panelTitle"),
        onRefreshScope: () => void refreshSelection(),
        refreshDisabled: editorStatus.kind !== "ready" || busy,
        headerExtra:
          live && replayStatus ? (
            <div
              className="pptx-workbench-replay"
              role={replayStatus.state === "failed" ? "alert" : "status"}
            >
              {t("pptx.replay.status", { state: t(`pptx.replay.state.${replayStatus.state}`) })}
              {replayStatus.slide ? t("pptx.replay.slide", { count: replayStatus.slide }) : ""}
              {imageProgress && imageProgress.total > 0
                ? t("pptx.replay.images", { placed: replayStatus.images?.placed ?? imageProgress.placed, total: imageProgress.total, pending: replayStatus.images?.pending ?? 0, failed: replayStatus.images?.failed ?? 0 })
                : ""}
              {replayStatus.error ? ` · ${replayStatus.error}` : ""}
            </div>
          ) : null,
        children: (
          <div className="pptx-workbench-conversation" data-has-messages={turns.length > 0}>
            {conversation}
          </div>
        ),
      };

  return (
    <OfficeWorkbenchLayout
      documentType="pptx"
      fileName={fileName}
      saveState={readOnly ? undefined : saveFailure ? "error" : dirty ? "dirty" : "saved"}
      onBack={onRequestClose}
      onOpenExternal={onOpenExternal}
      actions={
        <>
        {filePath && <Tooltip title={t("preview.showInFolder")}><Button type="text" size="small" aria-label={t("preview.showInFolder")} icon={<FolderClosed size={16} />} onClick={() => {
          void api.showItemInFolder(filePath).catch((error) => toast.error(t("preview.showInFolderFailed", { error: error instanceof Error ? error.message : String(error) })));
        }} /></Tooltip>}
        {onReplayDemo ? (
          <Tooltip title={t("pptx.agent.replayDemoHint")}>
            <Button
              type="text"
              size="small"
              icon={<History size={16} />}
              aria-label={t("pptx.agent.replayDemo")}
              onClick={onReplayDemo}
            />
          </Tooltip>
        ) : null}
        </>
      }
      notice={notice}
      panel={panel}
    >
      <div
        className={`pptx-workbench${readOnly ? " pptx-workbench-readonly" : ""}`}
        data-editor-status={editorStatus.kind}
      >
        <div className="pptx-workbench-editor">
          {editorStatus.kind !== "ready" &&
            editorStatus.kind !== "detached" &&
            editorStatus.kind !== "gap" &&
            editorStatus.kind !== "error" && (
              <div className="pptx-workbench-overlay" role="status">
                <Loader2 className="pptx-workbench-spinner" size={22} />
                <span>
                  {editorStatus.kind === "importing"
                    ? t("pptx.agent.editorImporting", { file: fileName })
                    : t("pptx.agent.editorLoading")}
                </span>
              </div>
            )}
          {editorStatus.kind === "detached" && (
            <div className="pptx-workbench-overlay" role="status">
              <AlertCircle size={22} />
              <span>{t("pptx.agent.editorDetached")}</span>
              <Button
                size="small"
                onClick={() => setReloadToken((value) => value + 1)}
              >
                {t("pptx.agent.reload")}
              </Button>
            </div>
          )}
          {editorStatus.kind === "gap" && (
            <div className="pptx-workbench-overlay" role="note">
              <AlertCircle size={22} />
              <strong>{t("pptx.agent.editorGapTitle")}</strong>
              <span>
                {t("pptx.agent.editorGapBody", { msg: editorStatus.message })}
              </span>
            </div>
          )}
          {editorStatus.kind === "error" && (
            <div
              className="pptx-workbench-overlay pptx-workbench-overlay-error"
              role="alert"
            >
              <AlertCircle size={22} />
              <strong>{t("pptx.agent.editorUnavailableTitle")}</strong>
              <span>
                {t("pptx.agent.editorUnavailableFailed", {
                  msg: editorStatus.message,
                })}
              </span>
              <Button
                size="small"
                onClick={() => setReloadToken((value) => value + 1)}
              >
                {t("pptx.agent.reload")}
              </Button>
            </div>
          )}
          {saveFailure && (
            <div
              className={`pptx-workbench-save-failure${saveFailure.conflict ? " is-conflict" : ""}`}
              role="alert"
            >
              <AlertCircle size={16} />
              <span>
                {saveFailure.conflict
                  ? t("pptx.agent.saveConflict")
                  : t("pptx.agent.saveFailedBar", { msg: saveFailure.message })}
              </span>
              {saveFailure.detail && (
                <details className="pptx-workbench-save-error-details">
                  <summary>{t("pptx.agent.saveErrorDetails")}</summary>
                  <pre>{saveFailure.detail}</pre>
                </details>
              )}
              {saveFailure.conflict && (
                <Button size="small" loading={savingCopy} onClick={() => void saveAsCopy()}>
                  {t("pptx.agent.saveConflictCopy")}
                </Button>
              )}
            </div>
          )}
          {embedUrl && (
            <iframe
              key={`${embedUrl}#${reloadToken}`}
              ref={iframeRef}
              src={embedUrl}
              className="pptx-workbench-frame"
              title={fileName}
              allow="clipboard-read; clipboard-write"
              onLoad={() =>
                iframeRef.current?.contentWindow?.postMessage(
                  {
                    protocol: PRESENTATION_PPTX_PROTOCOL,
                    channel,
                    type: "officedex:pptx-host-ready",
                  },
                  "*",
                )
              }
            />
          )}
        </div>
      </div>
    </OfficeWorkbenchLayout>
  );
}

function StatusLine({
  text,
  spinning,
  done,
  error,
}: {
  text: string;
  spinning?: boolean;
  done?: boolean;
  error?: boolean;
}) {
  return (
    <div
      className={`pptx-workbench-status${error ? " pptx-workbench-status-error" : done ? " pptx-workbench-status-done" : ""}`}
      role="status"
    >
      {spinning ? (
        <Loader2 className="pptx-workbench-spinner" size={13} />
      ) : done ? (
        <Check size={13} />
      ) : error ? (
        <AlertCircle size={13} />
      ) : null}
      <span>{text}</span>
    </div>
  );
}
