import { DialogHost, ToastHost, toast as message } from "./ui";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AgentRun, Artifact, BridgeEvent, ConfiguredJiraSyncResult, ConfiguredLiquipediaSyncResult, DesktopTask, GenerateInput, JiraSyncResult, LiquipediaSyncResult, ModifyInput, PreviewGrant, RecentFile, WorkspaceConversationSummary, WorkspaceSummary } from "../shared/types";
import { AgentClientToolDeferredError, AgentClientToolHost, type AgentClientToolSurfaces } from "./AgentClientToolHost";
import { executeActiveEditorClientTool, waitForActiveEditorSurface, type ActiveEditorSurface } from "./activeEditorClientTools";
import { applyTaskEvent, attachTaskContext, attachUserInput, createInitialTaskState, deleteConversation, deleteTask, getConversationList, getConversationTasks, type TaskContextPatch, type TaskState } from "./taskState";
import { officecli } from "./bridge";
import { defaultGenerateInput, type NavKey } from "./defaults";
import { getHomeDropZone, setHomeDropZone } from "./homeDropZone";
import type { SidebarAccount } from "./components/ProjectSidebar";
import { Shell } from "./components/Shell";
import { PreviewPanel } from "./components/PreviewPanel";
import { buildReplayFeed, registerLiveDraft, VIBE_REPLAY_FINISHED_EVENT, type VibeReplayFinishedDetail } from "./presentation/vibeReplay";
import type { TimelineDeck, TimelineNode, VibeOp } from "../shared/types";
import type { SidebarUpdateRowProps } from "./components/SidebarUpdateRow";
import { ForceUpdateOverlay } from "./components/ForceUpdateOverlay";
import { DialogueScreen, type FailureKind, type NewChatTarget, type NewGenerationDraft } from "./screens/DialogueScreens";
import { ActivityPanel } from "./screens/DataScreens";
import { LoginScreen, SettingsScreen } from "./screens/SettingsScreens";
import { HomeScreen } from "./screens/HomeScreen";
import { inferHomeTaskRoute, type HomeTaskAnalysis, type HomeTaskIntake } from "./homeIntake";
import { PPT_VIBE_CANVAS_ENABLED } from "./featureFlags";
import { SpreadsheetWorkspace, type SpreadsheetWorkspaceHandle } from "./spreadsheet/SpreadsheetWorkspace";
import { SpreadsheetAgentPanel, type SpreadsheetAgentTool } from "./spreadsheet/SpreadsheetAgentPanel";
import { SpreadsheetMarketingPanel } from "./spreadsheet/SpreadsheetMarketingPanel";
import { SpreadsheetJiraPanel } from "./spreadsheet/SpreadsheetJiraPanel";
import { SpreadsheetLiquipediaPanel } from "./spreadsheet/SpreadsheetLiquipediaPanel";
import { SpreadsheetCatalogCleanupPanel } from "./spreadsheet/SpreadsheetCatalogCleanupPanel";
import type { MarketingBatchDraft, MarketingSheetRow } from "./spreadsheet/marketingWorkflow";
import type { CatalogCleanupBatch } from "./spreadsheet/catalogCleanupWorkflow";
import { loadPublishedWorkbookApps, savePublishedWorkbookApp } from "./appBuilder/appStore";
import type { PublishedWorkbookApp } from "./appBuilder/types";
import { parseWorkbookFormatCellsRequest, parseWorkbookSnapshotRequest, parseWorkbookStageMediaRequest, parseWorkbookWriteCellsRequest } from "./spreadsheet/workbookClientTools";
import { UnsavedChangesDialog } from "./spreadsheet/UnsavedChangesDialog";
import { useSpreadsheetSession } from "./spreadsheet/useSpreadsheetSession";
import type { SpreadsheetEntry } from "./spreadsheet/types";
import { clearSpreadsheetEntryGrant } from "./spreadsheet/entryLifecycle";
import { useSettings } from "./useSettings";
import { useAppUpdate } from "./useAppUpdate";
import { useCreditStatus } from "./useCreditStatus";
import { useLocale, useT } from "./i18n";
import { maybeNotify } from "./notifications";
import { computeTaskSignals, failedTaskIds, readSeenFailures, sidebarSignal, taskNotificationBody, writeSeenFailures } from "./taskSignals";
import { pollTaskHistoryUntilTerminal } from "./taskHistoryPoll";
import { errorMessage, recordValue, trimmedStringValue as stringValue } from "./utils/values";
import { fileExtension, fileNameFromPath } from "./utils/path";
import { delay } from "./utils/timing";

type SelectedTask =
  | { kind: "auto" }
  | { kind: "none" }
  | { kind: "task"; id: string };

type PendingGenerate = {
  localTaskId: string;
  context?: TaskContextPatch;
  input: {
    prompt: string;
    generationMode?: GenerateInput["generationMode"];
    sourceFile?: string;
    referenceImages?: string[];
    imageRatio?: GenerateInput["imageRatio"];
    fps?: number;
  };
  parentTaskId?: string;
};

const RECENT_FILES_TIMEOUT_MS = 8_000;

function materializePendingContext(pending: PendingGenerate, taskId: string): TaskContextPatch | undefined {
  if (pending.context?.conversationId !== pending.localTaskId) {
    return pending.context;
  }
  return { ...pending.context, conversationId: taskId };
}

function generationModeForDocumentType(documentType: string | undefined): GenerateInput["generationMode"] | undefined {
  return documentType === "pptx" || documentType === "docx" || documentType === "xlsx" || documentType === "report" ? "fast" : undefined;
}

function normalizeGenerationMode(_value: unknown): GenerateInput["generationMode"] {
  return "fast";
}

function normalizeGenerateInputForGeneration(values: GenerateInput): GenerateInput {
  const next: GenerateInput = { ...values };
  const generationMode = generationModeForDocumentType(next.documentType);
  if (generationMode) {
    next.generationMode = normalizeGenerationMode(next.generationMode);
  } else {
    delete next.generationMode;
  }
  return next;
}

export function findModifySourceTask(tasks: DesktopTask[], documentType: string): DesktopTask | undefined {
  const targetType = documentType.trim().toLowerCase();
  for (let i = tasks.length - 1; i >= 0; i--) {
    const task = tasks[i];
    const artifact = task.artifact;
    if (!artifact?.filePath) continue;
    const artifactType = (artifact.documentType || task.documentType || "").toLowerCase();
    if (artifactType === targetType) {
      return task;
    }
  }
  return undefined;
}

export function App() {
  return <OfficeDexApp />;
}

function OfficeDexApp() {
  const [state, setState] = useState<TaskState>(() => createInitialTaskState());
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
  const [chats, setChats] = useState<WorkspaceConversationSummary[]>([]);
  const [recentFiles, setRecentFiles] = useState<RecentFile[]>([]);
  const [recentFilesLoading, setRecentFilesLoading] = useState(true);
  const [recentFilesError, setRecentFilesError] = useState<string>();
  const [homeWorkspaceId, setHomeWorkspaceId] = useState<string>();
  const [selectedTaskID, setSelectedTaskID] = useState<SelectedTask>({ kind: "auto" });
  const [activeNav, setActiveNav] = useState<NavKey>(() => initialNavFromLocation());
  const [busy, setBusy] = useState(false);
  const [capabilityStatus, setCapabilityStatus] = useState("Not connected");
  const [lastError, setLastError] = useState<string>();
  const [errorKind, setErrorKind] = useState<FailureKind>("connection");
  const [bridgeInterruptionKey, setBridgeInterruptionKey] = useState(0);
  const [errorDetails, setErrorDetails] = useState<string>();
  const [connectAttempt, setConnectAttempt] = useState(0);
  const [previewGrant, setPreviewGrant] = useState<PreviewGrant | null>(null);
  const [previewArtifact, setPreviewArtifact] = useState<Artifact | null>(null);
  const [spreadsheetEntry, setSpreadsheetEntry] = useState<SpreadsheetEntry | null>(null);
  const [spreadsheetPreferredTool, setSpreadsheetPreferredTool] = useState<SpreadsheetAgentTool>("assistant");
  const [catalogAutoScanFile, setCatalogAutoScanFile] = useState<string>();
  const spreadsheet = useSpreadsheetSession(spreadsheetEntry);
  const spreadsheetWorkspaceRef = useRef<SpreadsheetWorkspaceHandle>(null);
  const [unsavedDialogOpen, setUnsavedDialogOpen] = useState(false);
  const [unsavedDialogSaving, setUnsavedDialogSaving] = useState(false);
  const pendingSpreadsheetActionRef = useRef<{ action: () => Promise<void>; resolve: (continued: boolean) => void } | null>(null);
  const recentFilesRequestRef = useRef(0);
  const activeNavRef = useRef(activeNav);
  activeNavRef.current = activeNav;
  const pendingGenerateRef = useRef<PendingGenerate | null>(null);
  // A newly submitted task is shown in the Home stage shell first. Once its
  // artifact is available, the existing PreviewPanel becomes the focused
  // artifact stage. The ref scopes auto-opening to this submission only, so
  // background/history tasks and legacy dialogue navigation remain unchanged.
  const stageFirstTaskRef = useRef<string | undefined>(undefined);
  const agentClientToolReportedErrorsRef = useRef(new Set<string>());
  const { settings: persistedSettings, loading: settingsLoading } = useSettings();
  const [newGenerationDraft, setNewGenerationDraft] = useState<NewGenerationDraft>(() => createNewGenerationDraft());
  const [newChatTarget, setNewChatTarget] = useState<NewChatTarget>({ kind: "none" });
  const [newChatNudgeKey, setNewChatNudgeKey] = useState(0);
  const [newGenerationDraftDirty, setNewGenerationDraftDirty] = useState(false);
  const appUpdate = useAppUpdate();
  const { credit, status: creditStatus, refresh: refreshCredit, nudgeForTaskTransition } = useCreditStatus();
  const [account, setAccount] = useState<SidebarAccount | undefined>();
  const [droppedTaskPaths, setDroppedTaskPaths] = useState<{ paths: string[]; seq: number }>();
  const locale = useLocale();
  const t = useT();
  const forceUpdate = appUpdate.status.mandatory && Boolean(appUpdate.release);

  const recordError = useCallback((text: string, kind: FailureKind, details?: string) => {
    setLastError(text);
    setErrorKind(kind);
    setErrorDetails(details);
  }, []);

  const clearError = useCallback(() => {
    setLastError(undefined);
    setErrorDetails(undefined);
  }, []);

  const activeWorkspace = useMemo(() => workspaces.find((workspace) => workspace.active), [workspaces]);

  const runSpreadsheetAction = useCallback((action: () => Promise<void>): Promise<boolean> => {
    if (activeNavRef.current !== "spreadsheet" || !spreadsheet.session.dirty) {
      return action().then(() => true);
    }
    return new Promise<boolean>((resolve) => {
      pendingSpreadsheetActionRef.current?.resolve(false);
      pendingSpreadsheetActionRef.current = { action, resolve };
      setUnsavedDialogOpen(true);
    });
  }, [spreadsheet.session.dirty]);

  const continuePendingSpreadsheetAction = useCallback(async (discard: boolean) => {
    const pending = pendingSpreadsheetActionRef.current;
    if (!pending) return;
    if (!discard) {
      setUnsavedDialogSaving(true);
      const saved = await spreadsheetWorkspaceRef.current?.save();
      setUnsavedDialogSaving(false);
      if (!saved) {
        // Keep the pending navigation alive so the user can retry the save,
        // explicitly discard, or cancel. Clearing it here leaves the dialog
        // open with buttons that can no longer complete the original action.
        return;
      }
    } else if (spreadsheet.session.artifact) {
      // Dropping edits must also drop the live editor grant. Keeping the same
      // granted entry mounted can leave Sheet SDK bound to an editor session
      // that became invalid while the Bridge/API restarted. Re-entering the
      // artifact without a grant unmounts that canvas; a resumed Run can then
      // reopen the workbook with a fresh token even when the path is unchanged.
      setSpreadsheetEntry({
        kind: "artifact",
        artifact: spreadsheet.session.artifact,
        ...(spreadsheet.session.workspaceId
          ? { workspaceId: spreadsheet.session.workspaceId }
          : {}),
        ...(spreadsheet.session.conversationId
          ? { conversationId: spreadsheet.session.conversationId }
          : {}),
      });
    }
    pendingSpreadsheetActionRef.current = null;
    setUnsavedDialogOpen(false);
    try {
      await pending.action();
      pending.resolve(true);
    } catch (error) {
      pending.resolve(false);
      throw error;
    }
  }, [
    spreadsheet.session.artifact,
    spreadsheet.session.conversationId,
    spreadsheet.session.workspaceId,
  ]);

  const cancelPendingSpreadsheetAction = useCallback(() => {
    pendingSpreadsheetActionRef.current?.resolve(false);
    pendingSpreadsheetActionRef.current = null;
    setUnsavedDialogOpen(false);
  }, []);

  const refreshProjectLists = useCallback(() => {
    Promise.all([officecli.listWorkspaces(), officecli.listChats()])
      .then(([workspaceItems, chatItems]) => {
        setWorkspaces(workspaceItems);
        setChats(chatItems);
      })
      .catch(() => undefined);
  }, []);

  const refreshRecentFiles = useCallback(async (workspaceId?: string) => {
    const requestId = recentFilesRequestRef.current + 1;
    recentFilesRequestRef.current = requestId;
    setRecentFilesLoading(true);
    setRecentFilesError(undefined);
    try {
      const files = await promiseWithTimeout(
        officecli.listRecentFiles(workspaceId),
        RECENT_FILES_TIMEOUT_MS,
        t("home.loadTimeout"),
      );
      if (recentFilesRequestRef.current !== requestId) return;
      setRecentFiles(files);
    } catch (error) {
      if (recentFilesRequestRef.current !== requestId) return;
      setRecentFilesError(errorMessage(error));
    } finally {
      if (recentFilesRequestRef.current === requestId) {
        setRecentFilesLoading(false);
      }
    }
  }, [t]);

  useEffect(() => {
    refreshProjectLists();
  }, [refreshProjectLists]);

  useEffect(() => {
    void refreshRecentFiles();
  }, [refreshRecentFiles]);

  useEffect(() => {
    if (settingsLoading || newGenerationDraftDirty) return;
    setNewGenerationDraft(createNewGenerationDraft(persistedSettings.defaults));
  }, [settingsLoading, newGenerationDraftDirty, persistedSettings.defaults]);

  const updateNewGenerationDraft = useCallback((patch: Partial<NewGenerationDraft>) => {
    setNewGenerationDraft((current) => ({ ...current, ...patch }));
    setNewGenerationDraftDirty(true);
  }, []);

  const resetNewGenerationDraft = useCallback(() => {
    setNewGenerationDraft(createNewGenerationDraft(persistedSettings.defaults));
    setNewGenerationDraftDirty(false);
  }, [persistedSettings.defaults]);

  useEffect(() => {
    if (settingsLoading) return;
    refreshCredit();
  }, [persistedSettings.llmProvider, settingsLoading, refreshCredit]);

  useEffect(() => {
    if (forceUpdate) {
      setCapabilityStatus("Update required to continue");
      return;
    }
    const off = officecli.onBridgeEvent((event: BridgeEvent) => {
      if (event.type === "bridge.reconnecting") {
        setCapabilityStatus(String(event.payload?.message || "Reconnecting..."));
        return;
      }
      if (event.type === "bridge.reconnected") {
        setCapabilityStatus("Connected to officecli agent-bridge");
        clearError();
        refreshProjectLists();
        void refreshRecentFiles(homeWorkspaceId);
        return;
      }
      if (event.type === "bridge.unconfigured") {
        const message = String(event.payload?.message || "OfficeCLI binary is not configured");
        const stderr = stringOrUndef(event.payload?.stderr);
        setCapabilityStatus(message);
        recordError(message, "setup", stderr);
        return;
      }
      if (event.type === "bridge.reconnect_exhausted") {
        const message = String(event.payload?.message || "Bridge reconnection failed. Please retry manually.");
        const stderr = stringOrUndef(event.payload?.stderr);
        setCapabilityStatus(message);
        recordError(message, classifyError(message, stderr), stderr);
        return;
      }
      if (event.type === "bridge.exited") {
        const message = String(event.payload?.message || "officecli agent-bridge exited");
        setCapabilityStatus(`${message} — reconnecting…`);
        recentFilesRequestRef.current += 1;
        setRecentFilesLoading(false);
        setRecentFilesError(t("home.bridgeUnavailable"));
        setBridgeInterruptionKey((current) => current + 1);
        const interruptedMessage = t("task.interrupted.bridge");
        setState((current) => {
          let next = current;
          for (const taskID of current.taskOrder) {
            const task = next.tasks[taskID];
            if (!task || !["starting", "running", "question", "plan_review"].includes(task.status)) continue;
            next = applyTaskEvent(next, {
              type: "task.failed",
              task_id: taskID,
              ts: new Date().toISOString(),
              payload: { message: interruptedMessage, reason: "bridge_interrupted" },
            });
          }
          return next;
        });
        pendingGenerateRef.current = null;
        setBusy(false);
        return;
      }
      const pending = pendingGenerateRef.current;
      const shouldReplaceLocalTask = Boolean(
        event.task_id &&
        pending &&
        event.task_id !== pending.localTaskId,
      );
      // Captured from the reduced state so the notification below can name the
      // task; reading component state here would see the pre-event snapshot.
      let settledTask: DesktopTask | undefined;
      setState((current) => {
        let next = applyTaskEvent(current, event);
        if (event.task_id && pending && shouldReplaceLocalTask) {
          next = deleteTask(next, pending.localTaskId);
          next = attachUserInput(next, event.task_id, pending.input, pending.parentTaskId, materializePendingContext(pending, event.task_id));
        }
        if (event.task_id) settledTask = next.tasks[event.task_id];
        return next;
      });
      if (event.task_id) {
        if (pending && shouldReplaceLocalTask) {
          if (stageFirstTaskRef.current === pending.localTaskId) {
            stageFirstTaskRef.current = event.task_id;
          }
          pendingGenerateRef.current = null;
          setSelectedTaskID({ kind: "task", id: event.task_id });
          setBusy(false);
          refreshProjectLists();
          setActiveNav(stageFirstTaskRef.current === event.task_id ? "home" : "dialogue");
        }
      }
      if (event.type === "task.completed" || event.type === "task.failed" || event.type === "task.cancelled") {
        // Name the task in the body: "a generation finished" makes the user
        // hunt for which one, which is the trip to the tasks page we are
        // trying to remove.
        if (event.type === "task.completed") {
          maybeNotify({ title: t("notification.title"), body: taskNotificationBody(settledTask, t("notification.taskCompleted")) });
        }
        if (event.type === "task.failed") {
          maybeNotify({ title: t("notification.title"), body: taskNotificationBody(settledTask, t("notification.taskFailed")) });
        }
        nudgeForTaskTransition();
      }
    });
    if (settingsLoading) {
      return off;
    }
    officecli
      .initialize()
      .then(() => officecli.getCapabilities())
      .then((capabilities) => {
        const preview = typeof capabilities === "object" && capabilities !== null && "browserPreview" in capabilities;
        setCapabilityStatus(preview ? "Browser preview; bridge IPC requires Electron" : "Connected to officecli agent-bridge");
      })
      .catch((error) => {
        const text = errorMessage(error);
        setCapabilityStatus(text);
      });
    return off;
  }, [connectAttempt, clearError, homeWorkspaceId, recordError, refreshRecentFiles, settingsLoading, forceUpdate, nudgeForTaskTransition, refreshProjectLists, t]);

  useEffect(() => {
    let cancelled = false;
    officecli
      .getTaskHistory(50)
      .then((entries) => {
        if (cancelled || entries.length === 0) return;
        setState((current) => {
          let next = current;
          for (const entry of entries) {
            if (next.tasks[entry.taskId]) continue;
            for (const event of entry.events) {
              next = applyTaskEvent(next, event);
            }
            next = attachTaskContext(next, entry.taskId, {
              conversationId: entry.conversationId,
              parentTaskId: entry.parentTaskId,
              workspaceId: entry.workspaceId,
              workspacePath: entry.workspacePath,
            });
            // After replaying persisted events, if the task is still
            // running or starting, it means the task was interrupted
            // (e.g. force-quit while generating). Mark it cancelled so
            // the UI does not show a perpetual loading spinner.
            const task = next.tasks[entry.taskId];
            if (task && (task.status === "running" || task.status === "starting")) {
              next = applyTaskEvent(next, {
                type: "task.cancelled",
                task_id: entry.taskId,
                ts: new Date().toISOString(),
                payload: { message: "Task was interrupted when the application quit" },
              });
            }
          }
          return next;
        });
      })
      .catch(() => {
        // History hydration is best-effort; live events still flow.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const activeTaskHistoryKey = state.taskOrder
    .filter((taskId) => {
      const status = state.tasks[taskId]?.status;
      return status === "starting" || status === "running" || status === "question" || status === "plan_review";
    })
    .join("|");

  useEffect(() => {
    if (!activeTaskHistoryKey) return;
    let cancelled = false;
    let syncing = false;

    const reconcileActiveTaskHistory = async () => {
      if (cancelled || syncing) return;
      syncing = true;
      try {
        const entries = await officecli.getTaskHistory(50);
        if (cancelled || entries.length === 0) return;
        setState((current) => {
          const activeTaskIds = new Set(current.taskOrder.filter((taskId) => {
            const status = current.tasks[taskId]?.status;
            return status === "starting" || status === "running" || status === "question" || status === "plan_review";
          }));
          let next = current;
          for (const entry of entries) {
            if (!activeTaskIds.has(entry.taskId)) continue;
            const beforeEntry = next;
            for (const event of entry.events) next = applyTaskEvent(next, event);
            if (next !== beforeEntry) {
              next = attachTaskContext(next, entry.taskId, {
                conversationId: entry.conversationId,
                parentTaskId: entry.parentTaskId,
                workspaceId: entry.workspaceId,
                workspacePath: entry.workspacePath,
              });
            }
          }
          return next;
        });
      } catch {
        // Live events remain the fast path. The next reconciliation tick retries.
      } finally {
        syncing = false;
      }
    };

    void reconcileActiveTaskHistory();
    const interval = window.setInterval(() => {
      void reconcileActiveTaskHistory();
    }, 1_500);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [activeTaskHistoryKey]);

  const firstTaskID = state.taskOrder[0];
  useEffect(() => {
    if (firstTaskID && selectedTaskID.kind === "auto") {
      setSelectedTaskID({ kind: "task", id: firstTaskID });
    }
  }, [firstTaskID, selectedTaskID.kind]);

  useEffect(() => {
    const STALL_THRESHOLD = 300_000;
    const interval = setInterval(() => {
      setState((current) => {
        let changed = false;
        const now = Date.now();
        const updatedTasks = { ...current.tasks };
        for (const id of current.taskOrder) {
          const task = updatedTasks[id];
          if (!task || task.status !== "running") continue;
          const lastActivity = task.lastProgressAt ?? (task.events[0]?.ts ? Date.parse(task.events[0].ts) : undefined);
          if (lastActivity === undefined) continue;
          if (now - lastActivity > STALL_THRESHOLD && !task.stalledSince) {
            updatedTasks[id] = { ...task, stalledSince: now };
            changed = true;
          }
        }
        return changed ? { ...current, tasks: updatedTasks } : current;
      });
    }, 30_000);
    return () => clearInterval(interval);
  }, []);

  const conversationId = useMemo(() => {
    if (selectedTaskID.kind === "task") {
      return state.tasks[selectedTaskID.id]?.conversationId;
    }
    if (selectedTaskID.kind === "auto" && firstTaskID) {
      return state.tasks[firstTaskID]?.conversationId;
    }
    return undefined;
  }, [selectedTaskID, state.tasks, firstTaskID]);

  useEffect(() => {
    if (selectedTaskID.kind !== "auto" || conversationId || !activeWorkspace || newChatTarget.kind !== "none") return;
    setNewChatTarget({ kind: "workspace", workspaceId: activeWorkspace.id });
  }, [activeWorkspace, conversationId, newChatTarget.kind, selectedTaskID.kind]);

  const conversationTasks = useMemo(() => {
    if (!conversationId) return [];
    return getConversationTasks(state, conversationId);
  }, [state, conversationId]);
  const activePptCanvasTaskId = useMemo(() => {
    if (!PPT_VIBE_CANVAS_ENABLED || activeNav !== "dialogue") return undefined;
    return conversationTasks.find((task) => task.documentType === "pptx" && task.vibeTree)?.id;
  }, [activeNav, conversationTasks]);
  const activeVibeTask = useMemo(
    () => (PPT_VIBE_CANVAS_ENABLED && activeNav === "dialogue"
      ? conversationTasks.find((task) => task.documentType === "pptx" && task.vibeTree)
      : undefined),
    [activeNav, conversationTasks],
  );
  const vibeStage = activeVibeTask?.vibeTree?.stage;
  const tasks = useMemo(() => state.taskOrder.map((taskID) => state.tasks[taskID]).filter(Boolean), [state]);
  // One sidebar signal, highest urgency first: needs-you > running > unseen
  // failures. Failures count as seen once the user opens the tasks page, so a
  // stale red dot cannot outlive the visit that acknowledged it.
  const [seenFailures, setSeenFailures] = useState<string[]>(() => readSeenFailures());
  const taskSignals = useMemo(() => computeTaskSignals(tasks, seenFailures), [tasks, seenFailures]);
  const sidebarTaskSignal = useMemo(() => sidebarSignal(taskSignals), [taskSignals]);
  const [activityVisible, setActivityVisible] = useState(false);
  useEffect(() => {
    // Acknowledge only while the activity list is actually on screen.
    if (!activityVisible) return;
    const ids = failedTaskIds(tasks);
    setSeenFailures((current) => {
      if (ids.length === current.length && ids.every((id) => current.includes(id))) return current;
      writeSeenFailures(ids);
      return ids;
    });
  }, [activityVisible, tasks]);

  useEffect(() => {
    let cancelled = false;
    officecli.whoami()
      .then((result) => {
        if (!cancelled) setAccount({ mode: result.mode, email: result.email });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [creditStatus?.mode]);
  const spreadsheetTask = useMemo(() => {
    const sessionTask = spreadsheet.session.taskId ? state.tasks[spreadsheet.session.taskId] : undefined;
    const activeConversationId = spreadsheet.session.conversationId || sessionTask?.conversationId;
    if (!activeConversationId) return sessionTask;
    const relatedTasks = getConversationTasks(state, activeConversationId);
    return relatedTasks[relatedTasks.length - 1] || sessionTask;
  }, [spreadsheet.session.conversationId, spreadsheet.session.taskId, state]);

  useEffect(() => {
    const artifact = spreadsheetTask?.status === "completed" ? spreadsheetTask.artifact : undefined;
    if (!artifact || !isXlsxArtifact(artifact) || spreadsheet.session.artifact?.filePath === artifact.filePath) return;
    void spreadsheet.openArtifact(artifact, spreadsheetTask?.conversationId)
      .then(() => {
        void refreshRecentFiles(spreadsheet.session.workspaceId);
        refreshProjectLists();
      })
      .catch((error) => recordError(errorMessage(error), "other"));
  }, [recordError, refreshProjectLists, refreshRecentFiles, spreadsheet.openArtifact, spreadsheet.session.artifact?.filePath, spreadsheet.session.workspaceId, spreadsheetTask]);
  const conversations = useMemo(() => getConversationList(state), [state]);
  const sidebarWorkspaces = useMemo(() => {
    return workspaces.map((workspace) => {
      const liveConversations: WorkspaceConversationSummary[] = conversations
        .filter((conversation) => {
          const task = state.tasks[conversation.latestTaskId];
          return task?.workspaceId === workspace.id;
        })
        .map((conversation) => ({
          conversationId: conversation.conversationId,
          firstTaskId: conversation.firstTaskId,
          latestTaskId: conversation.latestTaskId,
          title: conversation.title,
          status: conversation.status,
          ...(conversation.documentType ? { documentType: conversation.documentType } : {}),
        }));
      const seen = new Set(liveConversations.map((conversation) => conversation.conversationId));
      return {
        ...workspace,
        conversations: liveConversations.concat(workspace.conversations.filter((conversation) => !seen.has(conversation.conversationId))),
      };
    });
  }, [workspaces, conversations, state.tasks]);

  const sidebarChats = useMemo(() => {
    const liveChats: WorkspaceConversationSummary[] = conversations
      .filter((conversation) => {
        const task = state.tasks[conversation.latestTaskId];
        return task && !task.workspaceId;
      })
      .map((conversation) => ({
        conversationId: conversation.conversationId,
        firstTaskId: conversation.firstTaskId,
        latestTaskId: conversation.latestTaskId,
        title: conversation.title,
        status: conversation.status,
        ...(conversation.documentType ? { documentType: conversation.documentType } : {}),
      }));
    const seen = new Set(liveChats.map((conversation) => conversation.conversationId));
    return liveChats.concat(chats.filter((conversation) => !seen.has(conversation.conversationId)));
  }, [chats, conversations, state.tasks]);

  async function submit(values: GenerateInput) {
    if (forceUpdate) {
      recordError("Update required before continuing", "setup");
      return;
    }
    clearError();
    const topic = values.topic || summarizePrompt(values.prompt);
    const localTaskId = createLocalTaskId();
    const submittedValues = normalizeGenerateInputForGeneration(values);
    const submittedDraft = createNewGenerationDraft(submittedValues);
    const noProject = values.noProject === true || !values.workspaceId;
    const targetWorkspace = noProject ? undefined : workspaces.find((workspace) => workspace.id === values.workspaceId);
    const context: TaskContextPatch = {
      conversationId: localTaskId,
      ...(targetWorkspace ? { workspaceId: targetWorkspace.id, workspacePath: targetWorkspace.path } : {}),
    };
    pendingGenerateRef.current = {
      localTaskId,
      context,
      input: {
        prompt: submittedValues.prompt,
        ...(submittedValues.generationMode ? { generationMode: submittedValues.generationMode } : {}),
        sourceFile: submittedValues.sourceFile,
        referenceImages: submittedValues.referenceImages,
        imageRatio: submittedValues.imageRatio,
        fps: submittedValues.fps,
      },
    };
    stageFirstTaskRef.current = localTaskId;
    const pendingInput = pendingGenerateRef.current.input;
    setState((current) => attachUserInput(applyTaskEvent(current, {
      task_id: localTaskId,
      type: "task.started",
      ts: new Date().toISOString(),
      payload: {
        document_type: values.documentType,
        topic,
        message: "Task submitted",
      },
    }), localTaskId, pendingInput, undefined, context));
    setSelectedTaskID({ kind: "task", id: localTaskId });
    setActiveNav("home");
    resetNewGenerationDraft();
    setBusy(false);
    try {
      const generateInput: GenerateInput = noProject
        ? { ...submittedValues, topic, noProject: true, workspaceId: undefined }
        : { ...submittedValues, topic, workspaceId: targetWorkspace?.id };
      const result = await officecli.generate(generateInput);
      if (pendingGenerateRef.current?.localTaskId === localTaskId && result.taskId) {
        const pending = pendingGenerateRef.current;
        const actualContext = { ...pending.context, conversationId: result.taskId };
        pendingGenerateRef.current = null;
        setState((current) => attachUserInput(deleteTask(current, localTaskId), result.taskId, pending.input, undefined, actualContext));
        setSelectedTaskID({ kind: "task", id: result.taskId });
        stageFirstTaskRef.current = result.taskId;
        setActiveNav("home");
        refreshProjectLists();
      }
    } catch (error) {
      if (pendingGenerateRef.current?.localTaskId !== localTaskId) return;
      pendingGenerateRef.current = null;
      stageFirstTaskRef.current = undefined;
      setState((current) => deleteTask(current, localTaskId));
      setNewGenerationDraft(submittedDraft);
      setNewGenerationDraftDirty(true);
      const text = errorMessage(error);
      recordError(text, classifyError(text), extractStderr(text));
      setActiveNav("dialogue");
    } finally {
      setBusy(false);
      nudgeForTaskTransition();
    }
  }

  function retryTaskGeneration(task: DesktopTask) {
    const input = task.userInput;
    if (!input?.prompt.trim()) return;
    const documentType = documentTypeFromTask(task);
    const values: GenerateInput = {
      documentType,
      topic: task.topic || summarizePrompt(input.prompt),
      prompt: input.prompt,
      ...(generationModeForDocumentType(documentType) ? { generationMode: normalizeGenerationMode(input.generationMode) } : {}),
      enableImages: persistedSettings.defaults.enableImages,
      imageQuality: persistedSettings.defaults.imageQuality,
      sourceFile: input.sourceFile,
    };
    if (documentType === "img") {
      values.referenceImages = input.referenceImages;
      values.imageRatio = input.imageRatio;
    } else if (documentType === "gif") {
      values.referenceImages = input.referenceImages;
      values.fps = input.fps;
    }
    if (task.workspaceId) {
      values.workspaceId = task.workspaceId;
    } else {
      values.noProject = true;
    }
    void submit(values);
  }

  const selectWorkspace = useCallback(async (workspaceId: string) => {
    try {
      const selected = await officecli.selectWorkspace(workspaceId);
      setWorkspaces((current) => current.map((workspace) => ({ ...workspace, active: workspace.id === selected.id })));
      setNewChatTarget({ kind: "workspace", workspaceId: selected.id });
      clearError();
    } catch (error) {
      const text = errorMessage(error);
      recordError(text, classifyError(text), extractStderr(text));
    }
  }, [clearError, recordError]);

  const createFromHome = useCallback(async (documentType: Exclude<GenerateInput["documentType"], "gif">) => {
    if (documentType === "xlsx") {
      try {
        const artifact = await officecli.createWorkbookFromSheet({
          fileName: t("spreadsheet.untitled"),
          sheetName: "Sheet1",
          headers: [],
          rows: [],
          workspaceId: homeWorkspaceId,
        });
        const grant = await officecli.issuePreviewToken(artifact);
        setSpreadsheetEntry({
          kind: "artifact",
          artifact,
          grant,
          ...(homeWorkspaceId ? { workspaceId: homeWorkspaceId } : {}),
        });
        clearError();
        setActiveNav("spreadsheet");
        void refreshRecentFiles(homeWorkspaceId);
      } catch (error) {
        const text = errorMessage(error);
        recordError(text, classifyError(text), extractStderr(text));
        void message.error(text);
      }
      return;
    }
    resetNewGenerationDraft();
    updateNewGenerationDraft({ documentType });
    setSelectedTaskID({ kind: "none" });
    setNewChatTarget(homeWorkspaceId ? { kind: "workspace", workspaceId: homeWorkspaceId } : { kind: "none" });
    clearError();
    setActiveNav("dialogue");
    setNewChatNudgeKey((current) => current + 1);
  }, [clearError, homeWorkspaceId, recordError, refreshRecentFiles, resetNewGenerationDraft, t, updateNewGenerationDraft]);

  const pickHomeTaskFile = useCallback(async () => {
    const selected = await officecli.openFileDialog({
      filters: [{
        name: "Work files",
        extensions: ["xlsx", "csv", "pptx", "docx", "pdf", "png", "jpg", "jpeg", "webp"],
      }],
    });
    return selected || undefined;
  }, []);

  const pickHomeTaskDirectory = useCallback(async () => {
    const selected = await officecli.openDirectoryDialog();
    return selected || undefined;
  }, []);

  function analyzeTaskFromHome(input: HomeTaskIntake): HomeTaskAnalysis {
    const fallback = isGenerateDocumentType(input.documentType)
      ? input.documentType
      : isGenerateDocumentType(persistedSettings.defaults.documentType)
        ? persistedSettings.defaults.documentType
        : "pptx";
    const route = inferHomeTaskRoute(input, fallback);
    if (route.kind === "needs_source") {
      throw new Error(t("home.catalogSourceRequired"));
    }
    return {
      prompt: input.prompt.trim(),
      sourceFile: route.sourceFile,
      referenceDirectory: input.referenceDirectory,
      documentType: route.documentType,
      kind: route.kind,
      nextStep: route.kind === "catalog_cleanup"
        ? "configure"
        : "execute",
    };
  }

  async function startTaskFromHome(input: HomeTaskIntake) {
    const fallback = isGenerateDocumentType(input.documentType)
      ? input.documentType
      : isGenerateDocumentType(persistedSettings.defaults.documentType)
        ? persistedSettings.defaults.documentType
        : "pptx";
    const route = inferHomeTaskRoute(input, fallback);
    const taskPrompt = input.referenceDirectory
      ? `${input.prompt.trim()}\n\nReference directory: ${input.referenceDirectory}`
      : input.prompt;
    if (route.kind === "needs_source") {
      throw new Error(t("home.catalogSourceRequired"));
    }
    if (route.kind === "catalog_cleanup") {
      const file: RecentFile = {
        filePath: route.sourceFile,
        fileName: fileNameFromPath(route.sourceFile),
        documentType: "xlsx",
        source: "local",
        ...(homeWorkspaceId ? { workspaceId: homeWorkspaceId } : {}),
        lastOpenedAt: new Date().toISOString(),
      };
      await runSpreadsheetAction(async () => {
        const artifact = await officecli.openRecentFile(file);
        const grant = await officecli.issuePreviewToken(artifact);
        setSpreadsheetPreferredTool("catalog");
        setCatalogAutoScanFile(artifact.filePath);
        setSpreadsheetEntry({
          kind: "artifact",
          artifact,
          grant,
          ...(homeWorkspaceId ? { workspaceId: homeWorkspaceId } : {}),
        });
        clearError();
        setActiveNav("spreadsheet");
        void refreshRecentFiles(homeWorkspaceId);
      });
      return;
    }
    setSpreadsheetPreferredTool("assistant");
    setCatalogAutoScanFile(undefined);
    await submit({
      documentType: route.documentType,
      generationMode: generationModeForDocumentType(route.documentType),
      topic: summarizePrompt(input.prompt),
      prompt: taskPrompt,
      sourceFile: route.sourceFile,
      ...(homeWorkspaceId ? { workspaceId: homeWorkspaceId } : { noProject: true }),
      enableImages: persistedSettings.defaults.enableImages,
      imageQuality: persistedSettings.defaults.imageQuality,
    });
  }

  const selectHomeWorkspace = useCallback(async (workspaceId: string) => {
    await selectWorkspace(workspaceId);
    setHomeWorkspaceId(workspaceId);
    await refreshRecentFiles(workspaceId);
  }, [refreshRecentFiles, selectWorkspace]);

  const selectAllHomeFiles = useCallback(() => {
    setHomeWorkspaceId(undefined);
    void refreshRecentFiles();
  }, [refreshRecentFiles]);

  const renameWorkspace = useCallback(async (workspaceId: string, name: string) => {
    try {
      const renamed = await officecli.renameWorkspace(workspaceId, name);
      setWorkspaces((current) => current.map((workspace) => workspace.id === renamed.id ? renamed : workspace));
      clearError();
    } catch (error) {
      const text = errorMessage(error);
      void message.error(text);
    }
  }, [clearError]);

  const removeRecentFile = useCallback(async (filePath: string) => {
    try {
      await officecli.removeRecentFile(filePath);
      setRecentFiles((current) => current.filter((file) => file.filePath !== filePath));
    } catch (error) {
      void message.error(errorMessage(error));
    }
  }, []);

  const newGeneration = useCallback((workspaceId?: string) => {
    const alreadyOnBlankNewChat =
      !workspaceId &&
      activeNav === "dialogue" &&
      selectedTaskID.kind !== "task" &&
      !conversationId &&
      !lastError;
    if (alreadyOnBlankNewChat) {
      setNewChatNudgeKey((current) => current + 1);
      return;
    }
    if (workspaceId) {
      setNewChatTarget({ kind: "workspace", workspaceId });
      if (workspaceId !== activeWorkspace?.id) {
        void selectWorkspace(workspaceId);
      }
    } else {
      const selectedTask = selectedTaskID.kind === "task" ? state.tasks[selectedTaskID.id] : undefined;
      if (selectedTask?.workspaceId) {
        setNewChatTarget({ kind: "workspace", workspaceId: selectedTask.workspaceId });
      } else if (selectedTask) {
        setNewChatTarget({ kind: "none" });
      } else if (activeWorkspace) {
        setNewChatTarget({ kind: "workspace", workspaceId: activeWorkspace.id });
      } else {
        setNewChatTarget({ kind: "none" });
      }
    }
    setSelectedTaskID({ kind: "none" });
    clearError();
    setActiveNav("dialogue");
  }, [activeNav, activeWorkspace, clearError, conversationId, lastError, selectWorkspace, selectedTaskID, state.tasks]);

  const selectTask = useCallback((taskId: string) => {
    const taskWorkspaceId = state.tasks[taskId]?.workspaceId;
    if (taskWorkspaceId && taskWorkspaceId !== activeWorkspace?.id) {
      void selectWorkspace(taskWorkspaceId);
    }
    setNewChatTarget(taskWorkspaceId ? { kind: "workspace", workspaceId: taskWorkspaceId } : { kind: "none" });
    setSelectedTaskID({ kind: "task", id: taskId });
    setLastError(undefined);
    setActiveNav("dialogue");
  }, [state.tasks, activeWorkspace?.id, selectWorkspace]);

  const addWorkspace = useCallback(async () => {
    try {
      const picked = await officecli.openDirectoryDialog();
      if (!picked) return;
      const workspace = await officecli.addWorkspace(picked);
      setNewChatTarget({ kind: "workspace", workspaceId: workspace.id });
      refreshProjectLists();
    } catch (error) {
      const text = errorMessage(error);
      recordError(text, classifyError(text), extractStderr(text));
    }
  }, [refreshProjectLists, recordError]);

  const addWorkspaceFromPath = useCallback(async (path: string) => {
    try {
      const workspace = await officecli.addWorkspace(path);
      setNewChatTarget({ kind: "workspace", workspaceId: workspace.id });
      refreshProjectLists();
    } catch (error) {
      const text = errorMessage(error);
      recordError(text, classifyError(text), extractStderr(text));
    }
  }, [refreshProjectLists, recordError]);

  // Native drops carry no coordinates, so the hovered zone recorded during
  // dragover decides where the paths go: the sidebar's workspace list or the
  // home intake. Only armed on the home screen; DialogueScreens owns its own
  // onFileDrop subscription on other navs.
  useEffect(() => {
    if (activeNav !== "home") return undefined;
    return officecli.onFileDrop((paths) => {
      if (paths.length === 0) return;
      const zone = getHomeDropZone();
      setHomeDropZone(null);
      if (zone === "workspaces") {
        for (const path of paths) void addWorkspaceFromPath(path);
        return;
      }
      if (zone === "intake") {
        setDroppedTaskPaths((previous) => ({ paths, seq: (previous?.seq ?? 0) + 1 }));
      }
    });
  }, [activeNav, addWorkspaceFromPath]);

  const revealWorkspace = useCallback((workspacePath: string) => {
    void officecli.showItemInFolder(workspacePath).catch(() => officecli.openPath(workspacePath));
  }, []);

  const removeWorkspace = useCallback(async (workspaceId: string) => {
    try {
      await officecli.removeWorkspace(workspaceId);
      setWorkspaces((current) => current.filter((workspace) => workspace.id !== workspaceId));
      setNewChatTarget({ kind: "none" });
      await refreshProjectLists();
      clearError();
    } catch (error) {
      const text = errorMessage(error);
      recordError(text, classifyError(text), extractStderr(text));
    }
  }, [clearError, refreshProjectLists, recordError]);

  const continueGeneration = useCallback(async (documentType: string, prompt: string, referenceImages?: string[], imageRatio?: GenerateInput["imageRatio"], fps?: number) => {
    if (forceUpdate) {
      recordError("Update required before continuing", "setup");
      return;
    }
    const parentTaskId = conversationTasks.at(-1)?.id;
    const parentTask = parentTaskId ? state.tasks[parentTaskId] : undefined;
    const targetWorkspace = parentTask?.workspaceId
      ? workspaces.find((workspace) => workspace.id === parentTask.workspaceId)
      : (!parentTask ? activeWorkspace : undefined);
    const noProject = Boolean(parentTask && !parentTask.workspaceId);
    clearError();
    const topic = summarizePrompt(prompt);
    const localTaskId = createLocalTaskId();
    const generationMode = generationModeForDocumentType(documentType);
    const context: TaskContextPatch = {
      conversationId,
      parentTaskId,
      ...(targetWorkspace ? { workspaceId: targetWorkspace.id, workspacePath: targetWorkspace.path } : {}),
    };
    pendingGenerateRef.current = {
      localTaskId,
      context,
      input: {
        prompt,
        ...(generationMode ? { generationMode } : {}),
        referenceImages: referenceImages && referenceImages.length > 0 ? referenceImages : undefined,
        imageRatio,
        fps,
      },
      parentTaskId,
    };
    const pendingInput = pendingGenerateRef.current.input;
    setState((current) => attachUserInput(applyTaskEvent(current, {
      task_id: localTaskId,
      type: "task.started",
      ts: new Date().toISOString(),
      payload: {
        document_type: documentType,
        topic,
        message: "Task submitted",
      },
    }), localTaskId, pendingInput, parentTaskId, context));
    setSelectedTaskID({ kind: "task", id: localTaskId });
    setActiveNav("dialogue");
    setBusy(false);
    try {
      const result = await officecli.generate({
        documentType: documentType as GenerateInput["documentType"],
        workspaceId: targetWorkspace?.id,
        noProject,
        conversationId,
        parentTaskId,
        topic,
        prompt,
        ...(generationMode ? { generationMode } : {}),
        enableImages: persistedSettings.defaults.enableImages,
        imageQuality: persistedSettings.defaults.imageQuality,
        referenceImages,
        imageRatio,
        fps,
      });
      if (pendingGenerateRef.current?.localTaskId === localTaskId && result.taskId) {
        const pending = pendingGenerateRef.current;
        pendingGenerateRef.current = null;
        setState((current) => attachUserInput(deleteTask(current, localTaskId), result.taskId, pending.input, parentTaskId, pending.context));
        setSelectedTaskID({ kind: "task", id: result.taskId });
        setActiveNav("dialogue");
        refreshProjectLists();
      }
    } catch (error) {
      if (pendingGenerateRef.current?.localTaskId !== localTaskId) return;
      pendingGenerateRef.current = null;
      setState((current) => deleteTask(current, localTaskId));
      const text = errorMessage(error);
      recordError(text, classifyError(text), extractStderr(text));
    } finally {
      setBusy(false);
      nudgeForTaskTransition();
    }
  }, [forceUpdate, recordError, clearError, persistedSettings.defaults, nudgeForTaskTransition, conversationTasks, conversationId, state.tasks, workspaces, activeWorkspace, refreshProjectLists]);

  const continueModify = useCallback(async (documentType: string, prompt: string) => {
    if (forceUpdate) {
      recordError("Update required before continuing", "setup");
      return;
    }
    const parent = findModifySourceTask(conversationTasks, documentType);
    const sourceFile = parent?.artifact?.filePath;
    if (!sourceFile) {
      recordError("No source document to modify", "other");
      return;
    }
    const parentTaskId = parent?.id;
    const targetWorkspace = parent?.workspaceId
      ? workspaces.find((workspace) => workspace.id === parent.workspaceId)
      : (!parent ? activeWorkspace : undefined);
    const noProject = Boolean(parent && !parent.workspaceId);
    clearError();
    const topic = summarizePrompt(prompt);
    const localTaskId = createLocalTaskId();
    const context: TaskContextPatch = {
      conversationId,
      parentTaskId,
      ...(targetWorkspace ? { workspaceId: targetWorkspace.id, workspacePath: targetWorkspace.path } : {}),
    };
    pendingGenerateRef.current = {
      localTaskId,
      context,
      input: { prompt, sourceFile },
      parentTaskId,
    };
    const pendingInput = pendingGenerateRef.current.input;
    setState((current) => attachUserInput(applyTaskEvent(current, {
      task_id: localTaskId,
      type: "task.started",
      ts: new Date().toISOString(),
      payload: {
        document_type: documentType,
        topic,
        message: "Task submitted",
      },
    }), localTaskId, pendingInput, parentTaskId, context));
    setSelectedTaskID({ kind: "task", id: localTaskId });
    setActiveNav("dialogue");
    setBusy(false);
    try {
      const result = await officecli.modify({
        documentType: documentType as ModifyInput["documentType"],
        workspaceId: targetWorkspace?.id,
        noProject,
        conversationId,
        parentTaskId,
        sourceFile,
        prompt,
      });
      if (pendingGenerateRef.current?.localTaskId === localTaskId && result.taskId) {
        const pending = pendingGenerateRef.current;
        pendingGenerateRef.current = null;
        setState((current) => attachUserInput(deleteTask(current, localTaskId), result.taskId, pending.input, parentTaskId, pending.context));
        setSelectedTaskID({ kind: "task", id: result.taskId });
        setActiveNav("dialogue");
        refreshProjectLists();
      }
    } catch (error) {
      if (pendingGenerateRef.current?.localTaskId !== localTaskId) return;
      pendingGenerateRef.current = null;
      setState((current) => deleteTask(current, localTaskId));
      const text = errorMessage(error);
      recordError(text, classifyError(text), extractStderr(text));
    } finally {
      setBusy(false);
      nudgeForTaskTransition();
    }
  }, [forceUpdate, recordError, clearError, nudgeForTaskTransition, conversationTasks, conversationId, workspaces, activeWorkspace, refreshProjectLists]);

  const retry = useCallback(() => {
    clearError();
    setCapabilityStatus("Reconnecting...");
    setConnectAttempt((current) => current + 1);
  }, [clearError]);

  const openLogin = useCallback(() => {
    setActiveNav("login");
  }, []);

  const handleDeleteConversation = useCallback(async (targetConversationId: string) => {
    setState((current) => deleteConversation(current, targetConversationId));
    setWorkspaces((current) => current.map((workspace) => ({
      ...workspace,
      conversations: workspace.conversations.filter((conversation) => conversation.conversationId !== targetConversationId),
    })));
    setChats((current) => current.filter((conversation) => conversation.conversationId !== targetConversationId));
    setSelectedTaskID((current) => {
      if (current.kind !== "task") return current;
      return state.tasks[current.id]?.conversationId === targetConversationId ? { kind: "auto" } : current;
    });
    try {
      await officecli.deleteConversation(targetConversationId);
      refreshProjectLists();
      clearError();
    } catch (error) {
      const text = errorMessage(error);
      void message.error(text);
    }
  }, [clearError, refreshProjectLists, state.tasks]);

  const [deckPanelDismissedId, setDeckPanelDismissedId] = useState<string | null>(null);

  const openInlinePreview = useCallback(async (artifact: Artifact) => {
    if (previewGrant) {
      await officecli.revokePreviewToken(previewGrant.token).catch(() => {});
    }
    try {
      const grant = await officecli.issuePreviewToken(artifact);
      setPreviewGrant(grant);
      setPreviewArtifact(artifact);
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      message.error(`Preview unavailable: ${text}`);
    }
  }, [previewGrant]);

  useEffect(() => {
    const taskId = stageFirstTaskRef.current;
    if (!taskId) return;
    const task = state.tasks[taskId];
    if (!task) return;
    if (task.status === "completed" && task.artifact?.filePath) {
      stageFirstTaskRef.current = undefined;
      void openInlinePreview(task.artifact);
      return;
    }
    if (task.status === "failed" || task.status === "cancelled") {
      stageFirstTaskRef.current = undefined;
    }
  }, [openInlinePreview, state.tasks]);

  const openTaskFromHome = useCallback((taskId: string) => {
    const task = state.tasks[taskId];
    if (task?.status === "completed" && task.artifact?.filePath) {
      setSelectedTaskID({ kind: "task", id: taskId });
      void openInlinePreview(task.artifact);
      return;
    }
    // Keep active PPTX production on the home stage so its live status/events
    // remain visible. Opening it through the legacy conversation would lose
    // the production-stage context and make the task appear idle.
    if (task?.documentType === "pptx") {
      setSelectedTaskID({ kind: "task", id: taskId });
      setActiveNav("home");
      return;
    }
    selectTask(taskId);
  }, [openInlinePreview, selectTask, state.tasks]);

  const steerPptxTask = useCallback(async (_task: DesktopTask, instruction: string) => {
    await continueModify("pptx", instruction);
  }, [continueModify]);

  const resumePptxTask = useCallback(async (task: DesktopTask) => {
    await officecli.respond({ taskId: task.id, answer: "continue" });
  }, []);

  const openRecentFile = useCallback(async (file: RecentFile) => {
    try {
      if (isXlsxFile(file)) {
        await runSpreadsheetAction(async () => {
          const artifact = await officecli.openRecentFile(file);
          const grant = await officecli.issuePreviewToken(artifact);
          setSpreadsheetPreferredTool("assistant");
          setCatalogAutoScanFile(undefined);
          setSpreadsheetEntry({
            kind: "artifact",
            artifact,
            grant,
            ...(file.workspaceId ? { workspaceId: file.workspaceId } : homeWorkspaceId ? { workspaceId: homeWorkspaceId } : {}),
            ...(file.conversationId ? { conversationId: file.conversationId } : {}),
          });
          setActiveNav("spreadsheet");
          clearError();
          void refreshRecentFiles(homeWorkspaceId);
        });
        return;
      }
      const artifact = await officecli.openRecentFile(file);
      if (file.source === "generated") {
        const matchingTask = tasks.find((task) =>
          (file.taskId && task.id === file.taskId) ||
          (file.conversationId && task.conversationId === file.conversationId));
        if (matchingTask) selectTask(matchingTask.id);
      }
      await openInlinePreview(artifact);
      void refreshRecentFiles(homeWorkspaceId);
    } catch (error) {
      const text = errorMessage(error);
      if (isUnsupportedRecentFileError(text)) {
        void message.info(t("home.systemOpenFallback"));
        await officecli.openPath(file.filePath);
        return;
      }
      if (isMissingRecentFileError(text)) {
        void message.error({
          content: t("home.missingFile"),
          action: { label: t("home.removeRecentAction"), onClick: () => void removeRecentFile(file.filePath) },
        });
        return;
      }
      void message.error(isPermissionRecentFileError(text) ? t("home.permissionError") : text);
    }
  }, [clearError, homeWorkspaceId, openInlinePreview, refreshRecentFiles, removeRecentFile, runSpreadsheetAction, selectTask, t, tasks]);

  // Which recorded node of a deck's timeline is on screen. Null means the
  // newest deck — the one the task produced, or the one being drawn.
  const [timelineNodeId, setTimelineNodeId] = useState<string | null>(null);
  const closeInlinePreview = useCallback(async () => {
    if (previewGrant) {
      await officecli.revokePreviewToken(previewGrant.token).catch(() => {});
    }
    setPreviewGrant(null);
    setPreviewArtifact(null);
    setTimelineNodeId(null);
    setDeckPanelDismissedId(activeVibeTask?.id ?? null);
  }, [previewGrant, activeVibeTask?.id]);

  // ---- MOP live drawing --------------------------------------------------
  // First task.vibe_primitives for a task opens the presentation editor on a
  // blank draft and the replay sequencer inside PptxViewer draws the deck as
  // the primitives stream in. One draft per task; never steal an open preview.
  const [liveDraftTaskId, setLiveDraftTaskId] = useState<string | null>(null);

  const timelineTaskId = liveDraftTaskId ?? previewArtifact?.taskId ?? undefined;

  const openTimelineNode = useCallback(async (deck: TimelineDeck, node: TimelineNode) => {
    await openInlinePreview({
      taskId: timelineTaskId ?? "",
      filePath: deck.filePath,
      fileName: deck.fileName,
      documentType: "pptx",
    } as Artifact);
    setTimelineNodeId(node.id);
  }, [openInlinePreview, timelineTaskId]);

  const returnToLatestDeck = useCallback(async () => {
    const latest = timelineTaskId ? state.tasks[timelineTaskId]?.artifact : undefined;
    if (!latest?.filePath) return;
    await openInlinePreview(latest);
    setTimelineNodeId(null);
  }, [openInlinePreview, state.tasks, timelineTaskId]);

  const liveDraftAttemptsRef = useRef<Set<string>>(new Set());
  const liveDraftOpenRef = useRef(false);
  liveDraftOpenRef.current = Boolean(previewGrant);
  const liveCandidateTaskId = useMemo(() => {
    for (const taskID of state.taskOrder) {
      const task = state.tasks[taskID];
      // Only a still-active task qualifies: history replay on page load
      // restores completed tasks' primitives in the same state batch, and
      // redrawing a finished deck would look like a phantom generation.
      // The outline alone also qualifies — it lands well before the first
      // op frame, and opening the draft then lets the user read the deck's
      // shape while the slides are still being written.
      if (task && ((task.vibeOps?.length ?? 0) > 0 || task.vibeOutline) && ["starting", "running", "question", "plan_review"].includes(task.status)) {
        return taskID;
      }
    }
    return null;
  }, [state]);
  useEffect(() => {
    if (!liveCandidateTaskId || liveDraftAttemptsRef.current.has(liveCandidateTaskId)) return;
    if (liveDraftOpenRef.current) return;
    liveDraftAttemptsRef.current.add(liveCandidateTaskId);
    void (async () => {
      try {
        const draft = await officecli.createLivePptxDraft(liveCandidateTaskId);
        registerLiveDraft(draft.filePath, liveCandidateTaskId);
        const grant = await officecli.issuePreviewToken({
          taskId: liveCandidateTaskId,
          filePath: draft.filePath,
          fileName: draft.fileName,
          documentType: "pptx",
        } as Artifact);
        setPreviewGrant(grant);
        setPreviewArtifact({
          taskId: liveCandidateTaskId,
          filePath: draft.filePath,
          fileName: draft.fileName,
          documentType: "pptx",
        } as Artifact);
        setLiveTrace(false);
        setLiveDraftTaskId(liveCandidateTaskId);
      } catch {
        // Live drawing is an enhancement; generation itself is unaffected.
      }
    })();
  }, [liveCandidateTaskId]);
  // When the replay finishes, hand the preview over to the task's official
  // artifact: the reviewed deck with real images. The live draft was the
  // preview of the drawing; the artifact is the deliverable.
  useEffect(() => {
    const onFinished = (event: Event) => {
      const detail = (event as CustomEvent<VibeReplayFinishedDetail>).detail;
      if (!detail || detail.taskId !== liveDraftTaskId) return;
      const artifact = state.tasks[detail.taskId]?.artifact;
      if (!artifact?.filePath) return;
      window.setTimeout(() => {
        void (async () => {
          try {
            const grant = await officecli.issuePreviewToken(artifact);
            setPreviewGrant((current) => {
              if (current) void officecli.revokePreviewToken(current.token).catch(() => {});
              return grant;
            });
            setPreviewArtifact(artifact);
            setLiveDraftTaskId(null);
          } catch {
            // Keep showing the drawn draft; the artifact stays reachable from
            // the task card.
          }
        })();
      }, 1_500);
    };
    window.addEventListener(VIBE_REPLAY_FINISHED_EVENT, onFinished);
    return () => window.removeEventListener(VIBE_REPLAY_FINISHED_EVENT, onFinished);
  }, [liveDraftTaskId, state.tasks]);

  // Debug helper: `__officedexReplayDemo()` in the console replays the latest
  // (or a given) task's drawing from a fresh blank draft — the live-generation
  // experience on demand, no model calls, no credits. It bypasses the
  // active-status guard on purpose and ends with the normal handover to the
  // task's official artifact.
  const replayDemoRef = useRef<(source?: string | VibeOp[]) => Promise<string>>(async () => "not ready");
  const [liveTrace, setLiveTrace] = useState(false);
  // An op stream handed straight to the replay, with no task behind it —
  // a recovered recording, or one captured from a run that is long gone.
  const [replayOps, setReplayOps] = useState<VibeOp[] | undefined>();
  // A replay started from the console is a performance whatever it replays —
  // a recording or a finished task. Without this the task branch inherits
  // "already complete, so catch up fast" and the drawing finishes instantly.
  const [replayPerform, setReplayPerform] = useState(false);
  replayDemoRef.current = async (source?: string | VibeOp[]) => {
    const finish = (message: string) => {
      // The command is usually invoked bare in the console, so the resolved
      // message would go unseen; announce it there as well.
      console.info("[vibeReplayDemo]", message);
      return message;
    };
    const loaded =
      typeof source === "string" && /^(https?:)?\//.test(source)
        ? ((await (await fetch(source)).json()) as VibeOp[])
        : Array.isArray(source)
          ? source
          : undefined;
    if (loaded) return startReplay(`recording-${loaded.length}`, loaded);
    const taskId = typeof source === "string" ? source : undefined;
    const target = taskId ?? state.taskOrder.find((id) => (state.tasks[id]?.vibeOps?.length ?? 0) > 0);
    if (!target) {
      return finish("no task with drawing ops in this session — open the generated conversation in the left sidebar first (its events load on open), then rerun __officedexReplayDemo()");
    }
    const task = state.tasks[target];
    if (!task) return finish(`unknown task: ${target}`);
    const opCount = task.vibeOps?.length ?? 0;
    if (opCount === 0) return finish(`task ${target} has no drawing ops`);
    return startReplay(target, undefined, opCount);
  };
  const startReplay = async (target: string, ops?: VibeOp[], opCount = ops?.length ?? 0) => {
    const finish = (message: string) => {
      console.info("[vibeReplayDemo]", message);
      return message;
    };
    liveDraftAttemptsRef.current.delete(target);
    if (previewGrant) await officecli.revokePreviewToken(previewGrant.token).catch(() => {});
    const draft = await officecli.createLivePptxDraft(target);
    registerLiveDraft(draft.filePath, target);
    const artifact = { taskId: target, filePath: draft.filePath, fileName: draft.fileName, documentType: "pptx" } as Artifact;
    const grant = await officecli.issuePreviewToken(artifact);
    setPreviewGrant(grant);
    setPreviewArtifact(artifact);
    setReplayOps(ops);
    setReplayPerform(true);
    setLiveTrace(true);
    setLiveDraftTaskId(target);
    const from = ops ? "a recording" : `task ${target}`;
    return finish(`replaying ${opCount} ops of ${from} from a blank draft — each op is logged before it executes`);
  };
  useEffect(() => {
    const host = window as unknown as { __officedexReplayDemo?: (source?: string | VibeOp[]) => Promise<string> };
    host.__officedexReplayDemo = (source?: string | VibeOp[]) => replayDemoRef.current(source);
    return () => {
      delete host.__officedexReplayDemo;
    };
  }, []);

  const liveReplayFeed = useMemo(
    () =>
      buildReplayFeed({
        taskId: liveDraftTaskId,
        ops: replayOps,
        performing: replayPerform,
        trace: liveTrace,
        task: liveDraftTaskId ? state.tasks[liveDraftTaskId] : undefined,
      }),
    [liveDraftTaskId, liveTrace, replayOps, replayPerform, state.tasks],
  );

  const startSpreadsheetGeneration = useCallback(async (input: GenerateInput) => {
    clearError();
    try {
      await spreadsheet.startGeneration({
        ...input,
        enableImages: persistedSettings.defaults.enableImages,
        imageQuality: persistedSettings.defaults.imageQuality,
      });
      refreshProjectLists();
    } catch (error) {
      const text = errorMessage(error);
      recordError(text, classifyError(text), extractStderr(text));
      throw error;
    } finally {
      nudgeForTaskTransition();
    }
  }, [clearError, nudgeForTaskTransition, persistedSettings.defaults.enableImages, persistedSettings.defaults.imageQuality, recordError, refreshProjectLists, spreadsheet.startGeneration]);

  const startSpreadsheetModify = useCallback(async (input: ModifyInput) => {
    clearError();
    const continued = await runSpreadsheetAction(async () => {
      try {
        await spreadsheet.startModify(input);
        refreshProjectLists();
      } catch (error) {
        const text = errorMessage(error);
        recordError(text, classifyError(text), extractStderr(text));
        throw error;
      } finally {
        nudgeForTaskTransition();
      }
    });
    if (!continued) return;
  }, [clearError, nudgeForTaskTransition, recordError, refreshProjectLists, runSpreadsheetAction, spreadsheet.startModify]);

  const startSpreadsheetMarketingImage = useCallback(async (row: MarketingSheetRow, ratio: NonNullable<GenerateInput["imageRatio"]>) => {
    if (forceUpdate) throw new Error("Update required before continuing");
    clearError();
    try {
      const workspaceId = spreadsheet.session.workspaceId;
      const result = await officecli.generate({
        documentType: "img",
        topic: `营销图 · ${row.productName}${row.campaignChannel ? ` · ${row.campaignChannel}` : ""}`,
        prompt: row.prompt,
        ...(workspaceId ? { workspaceId } : { noProject: true }),
        ...(row.referenceImages.length > 0 ? { referenceImages: row.referenceImages } : {}),
        imageRatio: ratio,
        imageQuality: persistedSettings.defaults.imageQuality,
        enableImages: true,
      });
      void pollTaskHistoryUntilTerminal(
        result.taskId,
        () => officecli.getTaskHistory(50),
        (entry) => {
          setState((current) => {
            let next = current;
            for (const event of entry.events) next = applyTaskEvent(next, event);
            return attachTaskContext(next, entry.taskId, {
              conversationId: entry.conversationId,
              parentTaskId: entry.parentTaskId,
              workspaceId: entry.workspaceId,
              workspacePath: entry.workspacePath,
            });
          });
        },
      );
      refreshProjectLists();
      return { taskId: result.taskId };
    } catch (error) {
      const text = errorMessage(error);
      recordError(text, classifyError(text), extractStderr(text));
      throw error;
    } finally {
      nudgeForTaskTransition();
    }
  }, [clearError, forceUpdate, nudgeForTaskTransition, persistedSettings.defaults.imageQuality, recordError, refreshProjectLists, spreadsheet.session.workspaceId]);

  const changeNavigation = useCallback((key: NavKey) => {
    if (key === activeNavRef.current && !previewGrant) return;
    void runSpreadsheetAction(async () => {
      if (previewGrant) await closeInlinePreview();
      setActiveNav(key);
    });
  }, [closeInlinePreview, previewGrant, runSpreadsheetAction]);

  const waitForSpreadsheetWorkspace = useCallback(async () => {
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      if (spreadsheetWorkspaceRef.current) return spreadsheetWorkspaceRef.current;
      await delay(50);
    }
    throw new AgentClientToolDeferredError("等待表格工作区恢复超时，请从 Tasks 页面重试该 Run。");
  }, []);

  // What this page currently has open, for the client-tool host's pre-write check.
  const currentAgentDocumentPath = useCallback(
    () => spreadsheet.session.artifact?.filePath ?? previewArtifact?.filePath,
    [spreadsheet.session.artifact?.filePath, previewArtifact?.filePath],
  );

  const routeAgentClientToolSurface = useCallback(async (surface: string, run: AgentRun) => {
    if (surface === "pptx-editor" || surface === "docx-editor") {
      const expectedType = surface === "pptx-editor" ? "pptx" : "docx";
      const sourcePath = run.metadata?.source_path;
      if (previewArtifact && previewArtifact.documentType !== expectedType) {
        throw new AgentClientToolDeferredError(`当前预览不是 ${expectedType.toUpperCase()} 文档，请关闭后从 Tasks 页面恢复该 Run。`);
      }
      if (sourcePath && previewArtifact?.filePath !== sourcePath) {
        if (previewArtifact || previewGrant) {
          throw new AgentClientToolDeferredError("另一个文档仍在预览中；请先关闭它，再恢复该 Run。");
        }
        const file: RecentFile = {
          filePath: sourcePath,
          fileName: fileNameFromPath(sourcePath),
          documentType: expectedType,
          source: "local",
          lastOpenedAt: new Date().toISOString(),
        };
        const artifact = await officecli.openRecentFile(file);
        const grant = await officecli.issuePreviewToken(artifact);
        setPreviewArtifact(artifact);
        setPreviewGrant(grant);
      } else if (!sourcePath && !previewArtifact) {
        throw new AgentClientToolDeferredError(`Run ${run.id} 缺少可恢复的 source_path。`);
      }
      if (!await waitForActiveEditorSurface(surface as ActiveEditorSurface)) {
        throw new AgentClientToolDeferredError(`${expectedType.toUpperCase()} 编辑器尚未准备好，请从 Tasks 页面重试该 Run。`);
      }
      return;
    }
    const preferredTool: SpreadsheetAgentTool = surface === "spreadsheet.catalog-cleanup"
      ? "catalog"
      : surface === "spreadsheet.marketing"
        ? "campaign"
        : surface === "spreadsheet.jira"
          ? "jira"
          : surface === "spreadsheet.liquipedia"
            ? "liquipedia"
            : "assistant";
    const workbookPath = run.metadata?.workbook_path || run.metadata?.source_path;
    const currentPath = spreadsheet.session.artifact?.filePath;
    const requiresExistingWorkbook = surface === "spreadsheet"
      || surface === "spreadsheet.catalog-cleanup"
      || surface === "spreadsheet.marketing"
      || surface === "app-builder";
    if (
      workbookPath
      && (workbookPath !== currentPath || !spreadsheet.session.grant)
    ) {
      if (spreadsheet.session.dirty) {
        throw new AgentClientToolDeferredError("另一个工作簿存在未保存修改；请先保存或放弃修改，再恢复该 Run。");
      }
      const artifact = await officecli.openRecentFile({
        filePath: workbookPath,
        fileName: fileNameFromPath(workbookPath),
        documentType: "xlsx",
        source: "local",
        ...(run.metadata?.workspace_id ? { workspaceId: run.metadata.workspace_id } : {}),
        lastOpenedAt: new Date().toISOString(),
      });
      const grant = await officecli.issuePreviewToken(artifact);
      const previousToken = spreadsheet.session.grant?.token;
      setSpreadsheetEntry({
        kind: "artifact",
        artifact,
        grant,
        ...(run.metadata?.workspace_id ? { workspaceId: run.metadata.workspace_id } : {}),
      });
      if (previousToken && previousToken !== grant.token) {
        void officecli.revokePreviewToken(previousToken).catch(() => undefined);
      }
    } else if (!workbookPath && !currentPath && requiresExistingWorkbook) {
      throw new AgentClientToolDeferredError(`Run ${run.id} 缺少可恢复的 workbook_path。`);
    }
    setSpreadsheetPreferredTool(preferredTool);
    setCatalogAutoScanFile(undefined);
    setActiveNav("spreadsheet");
    const workspace = await waitForSpreadsheetWorkspace();
    if (surface === "app-builder") workspace.openAppBuilder();
  }, [previewArtifact, previewGrant, spreadsheet.session.artifact?.filePath, spreadsheet.session.dirty, spreadsheet.session.grant?.token, waitForSpreadsheetWorkspace]);

  const agentClientToolSurfaces = useMemo<AgentClientToolSurfaces>(() => {
    const workspace = () => {
      if (!spreadsheetWorkspaceRef.current) {
        throw new AgentClientToolDeferredError("表格工作区尚未恢复。");
      }
      return spreadsheetWorkspaceRef.current;
    };
    const saveWorkbook = async () => {
      if (!await workspace().save()) throw new Error("工作簿写入已经完成，但保存失败。");
      return { saved: true };
    };
    const genericWorkbookTools = {
      "workbook.snapshot": async (request: Parameters<NonNullable<AgentClientToolSurfaces[string][string]>>[0]) => (
        workspace().snapshot(parseWorkbookSnapshotRequest(request.arguments))
      ),
      "workbook.read_selection": async () => workspace().readSelection(),
      "workbook.write_cells": async (request: Parameters<NonNullable<AgentClientToolSurfaces[string][string]>>[0]) => (
        workspace().writeCells(parseWorkbookWriteCellsRequest(request.arguments))
      ),
      "workbook.format_cells": async (request: Parameters<NonNullable<AgentClientToolSurfaces[string][string]>>[0]) => (
        workspace().formatCells(parseWorkbookFormatCellsRequest(request.arguments))
      ),
      "workbook.stage_media": async (request: Parameters<NonNullable<AgentClientToolSurfaces[string][string]>>[0]) => (
        workspace().stageMedia(parseWorkbookStageMediaRequest(request.arguments))
      ),
    };
    const writeJiraSheet = async (response: ConfiguredJiraSyncResult | undefined) => {
      if (response?.status !== "completed" || !response.result) throw new Error(response?.message || "Jira Runtime did not return Sheet data.");
      const result: JiraSyncResult = response.result;
      if (spreadsheet.session.artifact) {
        await workspace().replaceManagedSheet({ ...result, keyColumn: "Issue Key", preserveColumns: ["OfficeDex Notes"] });
      } else {
        const artifact = await officecli.createWorkbookFromSheet({
          fileName: "Jira Issues.xlsx", sheetName: result.sheetName, headers: result.headers, rows: result.rows,
          workspaceId: spreadsheet.session.workspaceId,
        });
        await spreadsheet.openArtifact(artifact);
        void refreshRecentFiles(spreadsheet.session.workspaceId);
      }
      return { sheetName: result.sheetName, rows: result.fetched };
    };
    const writeLiquipediaSheet = async (response: ConfiguredLiquipediaSyncResult | undefined) => {
      if (response?.status !== "completed" || !response.result) throw new Error(response?.message || "Liquipedia Runtime did not return Sheet data.");
      const result: LiquipediaSyncResult = response.result;
      if (spreadsheet.session.artifact) {
        await workspace().replaceManagedSheet({ ...result, keyColumn: "Source URL" });
      } else {
        const artifact = await officecli.createWorkbookFromSheet({
          fileName: result.sheetName === "Liquipedia Updates" ? "Liquipedia Updates.xlsx" : "Liquipedia Tournaments.xlsx",
          sheetName: result.sheetName, headers: result.headers, rows: result.rows,
          workspaceId: spreadsheet.session.workspaceId,
        });
        await spreadsheet.openArtifact(artifact);
        void refreshRecentFiles(spreadsheet.session.workspaceId);
      }
      return { sheetName: result.sheetName, rows: result.fetched };
    };
    return {
      "spreadsheet": {
        ...genericWorkbookTools,
        "workbook.save": saveWorkbook,
      },
      "spreadsheet.catalog-cleanup": {
        ...genericWorkbookTools,
        "workbook.catalog_cleanup.apply": async (request) => {
          const batch = request.arguments.batch as CatalogCleanupBatch | undefined;
          if (!batch) throw new Error("Catalog cleanup Runtime did not provide a batch for writeback.");
          await workspace().applyCatalogCleanup(batch);
          return { applied: true, sheet_id: batch.sheetId };
        },
        "workbook.save": saveWorkbook,
      },
      "spreadsheet.marketing": {
        ...genericWorkbookTools,
        "workbook.insert_image": async (request) => {
          const batch = request.arguments.batch as MarketingBatchDraft | undefined;
          const rowIndex = numberValue(request.arguments.row_index);
          const workflowResult = recordValue(request.arguments.workflow_result);
          const filePath = stringValue(workflowResult.filePath) || stringValue(request.arguments.file_path);
          if (!batch || rowIndex < 0 || !filePath) throw new Error("Marketing Runtime did not persist enough workbook context to insert the image.");
          await workspace().insertMarketingImage(batch, rowIndex, filePath);
          return { inserted: true, file_path: filePath, row_index: rowIndex };
        },
        "workbook.set_status": async (request) => {
          const batch = request.arguments.batch as MarketingBatchDraft | undefined;
          const rowIndex = numberValue(request.arguments.row_index);
          const status = stringValue(request.arguments.status);
          if (!batch || rowIndex < 0 || !status) throw new Error("Marketing Runtime did not persist enough workbook context to update status.");
          await workspace().setMarketingStatus(batch, rowIndex, status);
          return { updated: true, status };
        },
        "workbook.save": saveWorkbook,
      },
      "spreadsheet.jira": {
        ...genericWorkbookTools,
        "workbook.write_managed_sheet": (request) => writeJiraSheet(request.arguments.workflow_result as ConfiguredJiraSyncResult | undefined),
        "workbook.save": saveWorkbook,
      },
      "spreadsheet.liquipedia": {
        ...genericWorkbookTools,
        "workbook.write_managed_sheet": (request) => writeLiquipediaSheet(request.arguments.workflow_result as ConfiguredLiquipediaSyncResult | undefined),
        "workbook.save": saveWorkbook,
      },
      "app-builder": {
        ...genericWorkbookTools,
        "app.preview": async (request) => {
          const inline = request.arguments.app as PublishedWorkbookApp | undefined;
          const appId = stringValue(request.arguments.app_id);
          const app = inline ?? loadPublishedWorkbookApps().find((candidate) => candidate.id === appId);
          if (!app) throw new Error("app.preview requires an app payload or an existing app_id.");
          workspace().previewApp(app);
          return { app_id: app.id, previewed: true };
        },
        "app.publish": async (request) => {
          const app = request.arguments.app as PublishedWorkbookApp | undefined;
          if (!app) throw new Error("App Builder Runtime did not provide the App payload.");
          savePublishedWorkbookApp(app);
          return { app_id: app.id, published_at: app.publishedAt };
        },
      },
      "pptx-editor": {
        "pptx.editor.save": (request) => executeActiveEditorClientTool("pptx-editor", request.tool, request.arguments),
      },
      "docx-editor": {
        "docx.editor.save": (request) => executeActiveEditorClientTool("docx-editor", request.tool, request.arguments),
      },
    };
  }, [refreshRecentFiles, spreadsheet.openArtifact, spreadsheet.session.artifact, spreadsheet.session.workspaceId]);

  const reportAgentClientToolError = useCallback((error: Error, run: AgentRun) => {
    const key = `${run.id}:${error.message}`;
    if (agentClientToolReportedErrorsRef.current.has(key)) return;
    agentClientToolReportedErrorsRef.current.add(key);
    void message.error(error.message);
  }, []);

  // The Living Tree Cockpit already embeds a PPTist preview at the slides_ready/completed
  // stages, so auto-opening the full-window PreviewPanel is no longer needed for vibe tasks.

  const sidePanel = previewGrant
    ? (
        <PreviewPanel
          grant={previewGrant}
          onClose={closeInlinePreview}
          artifact={previewArtifact}
          live={liveReplayFeed}
          timelineTaskId={timelineTaskId}
          timelineNodeId={timelineNodeId}
          onOpenTimelineNode={openTimelineNode}
          onTimelineNodeSwapped={(node) => setTimelineNodeId(node.id)}
          onTimelineNodeReturned={() => setTimelineNodeId(null)}
          onReturnToLatestDeck={returnToLatestDeck}
          onReplayGeneration={
            previewArtifact?.taskId && (state.tasks[previewArtifact.taskId]?.vibeOps?.length ?? 0) > 0
              ? () => {
                  void replayDemoRef.current(previewArtifact.taskId);
                }
              : undefined
          }
        />
      )
    : undefined;

  const sidebarUpdate: SidebarUpdateRowProps | undefined =
    appUpdate.release !== null &&
    appUpdate.status.updateAvailable &&
    !appUpdate.status.mandatory &&
    !appUpdate.dismissed
      ? {
        release: appUpdate.release,
        phase: appUpdate.phase,
        progress: appUpdate.progress,
        error: appUpdate.error,
        onUpdate: () => void appUpdate.download(),
        onInstall: () => void appUpdate.install(),
        onDismiss: appUpdate.dismiss,
      }
      : undefined;

  if (forceUpdate && appUpdate.release) {
    return (
      <>
        <DialogHost />
        <ToastHost />
        <ForceUpdateOverlay
          release={appUpdate.release}
          phase={appUpdate.phase}
          progress={appUpdate.progress}
          error={appUpdate.error}
          currentVersion={appUpdate.status.currentVersion}
          onUpdate={() => void appUpdate.download()}
          onInstall={() => void appUpdate.install()}
        />
      </>
    );
  }

  return (
    <>
      <DialogHost />
      <ToastHost />
      <AgentClientToolHost surfaces={agentClientToolSurfaces} routeToSurface={routeAgentClientToolSurface} onError={reportAgentClientToolError} currentDocumentPath={currentAgentDocumentPath} />
      <div className="app-frame">
        <Shell
        activeNav={activeNav}
        failed={Boolean(lastError)}
        errorKind={lastError ? errorKind : undefined}
        inspector={sidePanel}
        autoCollapseSidebarKey={activePptCanvasTaskId}
        credit={credit}
        hasCustomProvider={persistedSettings.llmProvider !== null}
        signal={sidebarTaskSignal}
        account={account}
        update={sidebarUpdate}
        workspaces={sidebarWorkspaces}
        chats={sidebarChats}
        activeWorkspaceId={activeNav === "home" ? homeWorkspaceId : activeNav === "spreadsheet" ? spreadsheet.session.workspaceId : activeWorkspace?.id}
        activeWorkspaceName={activeNav === "home" ? workspaces.find((workspace) => workspace.id === homeWorkspaceId)?.name : activeNav === "spreadsheet" ? workspaces.find((workspace) => workspace.id === spreadsheet.session.workspaceId)?.name : activeWorkspace?.name}
        selectedConversationId={conversationId}
        onNavChange={changeNavigation}
        onNewGeneration={newGeneration}
        onSelectWorkspace={activeNav === "home" ? selectHomeWorkspace : selectWorkspace}
        onSelectAllFiles={selectAllHomeFiles}
        onAddWorkspace={addWorkspace}
        onRenameWorkspace={renameWorkspace}
        onRevealWorkspace={revealWorkspace}
        onRemoveWorkspace={removeWorkspace}
        onSelectTask={selectTask}
        onDeleteConversation={handleDeleteConversation}
      >
        {activeNav === "home" ? (
          <HomeScreen
            files={recentFiles}
            attentionTasks={tasks}
            onRetryTask={retryTaskGeneration}
            onSteerTask={steerPptxTask}
            onResumeTask={resumePptxTask}
            loading={recentFilesLoading}
            error={recentFilesError}
            activeWorkspaceId={homeWorkspaceId}
            workspaces={workspaces}
            onCreate={createFromHome}
            onOpenFile={openRecentFile}
            onRemoveFile={removeRecentFile}
            onPickTaskFile={pickHomeTaskFile}
            onPickTaskDirectory={pickHomeTaskDirectory}
            droppedTaskPaths={droppedTaskPaths}
            onSelectWorkspace={selectHomeWorkspace}
            onSelectAllWorkspaces={selectAllHomeFiles}
            onAddWorkspace={addWorkspace}
            onAnalyzeTask={analyzeTaskFromHome}
            onStartTask={startTaskFromHome}
            onOpenTask={openTaskFromHome}
            onRetryRecentFiles={() => void refreshRecentFiles(homeWorkspaceId)}
          />
        ) : null}
        {activeNav === "dialogue" ? (
          <DialogueScreen
            tasks={conversationTasks}
            newGenerationDraft={newGenerationDraft}
            newChatNudgeKey={newChatNudgeKey}
            workspaces={workspaces}
            newChatTarget={newChatTarget}
            busy={busy}
            lastError={lastError}
            errorKind={errorKind}
            errorDetails={errorDetails}
            bridgeStatus={capabilityStatus}
            onSubmit={submit}
            onOpenSettings={() => setActiveNav("settings")}
            onOpenLogin={openLogin}
            onRetry={retry}
            onPreview={openInlinePreview}
            onNewGenerationDraftChange={updateNewGenerationDraft}
            onNewChatTargetChange={setNewChatTarget}
            onAddWorkspace={addWorkspace}
            onContinueGeneration={continueGeneration}
            onContinueModify={continueModify}
            onRetryTask={retryTaskGeneration}
            onForceCancel={(taskId) => {
              setState((current) => applyTaskEvent(current, {
                type: "task.cancelled",
                task_id: taskId,
                ts: new Date().toISOString(),
              }));
            }}
          />
        ) : null}
        {activeNav === "spreadsheet" ? (
          <SpreadsheetWorkspace
            ref={spreadsheetWorkspaceRef}
            session={spreadsheet.session}
            workspaceName={workspaces.find((workspace) => workspace.id === spreadsheet.session.workspaceId)?.name}
            onBack={() => changeNavigation("home")}
            onDirtyChange={spreadsheet.setDirty}
            onCanvasStateChange={spreadsheet.setCanvasState}
            onCanvasError={spreadsheet.setError}
            onCanvasSaveError={spreadsheet.setSaveError}
            onCanvasSessionClosed={(previewToken) => {
              setSpreadsheetEntry((current) => clearSpreadsheetEntryGrant(current, previewToken));
              void officecli.revokePreviewToken(previewToken).catch(() => undefined);
            }}
            agentPanel={(
              <SpreadsheetAgentPanel
                workspaceId={spreadsheet.session.workspaceId}
                artifactPath={spreadsheet.session.artifact?.filePath}
                conversationId={spreadsheet.session.conversationId}
                sourceTaskId={spreadsheet.session.artifact?.taskId ?? spreadsheet.session.taskId}
                task={spreadsheetTask}
                error={activeNav === "spreadsheet" ? lastError : undefined}
                onGenerate={startSpreadsheetGeneration}
                onModify={startSpreadsheetModify}
                onRespond={(input) => officecli.respond(input)}
                onCancel={(taskId) => officecli.cancel(taskId)}
                preferredTool={spreadsheetPreferredTool}
                catalogPanel={spreadsheet.session.artifact ? (
                  <SpreadsheetCatalogCleanupPanel
                    fileName={spreadsheet.session.artifact.fileName}
                    filePath={spreadsheet.session.artifact.filePath}
                    workspaceId={spreadsheet.session.workspaceId}
                    autoScan={spreadsheetPreferredTool === "catalog"
                      && catalogAutoScanFile === spreadsheet.session.artifact.filePath
                      && (spreadsheet.session.phase === "ready" || spreadsheet.session.phase === "dirty")}
                    onInspect={() => {
                      if (!spreadsheetWorkspaceRef.current) throw new Error("表格仍在加载，请稍后重试。");
                      return spreadsheetWorkspaceRef.current.inspectCatalogSheets();
                    }}
                    onPreview={(batch) => spreadsheetWorkspaceRef.current?.previewCatalogCleanup(batch)}
                    onApply={(batch) => {
                      if (!spreadsheetWorkspaceRef.current) return Promise.reject(new Error("表格编辑器已关闭。"));
                      return spreadsheetWorkspaceRef.current.applyCatalogCleanup(batch);
                    }}
                    onSave={() => spreadsheetWorkspaceRef.current?.save() ?? Promise.resolve(false)}
                  />
                ) : undefined}
                jiraPanel={(
                  <SpreadsheetJiraPanel
                    workbookReady={Boolean(spreadsheet.session.artifact)}
                    workbookPath={spreadsheet.session.artifact?.filePath}
                    workspaceId={spreadsheet.session.workspaceId}
                    onOpenSettings={() => setActiveNav("settings")}
                    onCreateWorkbook={async (result) => {
                      const artifact = await officecli.createWorkbookFromSheet({
                        fileName: "Jira Issues.xlsx",
                        sheetName: result.sheetName,
                        headers: result.headers,
                        rows: result.rows,
                        workspaceId: spreadsheet.session.workspaceId,
                      });
                      await spreadsheet.openArtifact(artifact);
                      void refreshRecentFiles(spreadsheet.session.workspaceId);
                    }}
                    onWriteSheet={(result) => {
                      if (!spreadsheetWorkspaceRef.current) return Promise.reject(new Error("表格编辑器已关闭。"));
                      return spreadsheetWorkspaceRef.current.replaceManagedSheet({ ...result, keyColumn: "Issue Key", preserveColumns: ["OfficeDex Notes"] });
                    }}
                    onSave={() => spreadsheetWorkspaceRef.current?.save() ?? Promise.resolve(false)}
                  />
                )}
                liquipediaPanel={(
                  <SpreadsheetLiquipediaPanel
                    workbookReady={Boolean(spreadsheet.session.artifact)}
                    workbookPath={spreadsheet.session.artifact?.filePath}
                    workspaceId={spreadsheet.session.workspaceId}
                    onOpenSettings={() => setActiveNav("settings")}
                    onCreateWorkbook={async (result) => {
                      const artifact = await officecli.createWorkbookFromSheet({
                        fileName: result.sheetName === "Liquipedia Updates" ? "Liquipedia Updates.xlsx" : "Liquipedia Tournaments.xlsx",
                        sheetName: result.sheetName,
                        headers: result.headers,
                        rows: result.rows,
                        workspaceId: spreadsheet.session.workspaceId,
                      });
                      await spreadsheet.openArtifact(artifact);
                      void refreshRecentFiles(spreadsheet.session.workspaceId);
                    }}
                    onWriteSheet={(result) => {
                      if (!spreadsheetWorkspaceRef.current) return Promise.reject(new Error("表格编辑器已关闭。"));
                      return spreadsheetWorkspaceRef.current.replaceManagedSheet({ ...result, keyColumn: "Source URL" });
                    }}
                    onSave={() => spreadsheetWorkspaceRef.current?.save() ?? Promise.resolve(false)}
                  />
                )}
                marketingPanel={(
                  <SpreadsheetMarketingPanel
                    tasks={state.tasks}
                    workbookPath={spreadsheet.session.artifact?.filePath}
                    workspaceId={spreadsheet.session.workspaceId}
                    creditBalance={creditStatus?.mode === "api_key"
                      ? creditStatus.paidKeyRemaining
                      : creditStatus?.mode !== "anonymous"
                        ? creditStatus?.hostedCreditBalance ?? null
                        : creditStatus?.anonymousCreditAvailable ?? null}
                    bridgeInterruptionKey={bridgeInterruptionKey}
                    existingImages={recentFiles}
                    onInspect={(assetKind) => {
                      if (!spreadsheetWorkspaceRef.current) throw new Error("表格仍在加载，请稍后重试。");
                      return spreadsheetWorkspaceRef.current.inspectMarketingSelection(assetKind);
                    }}
                    onAnalyze={(batch) => officecli.planSpreadsheetFields({
                      ...(spreadsheet.session.workspaceId
                        ? { workspaceId: spreadsheet.session.workspaceId }
                        : { noProject: true }),
                      sheetName: batch.sheetName,
                      headerRowIndex: batch.headerRowIndex,
                      headers: batch.source.headers,
                      sampleRows: batch.source.rows.slice(0, 5),
                    })}
                    onMappingChange={(mapping) => spreadsheetWorkspaceRef.current?.setMarketingMapping(mapping)}
                    mappingStorageKey={spreadsheet.session.artifact?.filePath}
                    onPrepare={(batch) => spreadsheetWorkspaceRef.current?.prepareMarketingBatch(batch)}
                    onSetStatus={(batch, rowIndex, status) => {
                      if (!spreadsheetWorkspaceRef.current) return Promise.reject(new Error("表格编辑器已关闭。"));
                      return spreadsheetWorkspaceRef.current.setMarketingStatus(batch, rowIndex, status);
                    }}
                    onInsertImage={(batch, rowIndex, filePath) => {
                      if (!spreadsheetWorkspaceRef.current) return Promise.reject(new Error("表格编辑器已关闭。"));
                      return spreadsheetWorkspaceRef.current.insertMarketingImage(batch, rowIndex, filePath);
                    }}
                    onGenerate={startSpreadsheetMarketingImage}
                    onSave={() => spreadsheetWorkspaceRef.current?.save() ?? Promise.resolve(false)}
                  />
                )}
              />
            )}
          />
        ) : null}
        {activeNav === "settings" ? (
          <SettingsScreen
            onCreditRefresh={nudgeForTaskTransition}
            onOpenLogin={openLogin}
            activity={(
            <ActivityPanel
              tasks={tasks}
              onSelectTask={selectTask}
              onViewed={setActivityVisible}
              onDeleteConversation={(conversationId) => void handleDeleteConversation(conversationId)}
              onOpenArtifact={(artifact) => void openRecentFile({
                filePath: artifact.filePath,
                fileName: artifact.fileName,
                documentType: artifact.documentType,
                source: "generated",
                lastOpenedAt: new Date().toISOString(),
                ...(artifact.taskId ? { taskId: artifact.taskId } : {}),
              })}
            />
            )}
          />
        ) : null}
        {activeNav === "login" ? <LoginScreen /> : null}
        </Shell>
      </div>
      <UnsavedChangesDialog
        open={unsavedDialogOpen}
        saving={unsavedDialogSaving}
        onSave={async () => {
          await continuePendingSpreadsheetAction(false);
          return !unsavedDialogOpen;
        }}
        onDiscard={() => void continuePendingSpreadsheetAction(true)}
        onCancel={cancelPendingSpreadsheetAction}
      />
    </>
  );
}

function summarizePrompt(prompt: string) {
  const normalized = prompt.trim().replace(/\s+/g, " ");
  return normalized.length > 24 ? `${normalized.slice(0, 24)}...` : normalized || "Untitled generation";
}

function initialNavFromLocation(): NavKey {
  return new URLSearchParams(window.location.search).get("view") === "dialogue" ? "dialogue" : "home";
}

function numberValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : -1;
}

function isXlsxArtifact(artifact: Artifact): boolean {
  return artifact.documentType.toLowerCase() === "xlsx" || artifact.fileName.toLowerCase().endsWith(".xlsx");
}

function isXlsxFile(file: RecentFile): boolean {
  return file.documentType.toLowerCase() === "xlsx" || file.fileName.toLowerCase().endsWith(".xlsx");
}

function isUnsupportedRecentFileError(message: string): boolean {
  return message.toLowerCase().includes("unsupported preview file type");
}

function isMissingRecentFileError(message: string): boolean {
  const normalized = message.toLowerCase();
  return normalized.includes("recent file is unavailable") || normalized.includes("no such file") || normalized.includes("not found");
}

function isPermissionRecentFileError(message: string): boolean {
  const normalized = message.toLowerCase();
  return normalized.includes("permission") || normalized.includes("access denied");
}

function createNewGenerationDraft(input: Partial<GenerateInput> = {}): NewGenerationDraft {
  const documentType = input.documentType ?? defaultGenerateInput.documentType ?? "pptx";
  const defaultGenerationMode = generationModeForDocumentType(documentType);
  const generationMode = defaultGenerationMode ? normalizeGenerationMode(input.generationMode ?? defaultGenerateInput.generationMode) : undefined;
  return {
    documentType,
    ...(generationMode ? { generationMode } : {}),
    topic: input.topic ?? "",
    prompt: input.prompt ?? "",
    sourceFile: input.sourceFile,
    referenceImages: input.referenceImages,
    imageRatio: input.imageRatio ?? defaultGenerateInput.imageRatio,
    fps: input.fps ?? defaultGenerateInput.fps,
  };
}

function createLocalTaskId(): string {
  return `local-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function documentTypeFromTask(task: DesktopTask): GenerateInput["documentType"] {
  const value = task.documentType || task.artifact?.documentType;
  return isGenerateDocumentType(value) ? value : defaultGenerateInput.documentType ?? "pptx";
}

function isGenerateDocumentType(value: unknown): value is GenerateInput["documentType"] {
  return value === "pptx" || value === "docx" || value === "xlsx" || value === "report" || value === "img" || value === "gif";
}

function promiseWithTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error(message)), timeoutMs);
    promise.then(
      (value) => {
        window.clearTimeout(timeout);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(timeout);
        reject(error);
      },
    );
  });
}

function stringOrUndef(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function extractStderr(text: string): string | undefined {
  const marker = "stderr:\n";
  const idx = text.indexOf(marker);
  return idx >= 0 ? text.slice(idx + marker.length).trim() : undefined;
}

function classifyError(text: string, stderr?: string): FailureKind {
  const haystack = `${text}\n${stderr || ""}`.toLowerCase();
  if (
    haystack.includes("login") ||
    haystack.includes("sign in") ||
    haystack.includes("setup is incomplete") ||
    haystack.includes("license_check_failed") ||
    haystack.includes("auth_error") ||
    haystack.includes("api key") ||
    haystack.includes("unauthorized")
  ) {
    return "auth";
  }
  if (
    haystack.includes("enoent") ||
    haystack.includes("not configured") ||
    haystack.includes("binary not found")
  ) {
    return "setup";
  }
  if (
    haystack.includes("agent-bridge is not running") ||
    haystack.includes("agent-bridge exited") ||
    haystack.includes("agent-bridge stopped") ||
    haystack.includes("request timed out") ||
    haystack.includes("reconnection failed") ||
    haystack.includes("spawn")
  ) {
    return "connection";
  }
  if (
    haystack.includes("llm_request_failed") ||
    haystack.includes("status=429") ||
    haystack.includes("rate limit") ||
    haystack.includes("saturated") ||
    haystack.includes("饱和") ||
    haystack.includes("generation failed")
  ) {
    return "task";
  }
  return "other";
}
