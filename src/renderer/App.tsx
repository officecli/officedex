import { DialogHost, ToastHost, toast as message } from "./ui";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AgentRun, Artifact, BridgeEvent, ConfiguredJiraSyncResult, ConfiguredLiquipediaSyncResult, DesktopTask, GenerateInput, JiraSyncResult, LiquipediaSyncResult, ModifyInput, PreviewGrant, RecentFile, TaskHistoryEntry, TaskQuestionAnswer, WorkspaceSummary } from "../shared/types";
import { AgentClientToolDeferredError, AgentClientToolHost, type AgentClientToolSurfaces } from "./AgentClientToolHost";
import { executeActiveEditorClientTool, waitForActiveEditorSurface, type ActiveEditorSurface } from "./activeEditorClientTools";
import { applyTaskEvent, attachTaskContext, attachUserInput, createInitialTaskState, deleteTask, finishTaskContinuing, getRunLineage, markTaskContinuing, restoreTaskInteractiveGate, type TaskContextPatch, type TaskState } from "./taskState";
import { officecli } from "./bridge";
import { defaultGenerateInput, type NavKey } from "./defaults";
import { getHomeDropZone, setHomeDropZone } from "./homeDropZone";
import type { SidebarAccount, SidebarDocument } from "./components/ProjectSidebar";
import { Shell } from "./components/Shell";
import { PreviewPanel } from "./components/PreviewPanel";
import { buildReplayFeed, liveDraftFor, registerLiveDraft } from "./presentation/vibeReplay";
import type { TimelineDeck, TimelineNode, VibeOp } from "../shared/types";
import type { SidebarUpdateRowProps } from "./components/SidebarUpdateRow";
import { ForceUpdateOverlay } from "./components/ForceUpdateOverlay";
import { ActivityPanel } from "./screens/DataScreens";
import { LoginScreen, SettingsScreen } from "./screens/SettingsScreens";
import { HomeScreen } from "./screens/HomeScreen";
import { buildReferenceTextPrompt } from "./referenceTextPrompt";
import { inferHomeTaskRoute, type HomeTaskIntake } from "./homeIntake";
import { DocumentWorkspace } from "./document";
import { ProgressivePptxStage } from "./presentation/ProgressivePptxStage";
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
import { parseWorkbookAddChartRequest, parseWorkbookFormatCellsRequest, parseWorkbookSnapshotRequest, parseWorkbookStageMediaRequest, parseWorkbookWriteCellsRequest } from "./spreadsheet/workbookClientTools";
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
import { respondToPlanReview } from "./presentation/planReviewResponse";
import { responseForPptxQuestion } from "./presentation/pptxQuestionResponse";
import { errorMessage, recordValue, trimmedStringValue as stringValue } from "./utils/values";
import { fileExtension, fileNameFromPath } from "./utils/path";
import { delay } from "./utils/timing";

type SelectedTask =
  | { kind: "auto" }
  | { kind: "none" }
  | { kind: "task"; id: string };

type StoredAppRoute = { nav: NavKey; taskId?: string };

const APP_ROUTE_STORAGE_KEY = "officedex.appRoute";

export function readStoredAppRoute(storage?: Pick<Storage, "getItem">): StoredAppRoute {
  try {
    const target = storage ?? (typeof sessionStorage !== "undefined" ? sessionStorage : undefined);
    const raw = target?.getItem(APP_ROUTE_STORAGE_KEY);
    if (!raw) return { nav: initialNavFromLocation() };
    const parsed = JSON.parse(raw) as Partial<StoredAppRoute>;
    const nav = parsed.nav;
    if (nav !== "home" && nav !== "document" && nav !== "spreadsheet" && nav !== "settings" && nav !== "login") {
      return { nav: initialNavFromLocation() };
    }
    const taskId = typeof parsed.taskId === "string" && parsed.taskId.trim() ? parsed.taskId.trim() : undefined;
    return { nav, ...(nav === "document" && taskId ? { taskId } : {}) };
  } catch {
    return { nav: initialNavFromLocation() };
  }
}

export function writeStoredAppRoute(route: StoredAppRoute, storage?: Pick<Storage, "setItem">): void {
  try {
    const target = storage ?? (typeof sessionStorage !== "undefined" ? sessionStorage : undefined);
    target?.setItem(APP_ROUTE_STORAGE_KEY, JSON.stringify(route));
  } catch {
    // Route persistence is best-effort; in-memory navigation remains usable.
  }
}

type FailureKind = "connection" | "auth" | "task" | "setup" | "other";

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

export function hydrateTaskHistory(state: TaskState, entries: TaskHistoryEntry[]): TaskState {
  let next = state;
  for (const entry of entries) {
    if (next.tasks[entry.taskId]) continue;
    for (const event of entry.events) next = applyTaskEvent(next, event);
    next = attachTaskContext(next, entry.taskId, {
      createdAt: entry.createdAt,
      conversationId: entry.conversationId,
      parentTaskId: entry.parentTaskId,
      workspaceId: entry.workspaceId,
      workspacePath: entry.workspacePath,
    });
  }
  return next;
}

function taskCreatedTimestamp(document: SidebarDocument): number {
  if (!document.createdAt) return Number.NEGATIVE_INFINITY;
  const parsed = Date.parse(document.createdAt);
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

export function sortSidebarDocuments(documents: SidebarDocument[]): SidebarDocument[] {
  return [...documents].sort((a, b) => {
    const aTime = taskCreatedTimestamp(a);
    const bTime = taskCreatedTimestamp(b);
    if (aTime !== bTime) return bTime - aTime;
    return a.id.localeCompare(b.id);
  });
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
  const initialRoute = useMemo(() => readStoredAppRoute(), []);
  const [state, setState] = useState<TaskState>(() => createInitialTaskState());
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
  const [recentFiles, setRecentFiles] = useState<RecentFile[]>([]);
  const [recentFilesLoading, setRecentFilesLoading] = useState(true);
  const [recentFilesError, setRecentFilesError] = useState<string>();
  const [homeWorkspaceId, setHomeWorkspaceId] = useState<string>();
  const [selectedTaskID, setSelectedTaskID] = useState<SelectedTask>(() => initialRoute.taskId ? { kind: "task", id: initialRoute.taskId } : { kind: "auto" });
  const [activeNav, setActiveNav] = useState<NavKey>(initialRoute.nav);
  const loginReturnNavRef = useRef<NavKey>("home");
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
  /**
   * The optimistic tasks this page has submitted but whose real ids have not
   * come back yet, keyed by the local placeholder id.
   *
   * A map rather than a slot: two submissions can be in flight at once, and a
   * single slot meant the second one overwrote the first's prompt, parent, and
   * conversation. The only thing that ever resolves an entry is the generate/
   * modify RPC that created it — a task event carrying some other id proves
   * nothing about which submission it belongs to.
   */
  const pendingGenerateRef = useRef<Map<string, PendingGenerate>>(new Map());
  // A newly submitted task is shown in the Home stage shell first. Once its
  // artifact is available, the existing PreviewPanel becomes the focused
  // artifact stage. The ref scopes auto-opening to this submission only.
  const stageFirstTaskRef = useRef<string | undefined>(undefined);
  const [stageFirstTaskId, setStageFirstTaskId] = useState<string>();
  const agentClientToolReportedErrorsRef = useRef(new Set<string>());
  const { settings: persistedSettings, loading: settingsLoading } = useSettings();
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
    officecli.listWorkspaces()
      .then((workspaceItems) => {
        setWorkspaces(workspaceItems);
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
        // Native OfficeCLI Runtime tasks survive the stdio bridge process and
        // are reattached after reconnect. Treat this as a transport outage,
        // not a task failure; authoritative task/status or later task events
        // decide whether any individual run actually failed.
        return;
      }
      // A task event names the task it belongs to and nothing else. It used to
      // be treated as evidence that the newest optimistic submission had just
      // been assigned that id, which is only true when exactly one submission
      // is in flight: with two, an event from the older run adopted the newer
      // run's prompt, parent, and conversation id, merging both into one
      // lineage. The invoke RPC that created a placeholder is the only thing
      // that can resolve it, so reduce the event and stop there.
      let settledTask: DesktopTask | undefined;
      setState((current) => {
        const next = applyTaskEvent(current, event);
        if (event.task_id) settledTask = next.tasks[event.task_id];
        return next;
      });
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
        setState((current) => hydrateTaskHistory(current, entries));
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
          let next = current;
          for (const entry of entries) {
            // History is authoritative after a bridge response. Do not limit
            // reconciliation to the pre-refresh status: a task can have
            // reached failed/completed while the renderer still thinks it is
            // in plan_review.
            const beforeEntry = next;
            for (const event of entry.events) next = applyTaskEvent(next, event);
            if (next !== beforeEntry) {
            next = attachTaskContext(next, entry.taskId, {
                createdAt: entry.createdAt,
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

  const conversationTasks = useMemo(() => {
    if (!conversationId) return [];
    return getRunLineage(state, conversationId);
  }, [state, conversationId]);
  const documentTask = conversationTasks.at(-1)
    ?? (selectedTaskID.kind === "task" ? state.tasks[selectedTaskID.id] : undefined);

  useEffect(() => {
    writeStoredAppRoute({
      nav: activeNav,
      ...(activeNav === "document" && selectedTaskID.kind === "task" ? { taskId: selectedTaskID.id } : {}),
    });
  }, [activeNav, selectedTaskID]);

  useEffect(() => {
    if (activeNav !== "document" || documentTask || state.taskOrder.length === 0) return;
    const fallback = state.taskOrder
      .map((taskId) => state.tasks[taskId])
      .find((task) => task && ["starting", "running", "question", "plan_review"].includes(task.status))
      ?? state.tasks[state.taskOrder[0]];
    if (fallback) setSelectedTaskID({ kind: "task", id: fallback.id });
  }, [activeNav, documentTask, state.taskOrder, state.tasks]);
  const activeVibeTask = useMemo(
    () => conversationTasks.find((task) => task.documentType === "pptx" && task.vibeTree),
    [conversationTasks],
  );
  const tasks = useMemo(() => state.taskOrder.map((taskID) => state.tasks[taskID]).filter(Boolean), [state]);
  const sidebarDocuments = useMemo<SidebarDocument[]>(() => {
    const byPath = new Map<string, SidebarDocument>();
    for (const file of recentFiles) {
      byPath.set(file.filePath, {
        id: file.taskId || `file:${file.filePath}`,
        title: file.fileName,
        documentType: file.documentType,
        filePath: file.filePath,
        conversationId: file.conversationId,
        workspaceId: file.workspaceId,
        status: "completed",
      });
    }
    const pending: SidebarDocument[] = [];
    for (const task of tasks) {
      const item: SidebarDocument = {
        id: task.id,
        createdAt: task.createdAt || task.events.map((event) => event.ts).find((ts): ts is string => Boolean(ts)),
        title: task.artifact?.fileName || task.topic || task.userInput?.prompt || t("tasks.untitled"),
        documentType: documentTypeFromTask(task),
        filePath: task.artifact?.filePath,
        conversationId: task.conversationId,
        workspaceId: task.workspaceId,
        status: task.status,
      };
      if (task.artifact?.filePath) byPath.set(task.artifact.filePath, item);
      else if (["starting", "running", "question", "plan_review", "failed"].includes(task.status)) pending.push(item);
    }
    return sortSidebarDocuments([...pending, ...byPath.values()]).slice(0, 40);
  }, [recentFiles, t, tasks]);
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
    const relatedTasks = getRunLineage(state, activeConversationId);
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
  async function submit(values: GenerateInput) {
    if (forceUpdate) {
      recordError("Update required before continuing", "setup");
      return;
    }
    clearError();
    const topic = values.topic || summarizePrompt(values.prompt);
    const localTaskId = createLocalTaskId();
    const submittedValues = normalizeGenerateInputForGeneration(values);
    const noProject = values.noProject === true || !values.workspaceId;
    const targetWorkspace = noProject ? undefined : workspaces.find((workspace) => workspace.id === values.workspaceId);
    const context: TaskContextPatch = {
      conversationId: localTaskId,
      ...(targetWorkspace ? { workspaceId: targetWorkspace.id, workspacePath: targetWorkspace.path } : {}),
    };
    const pending: PendingGenerate = {
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
    pendingGenerateRef.current.set(localTaskId, pending);
    stageFirstTaskRef.current = localTaskId;
    setStageFirstTaskId(localTaskId);
    const pendingInput = pending.input;
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
    setActiveNav("document");
    setBusy(false);
    try {
      const generateInput: GenerateInput = noProject
        ? { ...submittedValues, topic, noProject: true, workspaceId: undefined }
        : { ...submittedValues, topic, workspaceId: targetWorkspace?.id };
      const result = await officecli.generate(generateInput);
      if (pendingGenerateRef.current.delete(localTaskId) && result.taskId) {
        const actualContext = { ...pending.context, conversationId: result.taskId };
        setState((current) => attachUserInput(deleteTask(current, localTaskId), result.taskId, pending.input, undefined, actualContext));
        setSelectedTaskID({ kind: "task", id: result.taskId });
        if (stageFirstTaskRef.current === localTaskId) {
          stageFirstTaskRef.current = result.taskId;
          setStageFirstTaskId(result.taskId);
        }
        setActiveNav("document");
        refreshProjectLists();
      }
    } catch (error) {
      if (!pendingGenerateRef.current.delete(localTaskId)) return;
      if (stageFirstTaskRef.current === localTaskId) {
        stageFirstTaskRef.current = undefined;
        setStageFirstTaskId(undefined);
      }
      setState((current) => deleteTask(current, localTaskId));
      const text = errorMessage(error);
      recordError(text, classifyError(text), extractStderr(text));
      setSelectedTaskID({ kind: "none" });
      setActiveNav("home");
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
      clearError();
    } catch (error) {
      const text = errorMessage(error);
      recordError(text, classifyError(text), extractStderr(text));
    }
  }, [clearError, recordError]);

  const pickHomeTaskFile = useCallback(async () => {
    const selected = await officecli.openFileDialog({
      filters: [{
        name: "Work files",
        extensions: ["xlsx", "csv", "pptx", "docx", "pdf", "txt", "md", "png", "jpg", "jpeg", "webp"],
      }],
    });
    return selected || undefined;
  }, []);

  const pickHomeTaskDirectory = useCallback(async () => {
    const selected = await officecli.openDirectoryDialog();
    return selected || undefined;
  }, []);

  const pickHomeReferenceImages = useCallback(async () => {
    const selected = await officecli.openMultiFileDialog({
      filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "gif"] }],
    });
    return selected ?? [];
  }, []);

  const pickHomeReferenceTextFiles = useCallback(async () => {
    const selected = await officecli.openMultiFileDialog({
      filters: [{ name: "Text files", extensions: ["txt", "md", "markdown", "csv", "tsv", "log", "json"] }],
    });
    return selected ?? [];
  }, []);

  async function startTaskFromHome(input: HomeTaskIntake) {
    const fallback = isGenerateDocumentType(input.documentType)
      ? input.documentType
      : isGenerateDocumentType(persistedSettings.defaults.documentType)
        ? persistedSettings.defaults.documentType
        : "pptx";
    const route = inferHomeTaskRoute(input, fallback);
    // Attached text is read here and inlined, because the runtime runs in a
    // separate process that cannot open the user's files itself.
    let groundedPrompt = input.prompt;
    if (input.referenceTextFiles?.length) {
      const documents = await officecli.readLocalTextDocuments(input.referenceTextFiles);
      groundedPrompt = buildReferenceTextPrompt(input.prompt, documents);
    }
    const taskPrompt = input.referenceDirectory
      ? `${groundedPrompt.trim()}\n\nReference directory: ${input.referenceDirectory}`
      : groundedPrompt;
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
    if (route.documentType === "xlsx") {
      setSpreadsheetPreferredTool("assistant");
      setCatalogAutoScanFile(undefined);
      setSpreadsheetEntry({ kind: "new", ...(homeWorkspaceId ? { workspaceId: homeWorkspaceId } : {}) });
      setActiveNav("spreadsheet");
      clearError();
      try {
        await spreadsheet.startGeneration({
          documentType: "xlsx",
          generationMode: generationModeForDocumentType("xlsx"),
          topic: summarizePrompt(input.prompt),
          prompt: taskPrompt,
          sourceFile: route.sourceFile,
          ...(homeWorkspaceId ? { workspaceId: homeWorkspaceId } : { noProject: true }),
          enableImages: persistedSettings.defaults.enableImages,
          imageQuality: persistedSettings.defaults.imageQuality,
        });
        refreshProjectLists();
      } catch (error) {
        const text = errorMessage(error);
        recordError(text, classifyError(text), extractStderr(text));
        setActiveNav("home");
        throw error;
      } finally {
        nudgeForTaskTransition();
      }
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
      ...((route.documentType === "img" || route.documentType === "gif") && input.referenceImages?.length ? { referenceImages: input.referenceImages } : {}),
      ...(route.documentType === "img" && input.imageRatio ? { imageRatio: input.imageRatio } : {}),
      ...(route.documentType === "gif" && input.fps ? { fps: input.fps } : {}),
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
    // Home is the inbox, not the currently selected production stage. Clear
    // the transient stage selection so clicking Home always returns to the
    // actual home surface, even when Home is already the active nav item.
    stageFirstTaskRef.current = undefined;
    setStageFirstTaskId(undefined);
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

  const selectTask = useCallback((taskId: string) => {
    const taskWorkspaceId = state.tasks[taskId]?.workspaceId;
    if (taskWorkspaceId && taskWorkspaceId !== activeWorkspace?.id) {
      void selectWorkspace(taskWorkspaceId);
    }
    setSelectedTaskID({ kind: "task", id: taskId });
    setLastError(undefined);
    setActiveNav("document");
  }, [state.tasks, activeWorkspace?.id, selectWorkspace]);

  const addWorkspace = useCallback(async () => {
    try {
      const picked = await officecli.openDirectoryDialog();
      if (!picked) return;
      await officecli.addWorkspace(picked);
      refreshProjectLists();
    } catch (error) {
      const text = errorMessage(error);
      recordError(text, classifyError(text), extractStderr(text));
    }
  }, [refreshProjectLists, recordError]);

  const addWorkspaceFromPath = useCallback(async (path: string) => {
    try {
      await officecli.addWorkspace(path);
      refreshProjectLists();
    } catch (error) {
      const text = errorMessage(error);
      recordError(text, classifyError(text), extractStderr(text));
    }
  }, [refreshProjectLists, recordError]);

  // Native drops carry no coordinates, so the hovered zone recorded during
  // dragover decides where the paths go: the sidebar's workspace list or the
  // home intake. It is intentionally active only on Home.
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
    const pending: PendingGenerate = {
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
    pendingGenerateRef.current.set(localTaskId, pending);
    const pendingInput = pending.input;
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
    setActiveNav("document");
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
      if (pendingGenerateRef.current.delete(localTaskId) && result.taskId) {
        setState((current) => attachUserInput(deleteTask(current, localTaskId), result.taskId, pending.input, parentTaskId, pending.context));
        setSelectedTaskID({ kind: "task", id: result.taskId });
        setActiveNav("document");
        refreshProjectLists();
      }
    } catch (error) {
      if (!pendingGenerateRef.current.delete(localTaskId)) return;
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
    const pending: PendingGenerate = {
      localTaskId,
      context,
      input: { prompt, sourceFile },
      parentTaskId,
    };
    pendingGenerateRef.current.set(localTaskId, pending);
    const pendingInput = pending.input;
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
    setActiveNav("document");
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
      if (pendingGenerateRef.current.delete(localTaskId) && result.taskId) {
        setState((current) => attachUserInput(deleteTask(current, localTaskId), result.taskId, pending.input, parentTaskId, pending.context));
        setSelectedTaskID({ kind: "task", id: result.taskId });
        setActiveNav("document");
        refreshProjectLists();
      }
    } catch (error) {
      if (!pendingGenerateRef.current.delete(localTaskId)) return;
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
    if (activeNavRef.current !== "login") loginReturnNavRef.current = activeNavRef.current;
    setActiveNav("login");
  }, []);

  const returnFromLogin = useCallback(() => {
    setActiveNav(loginReturnNavRef.current === "login" ? "home" : loginReturnNavRef.current);
  }, []);
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

  // The live draft behind the deck currently on screen, if that deck is one.
  // Registered synchronously when the draft is created, so it is already true
  // by the time the preview artifact naming that file is committed.
  const previewLiveDraft = previewArtifact?.filePath ? liveDraftFor(previewArtifact.filePath) : undefined;

  useEffect(() => {
    const taskId = stageFirstTaskRef.current;
    if (!taskId) return;
    const task = state.tasks[taskId];
    if (!task) return;
    if (task.status === "completed") {
      stageFirstTaskRef.current = undefined;
      setStageFirstTaskId(undefined);
      // Completion must not replace the op-authored editor with a second
      // artifact import: the deck on screen is this task's own live draft and
      // the sequencer already saved it.
      const keepLivePreview = previewLiveDraft?.taskId === taskId;
      if (!keepLivePreview && task.artifact?.filePath) {
        void openInlinePreview(task.artifact);
      }
      return;
    }
    if (task.status === "failed" || task.status === "cancelled") {
      stageFirstTaskRef.current = undefined;
      setStageFirstTaskId(undefined);
    }
  }, [openInlinePreview, previewLiveDraft, state.tasks]);

  const openTaskFromHome = useCallback((taskId: string) => {
    const task = state.tasks[taskId];
    if (task?.status === "completed" && task.artifact?.filePath) {
      setSelectedTaskID({ kind: "task", id: taskId });
      setActiveNav("document");
      void openInlinePreview(task.artifact);
      return;
    }
    selectTask(taskId);
  }, [openInlinePreview, selectTask, state.tasks]);

  const steerPptxTask = useCallback(async (_task: DesktopTask, instruction: string) => {
    await continueModify("pptx", instruction);
  }, [continueModify]);

  const resumePptxTask = useCallback(async (task: DesktopTask, outline?: Array<{ id: string; title: string; detail?: string; estimatedSlides?: number; slide?: number }>, questionAnswer?: TaskQuestionAnswer) => {
    // Send the plan decision through the typed option channel.  Using a
    // freeform "approve" answer is ambiguous to older OfficeCLI runtimes and
    // can be interpreted as a revision/continuation, which reopens the plan
    // gate indefinitely.  Non-plan questions still use the existing
    // continuation answer.
    const eventQuestion = [...(task.events ?? [])].reverse().find((event) => event.type === "task.question");
    const eventQuestionId = eventQuestion?.payload && typeof eventQuestion.payload.id === "string" ? eventQuestion.payload.id : undefined;
    const waitingStatus = task.status === "plan_review" ? "plan_review" : "question";
    setState((current) => markTaskContinuing(current, task.id));
    try {
      if (task.status === "plan_review") {
        const answer = outline && outline.length > 0
          ? JSON.stringify({ sections: outline.map(({ id, title, detail, estimatedSlides, slide }, index) => ({ id, slide: slide ?? index + 1, title, purpose: detail, estimatedSlides })) })
          : "";
        await respondToPlanReview(officecli, task, "approve", answer);
        setState((current) => finishTaskContinuing(current, task.id));
        void pollTaskHistoryUntilTerminal(task.id, () => officecli.getTaskHistory(50), (entry) => {
          setState((current) => entry.events.reduce((next, event) => applyTaskEvent(next, event), current));
        }, { intervalMs: 1_000, maxAttempts: 30 });
        return;
      }
      await officecli.respond(questionAnswer ? {
        taskId: task.id,
        questionId: questionAnswer.questionId || eventQuestionId,
        answer: questionAnswer.answer,
        ...(questionAnswer.optionId ? { optionId: questionAnswer.optionId } : {}),
      } : responseForPptxQuestion(task, eventQuestionId));
      setState((current) => finishTaskContinuing(current, task.id));
      void pollTaskHistoryUntilTerminal(task.id, () => officecli.getTaskHistory(50), (entry) => {
        setState((current) => entry.events.reduce((next, event) => applyTaskEvent(next, event), current));
      }, { intervalMs: 1_000, maxAttempts: 30 });
    } catch (error) {
      // The browser bridge can briefly retain a stale task snapshot after the
      // runtime has already consumed its gate. Reconciliation will apply the
      // resulting events; do not surface a false actionable error to users.
      const message = error instanceof Error ? error.message : String(error);
      if (/no pending (runtime )?input/i.test(message)) {
        setState((current) => finishTaskContinuing(current, task.id));
        // The bridge may have consumed the gate just before the UI click. Pull
        // the durable event history immediately so the stage leaves the stale
        // plan_review snapshot instead of looking frozen.
        try {
          const entries = await officecli.getTaskHistory(50);
          const entry = entries.find((candidate) => candidate.taskId === task.id);
          if (entry) {
            setState((current) => entry.events.reduce((next, event) => applyTaskEvent(next, event), current));
          }
        } catch {
          // The normal reconciliation loop remains the fallback.
        }
        return;
      }
      setState((current) => restoreTaskInteractiveGate(current, task.id, waitingStatus));
      throw error;
    }
  }, []);

  const answerDocumentQuestion = useCallback(async (task: DesktopTask, answer: TaskQuestionAnswer) => {
    await officecli.respond({
      taskId: task.id,
      answer: answer.answer,
      ...(answer.optionId ? { optionId: answer.optionId } : {}),
      ...(answer.questionId ? { questionId: answer.questionId } : {}),
    });
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

  const openSidebarDocument = useCallback((document: SidebarDocument) => {
    if (state.tasks[document.id]) {
      openTaskFromHome(document.id);
      return;
    }
    const filePath = document.id.startsWith("file:") ? document.id.slice("file:".length) : undefined;
    const file = recentFiles.find((candidate) => candidate.filePath === filePath || candidate.taskId === document.id);
    if (file) void openRecentFile(file);
  }, [openRecentFile, openTaskFromHome, recentFiles, state.tasks]);

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

  const deleteSidebarDocument = useCallback(async (document: SidebarDocument) => {
    const task = state.tasks[document.id];
    const conversationId = document.conversationId || task?.conversationId;
    const lineage = task
      ? tasks.filter((candidate) => candidate.conversationId === conversationId)
      : [];
    try {
      for (const candidate of lineage) {
        if (["starting", "running", "question", "plan_review"].includes(candidate.status)) {
          try {
            await officecli.cancel(candidate.id);
          } catch (error) {
            if (!/not[ _-]?found/i.test(errorMessage(error))) throw error;
          }
        }
      }
      if (task) {
        await officecli.deleteDocument(task.id);
        const lineageIds = new Set(lineage.map((candidate) => candidate.id));
        setState((current) => lineage.reduce((next, candidate) => deleteTask(next, candidate.id), current));
        setRecentFiles((current) => current.filter((file) =>
          !lineageIds.has(file.taskId || "") &&
          (!conversationId || file.conversationId !== conversationId) &&
          (!document.filePath || file.filePath !== document.filePath),
        ));
        if (selectedTaskID.kind === "task" && lineageIds.has(selectedTaskID.id)) {
          setSelectedTaskID({ kind: "none" });
          setActiveNav("home");
        }
        if (
          (previewArtifact?.taskId && lineageIds.has(previewArtifact.taskId)) ||
          (document.filePath && previewArtifact?.filePath === document.filePath)
        ) {
          await closeInlinePreview();
        }
      } else if (document.filePath) {
        await removeRecentFile(document.filePath);
        if (previewArtifact?.filePath === document.filePath) {
          await closeInlinePreview();
          setActiveNav("home");
        }
      }
      clearError();
    } catch (error) {
      void message.error(errorMessage(error));
    }
  }, [clearError, closeInlinePreview, previewArtifact, removeRecentFile, selectedTaskID, state.tasks, tasks]);

  // ---- MOP live drawing --------------------------------------------------
  // First task.vibe_primitives for a task opens the presentation editor on a
  // blank draft and the replay sequencer inside PptxViewer draws the deck as
  // the primitives stream in. One draft per task; never steal an open preview.
  const timelineTaskId = previewLiveDraft?.taskId ?? previewArtifact?.taskId ?? undefined;

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
      // Do not open the editor merely because the outline arrived: the user
      // must still review and confirm it. The first actual drawing op is the
      // boundary between planning and authoring, and is the only automatic
      // trigger for the live canvas.
      if (task && (task.vibeOps?.length ?? 0) > 0 && ["starting", "running"].includes(task.status)) {
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
      } catch (error) {
        liveDraftAttemptsRef.current.delete(liveCandidateTaskId);
        const message = errorMessage(error);
        recordError(`Live PPTX drawing could not start: ${message}`, classifyError(message), extractStderr(message));
      }
    })();
  }, [liveCandidateTaskId, recordError]);
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
      return finish("no task with drawing ops in this session — open the generated document first, then rerun __officedexReplayDemo()");
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
    setLiveTrace(true);
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

  // The live feed belongs to the document on screen, not to the app. Anything
  // else opened — a finished artifact, a recent file, another task's output —
  // resolves to no draft and therefore no feed. Keying this off a single
  // app-wide task id meant every pptx opened after one generation inherited
  // that task's whole op stream and replayed it onto a document that already
  // contained those objects.
  const liveReplayFeed = useMemo(
    () =>
      previewLiveDraft
        ? buildReplayFeed({
          draft: previewLiveDraft,
          ops: replayOps,
          // A live draft is a performance even when the editor finishes booting
          // after the backend already emitted the complete op stream. Treating
          // that case as historical catch-up makes the whole deck appear at
          // once, which defeats the op-mode product experience.
          performing: true,
          trace: liveTrace,
          task: state.tasks[previewLiveDraft.taskId],
        })
        : undefined,
    [liveTrace, previewLiveDraft, replayOps, state.tasks],
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

  // Turns the open workbook into a deck. It routes through the same generate
  // path as Home so the deck lands on the PPTX stage with the workbook as its
  // source, and records the workbook's task as the parent so the two artifacts
  // stay linked.
  const createDeckFromWorkbook = useCallback(async (sourceFilePath: string) => {
    const workspaceId = spreadsheet.session.workspaceId;
    const parentTaskId = spreadsheet.session.artifact?.taskId ?? spreadsheet.session.taskId;
    // submit() moves to the document stage itself once the task starts.
    await submit({
      documentType: "pptx",
      generationMode: generationModeForDocumentType("pptx"),
      topic: fileNameFromPath(sourceFilePath),
      prompt: t("spreadsheet.deckPrompt", { file: fileNameFromPath(sourceFilePath) }),
      sourceFile: sourceFilePath,
      ...(parentTaskId ? { parentTaskId } : {}),
      ...(workspaceId ? { workspaceId } : { noProject: true }),
      enableImages: persistedSettings.defaults.enableImages,
      imageQuality: persistedSettings.defaults.imageQuality,
    });
  }, [persistedSettings.defaults.enableImages, persistedSettings.defaults.imageQuality, spreadsheet.session.artifact?.taskId, spreadsheet.session.taskId, spreadsheet.session.workspaceId, t]);

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
    if (key === "home") {
      stageFirstTaskRef.current = undefined;
      setStageFirstTaskId(undefined);
    }
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
    throw new AgentClientToolDeferredError(t("tasks.runtime.restoreTimeout"));
  }, [t]);

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
        throw new AgentClientToolDeferredError(t("tasks.runtime.previewTypeMismatch", { type: expectedType.toUpperCase() }));
      }
      if (sourcePath && previewArtifact?.filePath !== sourcePath) {
        if (previewArtifact || previewGrant) {
          throw new AgentClientToolDeferredError(t("tasks.runtime.otherDocumentOpen"));
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
        throw new AgentClientToolDeferredError(t("tasks.runtime.sourcePathMissing", { runId: run.id }));
      }
      if (!await waitForActiveEditorSurface(surface as ActiveEditorSurface)) {
        throw new AgentClientToolDeferredError(t("tasks.runtime.editorNotReady", { type: expectedType.toUpperCase() }));
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
        throw new AgentClientToolDeferredError(t("tasks.runtime.otherWorkbookDirty"));
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
      throw new AgentClientToolDeferredError(t("tasks.runtime.workbookPathMissing", { runId: run.id }));
    }
    setSpreadsheetPreferredTool(preferredTool);
    setCatalogAutoScanFile(undefined);
    setActiveNav("spreadsheet");
    const workspace = await waitForSpreadsheetWorkspace();
    if (surface === "app-builder") workspace.openAppBuilder();
  }, [previewArtifact, previewGrant, spreadsheet.session.artifact?.filePath, spreadsheet.session.dirty, spreadsheet.session.grant?.token, t, waitForSpreadsheetWorkspace]);

  const agentClientToolSurfaces = useMemo<AgentClientToolSurfaces>(() => {
    const workspace = () => {
      if (!spreadsheetWorkspaceRef.current) {
        throw new AgentClientToolDeferredError(t("tasks.runtime.workspaceNotReady"));
      }
      return spreadsheetWorkspaceRef.current;
    };
    const saveWorkbook = async () => {
      if (!await workspace().save()) throw new Error(t("tasks.runtime.workbookSaveFailed"));
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
      "workbook.add_chart": async (request: Parameters<NonNullable<AgentClientToolSurfaces[string][string]>>[0]) => (
        workspace().addChart(parseWorkbookAddChartRequest(request.arguments))
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
  }, [refreshRecentFiles, spreadsheet.openArtifact, spreadsheet.session.artifact, spreadsheet.session.workspaceId, t]);

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

  // Authentication is a full-page flow. Rendering it inside Shell leaves the
  // workspace sidebar and content chrome visible behind the login card and
  // makes the browser hand-off look like a broken in-app state.
  if (activeNav === "login") {
    return (
      <>
        <DialogHost />
        <ToastHost />
        <LoginScreen onReturn={returnFromLogin} onAuthenticated={returnFromLogin} />
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
        inspector={sidePanel}
        credit={credit}
        hasCustomProvider={persistedSettings.llmProvider !== null}
        signal={sidebarTaskSignal}
        account={account}
        update={sidebarUpdate}
        workspaces={workspaces}
        documents={sidebarDocuments}
        activeDocumentId={documentTask?.id}
        activeWorkspaceId={activeNav === "home" ? homeWorkspaceId : activeNav === "spreadsheet" ? spreadsheet.session.workspaceId : activeWorkspace?.id}
        activeWorkspaceName={activeNav === "home" ? workspaces.find((workspace) => workspace.id === homeWorkspaceId)?.name : activeNav === "spreadsheet" ? workspaces.find((workspace) => workspace.id === spreadsheet.session.workspaceId)?.name : activeWorkspace?.name}
        onNavChange={changeNavigation}
        onSelectWorkspace={activeNav === "home" ? selectHomeWorkspace : selectWorkspace}
        onOpenDocument={openSidebarDocument}
        onDeleteDocument={deleteSidebarDocument}
        onSelectAllFiles={selectAllHomeFiles}
        onAddWorkspace={addWorkspace}
        onRenameWorkspace={renameWorkspace}
        onRevealWorkspace={revealWorkspace}
        onRemoveWorkspace={removeWorkspace}
      >
        {activeNav === "home" ? (
          <HomeScreen
            files={recentFiles}
            attentionTasks={tasks}
            onRetryTask={retryTaskGeneration}
            onSteerTask={steerPptxTask}
            onResumeTask={resumePptxTask}
            onAnswerTask={(task, answer) => resumePptxTask(task, undefined, answer)}
            onCancelTask={async (task) => {
              await officecli.cancel(task.id);
              setState((current) => applyTaskEvent(current, {
                event_id: `local-cancel-${task.id}-${Date.now()}`,
                task_id: task.id,
                type: "task.cancelled",
                ts: new Date().toISOString(),
                payload: { message: t("tasks.cancelled") },
              }));
            }}
            onStartTask={startTaskFromHome}
            productionTaskId={stageFirstTaskId}
            productionEditor={previewGrant && previewArtifact?.taskId === stageFirstTaskId ? {
              previewToken: previewGrant.token,
              fileName: previewArtifact!.fileName,
              onUnavailable: (error) => recordError(error || "Presentation editor unavailable", "other"),
            } : undefined}
            loading={recentFilesLoading}
            error={recentFilesError}
            activeWorkspaceId={homeWorkspaceId}
            workspaces={workspaces}
            onOpenFile={openRecentFile}
            onRemoveFile={removeRecentFile}
            onPickTaskFile={pickHomeTaskFile}
            onPickTaskDirectory={pickHomeTaskDirectory}
            onPickReferenceImages={pickHomeReferenceImages}
            onPickReferenceTextFiles={pickHomeReferenceTextFiles}
            droppedTaskPaths={droppedTaskPaths}
            onSelectWorkspace={selectHomeWorkspace}
            onSelectAllWorkspaces={selectAllHomeFiles}
            onAddWorkspace={addWorkspace}
            onOpenTask={openTaskFromHome}
            onRetryRecentFiles={() => void refreshRecentFiles(homeWorkspaceId)}
          />
        ) : null}
        {activeNav === "document" && documentTask ? (
          <DocumentWorkspace
            task={documentTask}
            artifact={documentTask.artifact}
            pptxStage={documentTask.documentType === "pptx" ? (
              <ProgressivePptxStage
                task={documentTask}
                draftReady={Boolean(previewGrant && previewArtifact?.taskId === documentTask.id)}
                editor={previewGrant && previewArtifact?.taskId === documentTask.id ? {
                  previewToken: previewGrant.token,
                  fileName: previewArtifact!.fileName,
                  onUnavailable: (error) => recordError(error || "Presentation editor unavailable", "other"),
                } : undefined}
                onContinue={documentTask.status === "question" || documentTask.status === "plan_review"
                  ? (outline) => resumePptxTask(documentTask, outline)
                  : undefined}
                onStartDrawing={documentTask.status === "question" || documentTask.status === "plan_review"
                  ? (outline) => resumePptxTask(documentTask, outline)
                  : undefined}
                onQuestionAnswer={(answer) => resumePptxTask(documentTask, undefined, answer)}
                productionProps={{
                  onCancel: () => void officecli.cancel(documentTask.id),
                  onRetry: () => retryTaskGeneration(documentTask),
                  onSteer: (instruction) => continueModify("pptx", instruction),
                  onResume: () => resumePptxTask(documentTask),
                  onOpenEditor: documentTask.artifact ? () => openInlinePreview(documentTask.artifact!) : undefined,
                }}
              />
            ) : undefined}
            onAnswer={documentTask.documentType === "pptx" ? undefined : (answer) => answerDocumentQuestion(documentTask, answer)}
            onApprovePlan={documentTask.documentType === "pptx" ? undefined : () => resumePptxTask(documentTask)}
            onCancel={async () => { await officecli.cancel(documentTask.id); }}
            onRetry={() => retryTaskGeneration(documentTask)}
            onContinue={documentTask.documentType !== "pptx" && (documentTask.status === "question" || documentTask.status === "plan_review") ? () => resumePptxTask(documentTask) : undefined}
            onArtifactAction={(action, artifact) => {
              if (action === "open") return openInlinePreview(artifact);
              if (action === "locate") return officecli.showItemInFolder(artifact.filePath);
              return navigator.clipboard.writeText(artifact.filePath);
            }}
            onContinueEditing={documentTask.artifact
              ? (instruction) => {
                  const documentType = documentTypeFromTask(documentTask);
                  if (documentType === "img" || documentType === "gif") {
                    return continueGeneration(documentType, instruction, [documentTask.artifact!.filePath], documentTask.userInput?.imageRatio, documentTask.userInput?.fps);
                  }
                  return continueModify(documentType, instruction);
                }
              : undefined}
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
            onCreateDeck={createDeckFromWorkbook}
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
                      if (!spreadsheetWorkspaceRef.current) throw new Error(t("tasks.runtime.workbookLoading"));
                      return spreadsheetWorkspaceRef.current.inspectCatalogSheets();
                    }}
                    onPreview={(batch) => spreadsheetWorkspaceRef.current?.previewCatalogCleanup(batch)}
                    onApply={(batch) => {
                      if (!spreadsheetWorkspaceRef.current) return Promise.reject(new Error(t("tasks.runtime.workbookClosed")));
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
                      if (!spreadsheetWorkspaceRef.current) return Promise.reject(new Error(t("tasks.runtime.workbookClosed")));
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
                      if (!spreadsheetWorkspaceRef.current) return Promise.reject(new Error(t("tasks.runtime.workbookClosed")));
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
                      if (!spreadsheetWorkspaceRef.current) throw new Error(t("tasks.runtime.workbookLoading"));
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
                      if (!spreadsheetWorkspaceRef.current) return Promise.reject(new Error(t("tasks.runtime.workbookClosed")));
                      return spreadsheetWorkspaceRef.current.setMarketingStatus(batch, rowIndex, status);
                    }}
                    onInsertImage={(batch, rowIndex, filePath) => {
                      if (!spreadsheetWorkspaceRef.current) return Promise.reject(new Error(t("tasks.runtime.workbookClosed")));
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
  // Keep enough context for the production header to remain recognizable.
  // The surrounding UI already applies its own layout-aware ellipsis where
  // space is constrained, so truncating at 24 characters here is needlessly
  // aggressive (for example, it turns "Create a technology product launch"
  // into "Create a technology prod...").
  return normalized.length > 64 ? `${normalized.slice(0, 64)}…` : normalized || "Untitled generation";
}

function initialNavFromLocation(): NavKey {
  return "home";
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
