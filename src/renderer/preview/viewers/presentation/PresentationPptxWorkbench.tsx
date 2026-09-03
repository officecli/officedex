import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { Button } from "@vo-ui/backend";
import {
  AlertCircle,
  Bot,
  Check,
  Loader2,
  RefreshCw,
  User,
} from "lucide-react";
import { officecli } from "../../../bridge";
import { useT } from "../../../i18n";
import type {
  PlanPptxJSResult,
  PlanPptxJSTurn,
} from "../../../../shared/types";
import {
  buildPresentationPptxEmbedUrl,
  createPresentationPptxChannel,
  PRESENTATION_PPTX_PROTOCOL,
  type PresentationPptxEditorContext,
} from "../../../../shared/presentationPptxProtocol";
import {
  PresentationPptxEmbedClient,
  type PresentationPptxEmbedState,
} from "./PresentationPptxEmbedClient";
import {
  VibeReplaySequencer,
  type VibeReplayFeed,
  type VibeReplayStatus,
} from "../../../presentation/vibeReplay";
import { imageProgressFromOps } from "../../../presentation/pptxProgress";
import type {
  PresentationEditorController,
  PresentationScriptResult,
} from "../../../presentation/PresentationEditorFrame";
import { registerActiveEditorClientTools } from "../../../activeEditorClientTools";

export interface PresentationPptxWorkbenchProps {
  editorBaseUrl: string;
  previewToken: string;
  fileName: string;
  /** Absolute path of the artifact; edits are saved back here. */
  filePath?: string;
  /** Live generation feed executed inside this editor through PowerPoint.run. */
  live?: VibeReplayFeed;
  /** Called when the editor cannot be started; the parent may fall back to a read-only preview. */
  onEditorUnavailable?: (reason: string) => void;
  onDirtyChange?: (dirty: boolean) => void;
  onFlushReady?: (flush: (() => Promise<void>) | null) => void;
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
  | { kind: "error"; message: string };

type TurnStage =
  | "inspecting"
  | "planning"
  | "awaiting-confirmation"
  | "executing"
  | "exporting"
  | "saving"
  | "done"
  | "failed"
  | "cancelled";

interface ConversationTurn {
  id: string;
  prompt: string;
  stage: TurnStage;
  plan?: PlanPptxJSResult;
  context?: PresentationPptxEditorContext;
  error?: string;
  /** Stage in which the failure happened; drives what "retry" means. */
  failedStage?: Exclude<TurnStage, "done" | "failed" | "cancelled">;
  savedPath?: string;
}

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
  filePath,
  live,
  onEditorUnavailable,
  onDirtyChange,
  onFlushReady,
  createClient,
}: PresentationPptxWorkbenchProps) {
  const t = useT();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const channel = useMemo(() => createPresentationPptxChannel(), []);
  const embedUrl = useMemo(
    () => buildPresentationPptxEmbedUrl(editorBaseUrl, channel),
    [editorBaseUrl, channel],
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
  const [turns, setTurns] = useState<ConversationTurn[]>([]);
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
  const saveInFlightRef = useRef(false);
  const savePendingRef = useRef(false);
  const savePromiseRef = useRef<Promise<void> | null>(null);
  const dirtyVersionRef = useRef(0);
  const unregisterClientToolsRef = useRef<(() => void) | null>(null);
  const filePathRef = useRef(filePath);
  const fileNameRef = useRef(fileName);
  const editorStatusRef = useRef(editorStatus);
  const onDirtyChangeRef = useRef(onDirtyChange);
  const onFlushReadyRef = useRef(onFlushReady);
  filePathRef.current = filePath;
  fileNameRef.current = fileName;
  editorStatusRef.current = editorStatus;
  onDirtyChangeRef.current = onDirtyChange;
  onFlushReadyRef.current = onFlushReady;

  const targetLabel = filePath
    ? t("pptx.agent.target", { file: fileName })
    : t("pptx.agent.targetDownloads");

  const updateTurn = useCallback(
    (id: string, patch: Partial<ConversationTurn>) => {
      setTurns((prev) =>
        prev.map((turn) => (turn.id === id ? { ...turn, ...patch } : turn)),
      );
    },
    [],
  );

  const setBusyState = useCallback((value: boolean) => {
    busyRef.current = value;
    setBusy(value);
  }, []);

  const saveCurrentToDisk = useCallback(async (allowCopy = false) => {
    const client = clientRef.current;
    if (!client || editorStatusRef.current.kind !== "ready")
      throw new Error("The presentation editor is not ready.");
    const targetPath = filePathRef.current;
    if (!targetPath && !allowCopy)
      throw new Error("The presentation has no local target path.");
    const version = dirtyVersionRef.current;
    const exported = await client.export();
    const savedPath = await officecli.savePptx(
      new Uint8Array(exported.buffer),
      fileNameRef.current,
      targetPath ? { targetFilePath: targetPath } : {},
    );
    if (version === dirtyVersionRef.current) {
      dirtyRef.current = false;
      onDirtyChangeRef.current?.(false);
    }
    const recordLog = officecli.recordRendererLog;
    if (typeof recordLog === "function") {
      void recordLog({
        source: "presentation-pptx-autosave",
        event: "saved",
        details: { filePath: savedPath, revision: exported.revision ?? 0 },
      }).catch(() => {});
    }
  }, []);

  const enqueueSave = useCallback(
    (allowCopy = false): Promise<void> => {
      savePendingRef.current = true;
      if (!saveInFlightRef.current) {
        saveInFlightRef.current = true;
        savePromiseRef.current = (async () => {
          do {
            savePendingRef.current = false;
            try {
              await saveCurrentToDisk(allowCopy);
            } catch (error) {
              const recordLog = officecli.recordRendererLog;
              if (typeof recordLog === "function") {
                void recordLog({
                  source: "presentation-pptx-autosave",
                  event: "failed",
                  details: {
                    error:
                      error instanceof Error ? error.message : String(error),
                  },
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

  const requestSave = useCallback(() => {
    if (!filePathRef.current) return;
    void enqueueSave().catch(() => {
      // Keep the document dirty; the next edit or explicit Agent save retries.
    });
  }, [enqueueSave]);

  const flushPendingSave = useCallback(async () => {
    if (savePendingRef.current && !saveInFlightRef.current) requestSave();
    await savePromiseRef.current;
  }, [requestSave]);

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
      dirtyVersionRef.current += 1;
      onDirtyChange?.(dirty);
      if (dirty) requestSave();
    });
    setEditorStatus({ kind: "fetching" });
    setSelectionContext(null);

    (async () => {
      const result = await officecli.readArtifactFile(previewToken);
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
      dirtyRef.current = false;
      dirtyVersionRef.current = 0;
      onDirtyChangeRef.current?.(false);
      unregisterClientToolsRef.current?.();
      unregisterClientToolsRef.current = registerActiveEditorClientTools(
        "pptx-editor",
        {
          "pptx.editor.save": async () => {
            await enqueueSave(true);
            return {
              saved: true,
              file_path: filePathRef.current ?? fileNameRef.current,
              revision: client.getState().revision ?? 0,
            };
          },
        },
      );
      onFlushReadyRef.current?.(flushPendingSave);
      try {
        setSelectionContext(await client.inspect());
      } catch {
        // Selection is advisory; the send flow inspects again.
      }
    })().catch((error: unknown) => {
      if (cancelled) return;
      const message = error instanceof Error ? error.message : String(error);
      setEditorStatus({ kind: "error", message });
      onEditorUnavailable?.(message);
    });

    return () => {
      cancelled = true;
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
  }, [embedUrl, channel, previewToken, fileName, reloadToken, createClient]);

  useEffect(() => {
    const client = clientRef.current;
    if (
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
          const savedPath = await officecli.savePptx(
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
        controller,
        onStatus: (status) => {
          setReplayStatus(status);
          void officecli
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
  }, [editorStatus, fileName, filePath, live, previewToken]);

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

  /** Execute → export → save. `plan` must already be confirmed or auto-approved. */
  const applyPlan = useCallback(
    async (
      turnId: string,
      plan: PlanPptxJSResult,
      options: { skipExecute?: boolean } = {},
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
      try {
        if (!options.skipExecute) {
          updateTurn(turnId, { stage: "executing", error: undefined });
          await client.executeJs(plan.source);
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
        void refreshSelection();
      }
    },
    [fileName, filePath, refreshSelection, setBusyState, t, updateTurn],
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
      try {
        updateTurn(turnId, { stage: "inspecting", error: undefined });
        const context = await client.inspect();
        setSelectionContext(context);
        updateTurn(turnId, { stage: "planning", context });
        plan = await officecli.planPptxJS({
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
      await applyPlan(turnId, plan);
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
    [draft, editorStatus.kind, planTurn, turns],
  );

  const confirmTurn = useCallback(
    (turn: ConversationTurn) => {
      if (!turn.plan || busyRef.current) return;
      void applyPlan(turn.id, turn.plan);
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
        void applyPlan(turn.id, turn.plan);
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
      case "cancelled":
        return <StatusLine text={t("pptx.agent.status.cancelled")} />;
      default:
        return null;
    }
  };

  return (
    <div className="pptx-workbench" data-editor-status={editorStatus.kind}>
      <div className="pptx-workbench-editor">
        {editorStatus.kind !== "ready" &&
          editorStatus.kind !== "detached" &&
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
      <aside
        className="pptx-workbench-panel"
        aria-label={t("pptx.agent.panelTitle")}
      >
        <header className="pptx-workbench-panel-header">
          <div className="pptx-workbench-panel-title">
            <Bot size={16} />
            <span>{t("pptx.agent.panelTitle")}</span>
          </div>
          <div
            className="pptx-workbench-panel-target"
            title={filePath ?? fileName}
          >
            {targetLabel}
          </div>
          <div className="pptx-workbench-panel-selection">
            <span>{describeSelection(selectionContext, t)}</span>
            <button
              type="button"
              className="pptx-workbench-icon-button"
              onClick={() => void refreshSelection()}
              disabled={editorStatus.kind !== "ready" || busy}
              aria-label={t("pptx.agent.selectionRefresh")}
              title={t("pptx.agent.selectionRefresh")}
            >
              <RefreshCw size={13} />
            </button>
          </div>
          {live && replayStatus ? (
            <div
              className="pptx-workbench-panel-target"
              role={replayStatus.state === "failed" ? "alert" : "status"}
            >
              Live drawing: {replayStatus.state}
              {replayStatus.slide ? ` · slide ${replayStatus.slide}` : ""}
              {imageProgress && imageProgress.total > 0
                ? ` · images ${replayStatus.images?.placed ?? imageProgress.placed}/${imageProgress.total}${replayStatus.images?.pending ? ` (${replayStatus.images.pending} generating)` : ""}${replayStatus.images?.failed ? ` (${replayStatus.images.failed} failed)` : ""}`
                : ""}
              {replayStatus.error ? ` · ${replayStatus.error}` : ""}
            </div>
          ) : null}
        </header>
        <div className="pptx-workbench-transcript" ref={transcriptRef}>
          {turns.length === 0 && (
            <p className="pptx-workbench-empty">{t("pptx.agent.emptyHint")}</p>
          )}
          {turns.map((turn) => (
            <div
              key={turn.id}
              className="pptx-workbench-turn"
              data-stage={turn.stage}
            >
              <div className="pptx-workbench-message pptx-workbench-message-user">
                <span className="pptx-workbench-message-avatar">
                  <User size={13} />
                </span>
                <div className="pptx-workbench-message-body">
                  <div className="pptx-workbench-message-author">
                    {t("pptx.agent.you")}
                  </div>
                  <div className="pptx-workbench-message-text">
                    {turn.prompt}
                  </div>
                </div>
              </div>
              <div className="pptx-workbench-message pptx-workbench-message-assistant">
                <span className="pptx-workbench-message-avatar">
                  <Bot size={13} />
                </span>
                <div className="pptx-workbench-message-body">
                  <div className="pptx-workbench-message-author">
                    {t("pptx.agent.assistant")}
                  </div>
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
                  {turn.stage === "failed" && (
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
                </div>
              </div>
            </div>
          ))}
        </div>
        <form className="pptx-workbench-composer" onSubmit={submit}>
          <textarea
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
            {busy && (
              <span className="pptx-workbench-composer-hint">
                {t("pptx.agent.busy")}
              </span>
            )}
            <Button
              type="primary"
              size="small"
              htmlType="submit"
              disabled={!canSend}
            >
              {t("pptx.agent.send")}
            </Button>
          </div>
        </form>
      </aside>
    </div>
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
