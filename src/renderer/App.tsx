import { DialogHost, ToastHost, toast as message } from "./ui";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AgentRun, Artifact, BridgeEvent, DesktopTask, GenerateInput, ModifyInput, PreviewGrant, RecentFile, TaskHistoryEntry } from "../shared/types";
import type { ConfiguredJiraSyncResult, ConfiguredLiquipediaSyncResult, JiraSyncResult, LiquipediaSyncResult } from "../shared/verticals";
import { getCapability, isDocumentType } from "../shared/types";
import { AgentClientToolHost } from "./AgentClientToolHost";
import { useAgentClientTools } from "./useAgentClientTools";
import { useVerticalPanels } from "./spreadsheet/useVerticalPanels";
import { executeActiveEditorClientTool, waitForActiveEditorSurface, type ActiveEditorSurface } from "./activeEditorClientTools";
import { applyTaskEvent, attachTaskContext, deleteTask, discardLocalTask, finishTaskContinuing, getRunLineage, markTaskContinuing, promoteLocalTask, restoreTaskInteractiveGate, startLocalTask, type TaskContextPatch, type TaskState } from "./taskState";
import { TaskStoreProvider, useTaskStore } from "./store/taskStore";
import { useTaskRuns } from "./controllers/useTaskRuns";
import { useWorkspaces } from "./controllers/useWorkspaces";
import { useBridgeLifecycle } from "./controllers/useBridgeLifecycle";
import { useDocumentSession } from "./controllers/useDocumentSession";
import { usePptxRunControls } from "./controllers/usePptxRunControls";
import { usePptxLiveDraft } from "./controllers/usePptxLiveDraft";
import { useDesktopApi } from "./services/desktopApi";
import { useRecentFiles } from "./useRecentFiles";
import { defaultGenerateInput, type NavKey } from "./defaults";
import { useAppRouting, type SelectedTask } from "./controllers/useAppRouting";
// Re-exported because the route codec moved with the controller that owns it.
export { readStoredAppRoute, writeStoredAppRoute } from "./controllers/useAppRouting";

// "Open file" edits documents in place, so only the formats OfficeDex can
// edit are offered.
const OPEN_LOCAL_FILE_TYPES = ["docx", "xlsx", "pptx"];
import type { SidebarAccount, SidebarDocument } from "./components/ProjectSidebar";
import { Shell } from "./components/Shell";
import { PreviewPanel } from "./components/PreviewPanel";
import { liveDraftFor } from "./presentation/vibeReplay";
import type { SidebarUpdateRowProps } from "./components/SidebarUpdateRow";
import { ForceUpdateOverlay } from "./components/ForceUpdateOverlay";
import { ActivityPanel } from "./screens/DataScreens";
import { LoginScreen, SettingsScreen } from "./screens/SettingsScreens";
import { HomeScreen } from "./screens/HomeScreen";
import { buildReferenceTextPrompt } from "./referenceTextPrompt";
import { inferHomeTaskRoute, type HomeTaskIntake } from "./homeIntake";
import { DocumentWorkspace } from "./document";
import { PRESENTATION_PLACEHOLDER_TOPIC, taskTitle } from "./taskTitle";
import { captureHomeEntryTransition, type HomeEntryTransition } from "./homeEntryTransition";
import { ProgressivePptxStage } from "./presentation/ProgressivePptxStage";
import { SpreadsheetWorkspace, type SpreadsheetWorkspaceHandle } from "./spreadsheet/SpreadsheetWorkspace";
import { SpreadsheetAgentPanel, type SpreadsheetAgentTool } from "./spreadsheet/SpreadsheetAgentPanel";
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
import { usePolling } from "./utils/usePolling";
import { TASK_HISTORY_RECONCILE_INTERVAL_MS } from "./constants/timing";
import { resolveFollowUpTarget, runFollowUpTask, type FollowUpDeps, type PendingGenerate } from "./flows/followUpTask";
import { errorMessage, recordValue, trimmedStringValue as stringValue } from "./utils/values";
import { BRIDGE_ERROR_CODES, classifyError, classifyStatusEvent, errorCode, extractStderr, stripFailureTag, type FailureKind } from "./failureKind";
import { fileExtension, fileNameFromPath } from "./utils/path";
import { delay } from "./utils/timing";

export interface RecoverableTaskExpectation {
  documentType: string;
  sourceFile?: string;
  parentTaskId?: string;
  createdAfter?: number;
}

/**
 * Find a task that the runtime accepted even though the initial generate RPC
 * did not return a usable task id. Parent lineage is the strongest signal;
 * source file + document type is the fallback used by older runtimes that did
 * not persist parentTaskId on the history envelope.
 */
export function findRecoverableTaskHistoryEntry(
  entries: TaskHistoryEntry[],
  expectation: RecoverableTaskExpectation,
): TaskHistoryEntry | undefined {
  const expectedType = expectation.documentType.toLowerCase();
  const expectedSource = expectation.sourceFile;
  const createdAfter = expectation.createdAfter ?? 0;
  return [...entries]
    .sort((a, b) => {
      const aTime = a.createdAt ? Date.parse(a.createdAt) : Number.NEGATIVE_INFINITY;
      const bTime = b.createdAt ? Date.parse(b.createdAt) : Number.NEGATIVE_INFINITY;
      return (Number.isFinite(bTime) ? bTime : Number.NEGATIVE_INFINITY) - (Number.isFinite(aTime) ? aTime : Number.NEGATIVE_INFINITY);
    })
    .find((entry) => {
      if (!entry.taskId || (entry.createdAt && Date.parse(entry.createdAt) < createdAfter)) return false;
      if (!entry.events.some((event) => {
        const type = typeof event.payload?.document_type === "string" ? event.payload.document_type.toLowerCase() : "";
        return type === expectedType || type === "";
      })) return false;
      if (expectation.parentTaskId && (
        entry.parentTaskId === expectation.parentTaskId
        || entry.events.some((event) => event.payload?.parent_task_id === expectation.parentTaskId)
      )) return true;
      if (!expectedSource) return false;
      return entry.events.some((event) => event.payload?.source_file === expectedSource);
    });
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
  return isDocumentType(documentType) && getCapability(documentType).office ? "fast" : undefined;
}

function normalizeGenerationMode(value: unknown): GenerateInput["generationMode"] {
  return value === "plan" ? "plan" : "fast";
}

function normalizeGenerateInputForGeneration(values: GenerateInput): GenerateInput {
  const next: GenerateInput = { ...values };
  if (next.documentType !== "pptx") {
    delete next.pptxWorkflow;
    delete next.templateId;
    delete next.templateVersion;
    delete next.templateAssetDir;
  }
  const generationMode = generationModeForDocumentType(next.documentType);
  if (generationMode) {
    next.generationMode = normalizeGenerationMode(next.generationMode);
  } else {
    delete next.generationMode;
  }
  return next;
}

/**
 * The file a follow-up modification may edit: the finished document when there
 * is one, otherwise the deck a stopped run already drew and saved.
 *
 * Keeping this in one place is the point. The partial deck used to live only in
 * preview state, so every consumer that asked the task model "what did this run
 * produce?" got nothing — which is why a failed run could not be opened, and
 * why a modification instruction silently landed on an older deck in the same
 * conversation instead of the one on screen.
 */
export function sourceArtifactFor(task: DesktopTask | undefined): Artifact | undefined {
  return task?.artifact ?? task?.partialArtifact;
}

export function findModifySourceTask(tasks: DesktopTask[], documentType: string, preferredTaskId?: string): DesktopTask | undefined {
  const targetType = documentType.trim().toLowerCase();
  const matches = (task: DesktopTask): boolean => {
    const artifact = sourceArtifactFor(task);
    if (!artifact?.filePath) return false;
    return (artifact.documentType || task.documentType || "").toLowerCase() === targetType;
  };
  // The run the user is looking at wins. Falling through to "newest artifact in
  // the conversation" is what sent an instruction meant for the stopped deck to
  // whichever earlier deck happened to have completed.
  if (preferredTaskId) {
    const preferred = tasks.find((task) => task.id === preferredTaskId);
    if (preferred && matches(preferred)) return preferred;
  }
  for (let i = tasks.length - 1; i >= 0; i--) {
    if (matches(tasks[i])) return tasks[i];
  }
  return undefined;
}

export function App() {
  return (
    <TaskStoreProvider>
      <OfficeDexApp />
    </TaskStoreProvider>
  );
}

function OfficeDexApp() {
  const api = useDesktopApi();
  const { state, update: setState } = useTaskStore();
  const [homeEntryTransition, setHomeEntryTransition] = useState<HomeEntryTransition>();
  const [busy, setBusy] = useState(false);
  const [lastError, setLastError] = useState<string>();
  const [errorKind, setErrorKind] = useState<FailureKind>("connection");
  const [errorDetails, setErrorDetails] = useState<string>();
  const [spreadsheetEntry, setSpreadsheetEntry] = useState<SpreadsheetEntry | null>(null);
  const [spreadsheetPreferredTool, setSpreadsheetPreferredTool] = useState<SpreadsheetAgentTool>("assistant");
  const [catalogAutoScanFile, setCatalogAutoScanFile] = useState<string>();
  const routingRef = useRef<ReturnType<typeof useAppRouting> | null>(null);
  // Closing the document drops the timeline selection with it. The live-draft
  // controller is built from the session, so it cannot be a dependency of the
  // session; the ref is the one direction left.
  const clearTimelineRef = useRef<() => void>(() => {});
  const workspaceRef = useRef<ReturnType<typeof useWorkspaces> | null>(null);
  const spreadsheet = useSpreadsheetSession(spreadsheetEntry);
  const spreadsheetWorkspaceRef = useRef<SpreadsheetWorkspaceHandle>(null);
  const [unsavedDialogOpen, setUnsavedDialogOpen] = useState(false);
  const [unsavedDialogSaving, setUnsavedDialogSaving] = useState(false);
  const pendingSpreadsheetActionRef = useRef<{ action: () => Promise<void>; resolve: (continued: boolean) => void } | null>(null);
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
  const { settings: persistedSettings, loading: settingsLoading } = useSettings();
  const appUpdate = useAppUpdate();
  const { credit, status: creditStatus, refresh: refreshCredit, nudgeForTaskTransition } = useCreditStatus();
  const [account, setAccount] = useState<SidebarAccount | undefined>();
  const [droppedTaskPaths, setDroppedTaskPaths] = useState<{ paths: string[]; seq: number }>();
  const locale = useLocale();
  const t = useT();
  const forceUpdate = appUpdate.status.mandatory && Boolean(appUpdate.release);

  const recordError = useCallback((text: string, kind: FailureKind, details?: string) => {
    setLastError(stripFailureTag(text));
    setErrorKind(kind);
    setErrorDetails(details);
  }, []);

  const clearError = useCallback(() => {
    setLastError(undefined);
    setErrorDetails(undefined);
  }, []);


  const runSpreadsheetAction = useCallback((action: () => Promise<void>): Promise<boolean> => {
    if (routingRef.current?.activeNav !== "spreadsheet" || !spreadsheet.session.dirty) {
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

  const recent = useRecentFiles(t("home.loadTimeout"));
  const { files: recentFiles, loading: recentFilesLoading, error: recentFilesError } = recent;
  const refreshRecentFiles = recent.refresh;

  useEffect(() => {
    void refreshRecentFiles();
  }, [refreshRecentFiles]);

  useEffect(() => {
    if (settingsLoading) return;
    refreshCredit();
  }, [persistedSettings.llmProvider, settingsLoading, refreshCredit]);



  useTaskRuns();

  const tasks = useMemo(() => state.taskOrder.map((taskID) => state.tasks[taskID]).filter(Boolean), [state]);

  const openWorkbook = useCallback((artifact: Artifact) => {
    return runSpreadsheetAction(async () => {
      const grant = await api.issuePreviewToken(artifact);
      const sourceTask = artifact.taskId ? tasks.find((task) => task.id === artifact.taskId) : undefined;
      setSpreadsheetPreferredTool("assistant");
      setCatalogAutoScanFile(undefined);
      setSpreadsheetEntry({
        kind: "artifact",
        artifact,
        grant,
        ...(sourceTask?.workspaceId ? { workspaceId: sourceTask.workspaceId } : {}),
        ...(sourceTask?.conversationId ? { conversationId: sourceTask.conversationId } : {}),
      });
      routingRef.current?.setNav("spreadsheet");
      clearError();
    });
  }, [api, clearError, runSpreadsheetAction, tasks]);

  const documentSession = useDocumentSession({
    onWorkbook: openWorkbook,
    onClosed: useCallback(() => clearTimelineRef.current(), []),
  });
  const previewGrant = documentSession.grant;
  const previewArtifact = documentSession.artifact;
  const documentOpenRevision = documentSession.openRevision;
  const openInlinePreview = documentSession.open;
  const closeInlinePreview = documentSession.close;

  const routing = useAppRouting({
    guardNavigation: runSpreadsheetAction,
    hasOpenDocument: Boolean(documentSession.grant),
    closeDocument: documentSession.close,
    selectWorkspace: useCallback((workspaceId: string) => workspaceRef.current?.select(workspaceId), []),
    getActiveWorkspaceId: useCallback(() => workspaceRef.current?.activeWorkspace?.id, []),
    onSelectTask: clearError,
  });
  routingRef.current = routing;
  const activeNav = routing.activeNav;
  const selectedTaskID = routing.selectedTaskID;
  const setActiveNav = routing.setNav;
  const setSelectedTaskID = routing.setSelectedTask;
  const changeNavigation = routing.navigate;
  const selectTask = routing.selectTask;
  const openLogin = routing.openLogin;
  const returnFromLogin = routing.returnFromLogin;
  const conversationId = routing.conversationId;
  const conversationTasks = routing.conversationTasks;
  const documentTask = routing.documentTask;
  const completedDocumentRoute = routing.completedDocumentRoute;
  const stageFirstTaskId = routing.stageTaskId;

  const onIntakeDrop = useCallback((paths: string[]) => {
    setDroppedTaskPaths((previous) => ({ paths, seq: (previous?.seq ?? 0) + 1 }));
  }, []);

  const workspaceController = useWorkspaces({
    recordError,
    clearError,
    refreshRecentFiles,
    // Drops are only accepted on Home (R-H-04); which surface that is stays
    // this component's knowledge.
    dropEnabled: activeNav === "home",
    onIntakeDrop,
  });
  const { workspaces, activeWorkspace, homeWorkspaceId, productOutputs } = workspaceController;
  const refreshProjectLists = workspaceController.refresh;
  const selectWorkspace = workspaceController.select;
  const selectHomeWorkspace = workspaceController.selectForHome;
  const addWorkspace = workspaceController.add;
  const renameWorkspace = workspaceController.rename;
  const revealWorkspace = workspaceController.reveal;
  const removeWorkspace = workspaceController.remove;

  // Home is the inbox, not the currently selected production stage. Clearing
  // the transient stage pick is this component's business, not the workspace
  // controller's, so it wraps rather than lives inside it (R-B-08).
  const selectAllHomeFiles = useCallback(() => {
    routingRef.current?.clearStage();
    workspaceController.selectAll();
  }, [workspaceController]);

  workspaceRef.current = workspaceController;

  const onReconnected = useCallback(() => {
    refreshProjectLists();
    void refreshRecentFiles(homeWorkspaceId);
  }, [homeWorkspaceId, refreshProjectLists, refreshRecentFiles]);


  const onTransportLost = useCallback(() => {
    recent.abandon(t("home.bridgeUnavailable"));
  }, [recent, t]);

  const onTaskSettled = useCallback((event: BridgeEvent, task: DesktopTask | undefined) => {
    // Name the task in the body: "a generation finished" makes the user hunt
    // for which one, which is the trip to the tasks page we are removing.
    if (event.type === "task.completed") {
      maybeNotify(api, { title: t("notification.title"), body: taskNotificationBody(task, t("notification.taskCompleted")) });
    }
    if (event.type === "task.failed") {
      maybeNotify(api, { title: t("notification.title"), body: taskNotificationBody(task, t("notification.taskFailed")) });
    }
    nudgeForTaskTransition();
  }, [api, nudgeForTaskTransition, t]);

  const bridge = useBridgeLifecycle({
    enabled: !forceUpdate,
    settingsLoading,
    recordError,
    clearError,
    onReconnected,
    onTransportLost,
    onTaskSettled,
  });
  const bridgeInterruptionKey = bridge.interruptionKey;


  const sidebarDocuments = useMemo<SidebarDocument[]>(() => {
    const byPath = new Map<string, SidebarDocument>();
    for (const file of recentFiles) {
      byPath.set(file.filePath, {
        id: file.taskId || `file:${file.filePath}`,
        // Local files have no task creation time. Use their persisted open
        // time so newly opened files survive the sidebar's 40-item limit.
        createdAt: file.lastOpenedAt,
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
        title: taskTitle(task, t("tasks.untitled")),
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
    api.whoami()
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
  async function submit(values: GenerateInput, options: { preserveWorkbookContext?: boolean; fromHome?: boolean } = {}) {
    if (forceUpdate) {
      recordError("Update required before continuing", "setup");
      return;
    }
    clearError();
    const topic = values.topic || summarizePrompt(values.prompt);
    const localTaskId = createLocalTaskId();
    setHomeEntryTransition(options.fromHome && values.documentType === "pptx" ? captureHomeEntryTransition(values.prompt || "") : undefined);
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
        pptxWorkflow: submittedValues.pptxWorkflow,
        ...(submittedValues.generationMode ? { generationMode: submittedValues.generationMode } : {}),
        sourceFile: submittedValues.sourceFile,
        referenceImages: submittedValues.referenceImages,
        imageRatio: submittedValues.imageRatio,
        fps: submittedValues.fps,
        templateId: submittedValues.templateId,
        templateVersion: submittedValues.templateVersion,
        templateAssetDir: submittedValues.templateAssetDir,
      },
      parentTaskId: values.parentTaskId,
    };
    pendingGenerateRef.current.set(localTaskId, pending);
    routing.beginStage(localTaskId);
    const pendingInput = pending.input;
    setState((current) => startLocalTask(current, localTaskId, pendingInput, { documentType: values.documentType, topic }, undefined, context));
    setSelectedTaskID({ kind: "task", id: localTaskId });
    setActiveNav("document");
    setBusy(false);
    try {
        const generateInput: GenerateInput = noProject
        ? { ...submittedValues, topic, noProject: true, workspaceId: undefined }
        : { ...submittedValues, topic, workspaceId: targetWorkspace?.id };
      const result = await api.generate(generateInput);
      if (pendingGenerateRef.current.delete(localTaskId) && result.taskId) {
        const actualContext = { ...pending.context, conversationId: result.taskId };
        setState((current) => promoteLocalTask(current, localTaskId, result.taskId, pending.input, undefined, actualContext));
        setSelectedTaskID({ kind: "task", id: result.taskId });
        routing.promoteStage(localTaskId, result.taskId);
        setActiveNav("document");
        refreshProjectLists();
      }
    } catch (error) {
      if (!pendingGenerateRef.current.delete(localTaskId)) return;
      if (options.preserveWorkbookContext && values.documentType === "pptx") {
        let recovered: TaskHistoryEntry | undefined;
        for (let attempt = 0; attempt < 6 && !recovered; attempt += 1) {
          const entries = await api.getTaskHistory(50).catch(() => [] as TaskHistoryEntry[]);
          recovered = findRecoverableTaskHistoryEntry(entries, {
            documentType: values.documentType,
            sourceFile: values.sourceFile,
            parentTaskId: values.parentTaskId,
            createdAfter: Date.now() - 120_000,
          });
          if (!recovered && attempt < 5) await delay(500);
        }
        if (recovered) {
          setState((current) => {
            let next = deleteTask(current, localTaskId);
            for (const event of recovered.events) next = applyTaskEvent(next, event);
            return attachTaskContext(next, recovered.taskId, {
              createdAt: recovered.createdAt,
              conversationId: recovered.conversationId,
              parentTaskId: recovered.parentTaskId,
              workspaceId: recovered.workspaceId,
              workspacePath: recovered.workspacePath,
            });
          });
          setSelectedTaskID({ kind: "task", id: recovered.taskId });
          routing.beginStage(recovered.taskId);
          setActiveNav("document");
          clearError();
          return;
        }
      }
      routing.clearStage(localTaskId);
      setState((current) => discardLocalTask(current, localTaskId));
      const text = errorMessage(error);
      recordError(text, classifyError(text), extractStderr(text));
      if (options.preserveWorkbookContext) {
        setSelectedTaskID({ kind: "none" });
        setActiveNav("spreadsheet");
      } else {
        setSelectedTaskID({ kind: "none" });
        setActiveNav("home");
      }
    } finally {
      setBusy(false);
      nudgeForTaskTransition();
    }
  }

  async function retryTaskGeneration(task: DesktopTask, resumeCheckpoint?: string) {
    const input = task.userInput;
    if (!input?.prompt.trim()) return;
    const documentType = documentTypeFromTask(task);
    const values: GenerateInput = {
      documentType,
      topic: task.topic || summarizePrompt(input.prompt),
      prompt: input.prompt,
      pptxWorkflow: input.pptxWorkflow,
      ...(generationModeForDocumentType(documentType) ? { generationMode: normalizeGenerationMode(input.generationMode) } : {}),
      resumeCheckpoint,
      enableImages: resumeCheckpoint ? ([...task.events].reverse().find(event => typeof event.payload?.resume_images === "boolean")?.payload?.resume_images as boolean | undefined) ?? persistedSettings.defaults.enableImages : persistedSettings.defaults.enableImages,
      imageQuality: persistedSettings.defaults.imageQuality,
      sourceFile: input.sourceFile,
      templateId: input.templateId,
      templateVersion: input.templateVersion,
      templateAssetDir: input.templateAssetDir,
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
    await submit(values);
  }

  const pickHomeTaskFile = useCallback(async () => {
    const selected = await api.openFileDialog({
      filters: [{
        name: "Work files",
        extensions: ["xlsx", "csv", "pptx", "docx", "pdf", "txt", "md", "png", "jpg", "jpeg", "webp"],
      }],
    });
    return selected || undefined;
  }, []);

  const pickHomeTaskDirectory = useCallback(async () => {
    const selected = await api.openDirectoryDialog();
    return selected || undefined;
  }, []);

  const pickHomeReferenceImages = useCallback(async () => {
    const selected = await api.openMultiFileDialog({
      filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "gif"] }],
    });
    return selected ?? [];
  }, []);

  const pickHomeReferenceTextFiles = useCallback(async () => {
    const selected = await api.openMultiFileDialog({
      filters: [{ name: "Text files", extensions: ["txt", "md", "markdown", "csv", "tsv", "log", "json"] }],
    });
    return selected ?? [];
  }, []);

  const importHomePptxTemplate = useCallback(async () => {
    const selected = await api.openFileDialog({
      filters: [{ name: "PowerPoint templates", extensions: ["pptx"] }],
    });
    if (!selected || !api.importPptxTemplate) return undefined;
    const imported = await api.importPptxTemplate({ sourcePath: selected });
    return {
      ...imported,
      supportedPageTypes: [],
      assetCounts: { logo: 0, icons: 0, images: 0, decorative: 0 },
      warnings: [],
    };
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
      const documents = await api.readLocalTextDocuments(input.referenceTextFiles);
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
        const artifact = await api.openRecentFile(file);
        const grant = await api.issuePreviewToken(artifact);
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
          generationMode: input.advancedMode ? "plan" : "fast",
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
      ...(route.documentType === "pptx" ? { pptxWorkflow: input.pptxWorkflow } : {}),
      ...(route.documentType === "pptx" && input.templateId ? {
        templateId: input.templateId,
        templateVersion: input.templateVersion,
        templateAssetDir: input.templateAssetDir,
      } : {}),
      generationMode: input.advancedMode ? "plan" : generationModeForDocumentType(route.documentType),
      topic: route.documentType === "pptx" ? PRESENTATION_PLACEHOLDER_TOPIC : summarizePrompt(input.prompt),
      prompt: taskPrompt,
      sourceFile: route.sourceFile,
      ...((route.documentType === "img" || route.documentType === "gif") && input.referenceImages?.length ? { referenceImages: input.referenceImages } : {}),
      ...(route.documentType === "img" && input.imageRatio ? { imageRatio: input.imageRatio } : {}),
      ...(route.documentType === "gif" && input.fps ? { fps: input.fps } : {}),
      ...(homeWorkspaceId ? { workspaceId: homeWorkspaceId } : { noProject: true }),
      enableImages: persistedSettings.defaults.enableImages,
      imageQuality: persistedSettings.defaults.imageQuality,
    }, { fromHome: true });
  }

  const removeRecentFile = useCallback(async (filePath: string) => {
    try {
      await recent.remove(filePath);
    } catch (error) {
      void message.error(errorMessage(error));
    }
  }, [recent]);

  const followUpDeps = useMemo<FollowUpDeps>(() => ({
    pending: pendingGenerateRef.current,
    setState,
    showTask: (taskId) => {
      setSelectedTaskID({ kind: "task", id: taskId });
      setActiveNav("document");
    },
    setBusy,
    recordError,
    refreshProjectLists,
    onSettled: nudgeForTaskTransition,
  }), [recordError, refreshProjectLists, nudgeForTaskTransition]);

  const continueGeneration = useCallback(async (documentType: string, prompt: string, referenceImages?: string[], imageRatio?: GenerateInput["imageRatio"], fps?: number) => {
    if (forceUpdate) {
      recordError("Update required before continuing", "setup");
      return;
    }
    const parentTaskId = conversationTasks.at(-1)?.id;
    const target = resolveFollowUpTarget(parentTaskId ? state.tasks[parentTaskId] : undefined, workspaces, activeWorkspace, conversationId);
    clearError();
    const topic = summarizePrompt(prompt);
    const generationMode = generationModeForDocumentType(documentType);
    const input: PendingGenerate["input"] = {
      prompt,
      ...(generationMode ? { generationMode } : {}),
      referenceImages: referenceImages && referenceImages.length > 0 ? referenceImages : undefined,
      imageRatio,
      fps,
    };
    await runFollowUpTask(followUpDeps, { localTaskId: createLocalTaskId(), documentType, topic, input, target }, () => api.generate({
      documentType: documentType as GenerateInput["documentType"],
      workspaceId: target.targetWorkspace?.id,
      noProject: target.noProject,
      conversationId,
      parentTaskId: target.parentTaskId,
      topic,
      prompt,
      ...(generationMode ? { generationMode } : {}),
      enableImages: persistedSettings.defaults.enableImages,
      imageQuality: persistedSettings.defaults.imageQuality,
      referenceImages,
      imageRatio,
      fps,
    }));
  }, [forceUpdate, recordError, clearError, persistedSettings.defaults, followUpDeps, conversationTasks, conversationId, state.tasks, workspaces, activeWorkspace]);

  const continueModify = useCallback(async (documentType: string, prompt: string, sourceTaskId?: string) => {
    if (forceUpdate) {
      recordError("Update required before continuing", "setup");
      return;
    }
    const parent = findModifySourceTask(conversationTasks, documentType, sourceTaskId);
    const sourceFile = sourceArtifactFor(parent)?.filePath;
    if (!sourceFile) {
      recordError(t("ui.copy.Nosourcedocumenttomodify"), "other");
      return;
    }
    const target = resolveFollowUpTarget(parent, workspaces, activeWorkspace, conversationId);
    clearError();
    const topic = summarizePrompt(prompt);
    await runFollowUpTask(followUpDeps, { localTaskId: createLocalTaskId(), documentType, topic, input: { prompt, sourceFile }, target }, () => api.modify({
      documentType: documentType as ModifyInput["documentType"],
      workspaceId: target.targetWorkspace?.id,
      noProject: target.noProject,
      conversationId,
      parentTaskId: target.parentTaskId,
      sourceFile,
      prompt,
    }));
  }, [forceUpdate, recordError, clearError, followUpDeps, conversationTasks, conversationId, workspaces, activeWorkspace, t]);

  // Tasks the user has held at a page boundary. The runtime blocks rather than
  // reporting a paused state, so the acknowledgement of the pause call is the
  // only evidence the UI has — and it is enough to show the right control.


  // The live draft behind the deck currently on screen, if that deck is one.
  // Registered synchronously when the draft is created, so it is already true
  // by the time the preview artifact naming that file is committed.

  useEffect(() => {
    const taskId = routing.stageTaskId;
    if (!taskId) return;
    const task = state.tasks[taskId];
    if (!task) return;
    if (task.status === "completed") {
      routing.clearStage();
      // Completion must not replace the op-authored editor with a second
      // artifact import: the deck on screen is this task's own live draft and
      // the sequencer already saved it.
      const onScreenDraft = previewArtifact?.filePath ? liveDraftFor(previewArtifact.filePath) : undefined;
      const keepLivePreview = onScreenDraft?.taskId === taskId;
      if (!keepLivePreview && task.artifact?.filePath) {
        void openInlinePreview(task.artifact);
      }
      return;
    }
    if (task.status === "failed" || task.status === "cancelled") {
      routing.clearStage();
    }
  }, [openInlinePreview, previewArtifact, state.tasks]);

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

  const pptxRun = usePptxRunControls({
    modifyDeck: useCallback((instruction: string, sourceTaskId: string) => continueModify("pptx", instruction, sourceTaskId), [continueModify]),
  });
  const livePausedTaskIds = pptxRun.livePausedTaskIds;
  const steerPptxTask = pptxRun.steer;
  const pausePptxTask = pptxRun.pause;
  const resumePptxLiveTask = pptxRun.resumeLive;
  const resumePptxTask = pptxRun.resume;
  const answerDocumentQuestion = pptxRun.answer;
  const checkPptxTaskStatus = pptxRun.checkStatus;

  const openRecentFile = useCallback(async (file: RecentFile) => {
    try {
      if (isXlsxFile(file)) {
        await runSpreadsheetAction(async () => {
          const artifact = await api.openRecentFile(file);
          const grant = await api.issuePreviewToken(artifact);
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
          documentSession.reportOpened();
          clearError();
          void refreshRecentFiles(homeWorkspaceId);
        });
        return;
      }
      const artifact = await api.openRecentFile(file);
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
        await api.openPath(file.filePath);
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

  const openHomeLocalFile = useCallback(async () => {
    try {
      const selected = await api.openFileDialog({
        filters: [{
          name: "Office files",
          extensions: [...OPEN_LOCAL_FILE_TYPES],
        }],
      });
      if (!selected) return;
      // The dialog filters already narrow the list, but a typed path can still
      // slip through, so keep the office-only rule on this side too.
      const documentType = fileExtension(selected);
      if (!OPEN_LOCAL_FILE_TYPES.includes(documentType)) {
        void message.error(t("home.openReferencedFile.unsupported"));
        return;
      }
      await openRecentFile({
        filePath: selected,
        fileName: fileNameFromPath(selected),
        documentType,
        source: "local",
        ...(homeWorkspaceId ? { workspaceId: homeWorkspaceId } : {}),
        lastOpenedAt: new Date().toISOString(),
      });
    } catch (error) {
      void message.error(errorMessage(error));
    }
  }, [homeWorkspaceId, openRecentFile, t]);

  const openSidebarDocument = useCallback((document: SidebarDocument) => {
    if (state.tasks[document.id]) {
      openTaskFromHome(document.id);
      return;
    }
    const filePath = document.id.startsWith("file:") ? document.id.slice("file:".length) : undefined;
    const file = recentFiles.find((candidate) => candidate.filePath === filePath || candidate.taskId === document.id);
    if (file) void openRecentFile(file);
  }, [openRecentFile, openTaskFromHome, recentFiles, state.tasks]);

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
            await api.cancel(candidate.id);
          } catch (error) {
            if (errorCode(errorMessage(error)) !== BRIDGE_ERROR_CODES.taskNotFound) throw error;
          }
        }
      }
      if (task) {
        await api.deleteDocument(task.id);
        const lineageIds = new Set(lineage.map((candidate) => candidate.id));
        setState((current) => lineage.reduce((next, candidate) => deleteTask(next, candidate.id), current));
        recent.forgetWhere((file) =>
          lineageIds.has(file.taskId || "") ||
          (!!conversationId && file.conversationId === conversationId) ||
          (!!document.filePath && file.filePath === document.filePath),
        );
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

  const deleteSidebarDocuments = useCallback(async (documentsToDelete: SidebarDocument[]) => {
    // Reuse the single-document cleanup path while serializing state changes
    // for a folded group, so active previews and recent files stay consistent.
    const handledConversations = new Set<string>();
    for (const document of documentsToDelete) {
      // A conversation can have several task rows (for example, retries or
      // edits). The single-row delete already removes that whole lineage, so
      // avoid issuing duplicate bridge deletes for the remaining rows.
      const key = document.conversationId || document.id;
      if (handledConversations.has(key)) continue;
      handledConversations.add(key);
      await deleteSidebarDocument(document);
    }
  }, [deleteSidebarDocument]);

  const pptxLive = usePptxLiveDraft({ session: documentSession, recordError, t });
  const timelineNodeId = pptxLive.timelineNodeId;
  const setTimelineNodeId = pptxLive.setTimelineNodeId;
  clearTimelineRef.current = () => pptxLive.setTimelineNodeId(null);
  const timelineTaskId = pptxLive.timelineTaskId;
  const openTimelineNode = pptxLive.openTimelineNode;
  const returnToLatestDeck = pptxLive.returnToLatestDeck;
  const liveReplayFeed = pptxLive.replayFeed;
  const replayBundledDemo = pptxLive.replayBundledDemo;
  const replayPreviewDemo = pptxLive.replayPreviewDemo;
  const bundledDemoLoading = pptxLive.bundledDemoLoading;

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
    }, { preserveWorkbookContext: true });
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
      const result = await api.generate({
        documentType: "img",
        topic: t("marketing.taskTitle", { product: row.productName, channel: row.campaignChannel ? ` · ${row.campaignChannel}` : "" }),
        prompt: row.prompt,
        ...(workspaceId ? { workspaceId } : { noProject: true }),
        ...(row.referenceImages.length > 0 ? { referenceImages: row.referenceImages } : {}),
        imageRatio: ratio,
        imageQuality: persistedSettings.defaults.imageQuality,
        enableImages: true,
      });
      void pollTaskHistoryUntilTerminal(
        result.taskId,
        () => api.getTaskHistory(50),
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


  const verticalPanels = useVerticalPanels({
    spreadsheet,
    spreadsheetWorkspaceRef,
    spreadsheetPreferredTool,
    catalogAutoScanFile,
    tasks: state.tasks,
    recentFiles,
    creditStatus,
    bridgeInterruptionKey,
    refreshRecentFiles,
    setActiveNav,
    startSpreadsheetMarketingImage,
  });

  const agentClientTools = useAgentClientTools({
    spreadsheet,
    previewArtifact,
    previewGrant,
    spreadsheetWorkspaceRef,
    refreshRecentFiles,
    setSpreadsheetEntry,
    adoptDocument: documentSession.adopt,
    setSpreadsheetPreferredTool,
    setCatalogAutoScanFile,
    setActiveNav,
  });

  // The Living Tree Cockpit already embeds a presentation preview at the slides_ready/completed
  // stages, so auto-opening the full-window PreviewPanel is no longer needed for vibe tasks.

  const sidePanel = previewGrant
    ? (
        <PreviewPanel
          grant={previewGrant}
          onClose={() => changeNavigation("home")}
          artifact={previewArtifact}
          live={liveReplayFeed}
          onReplayDemo={replayPreviewDemo}
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
        <LoginScreen
          onReturn={returnFromLogin}
          onAuthenticated={returnFromLogin}
          credit={credit}
          hasCustomProvider={persistedSettings.llmProvider !== null}
        />
      </>
    );
  }

  return (
    <>
      <DialogHost />
      <ToastHost />
      <AgentClientToolHost {...agentClientTools} />
      <div className="app-frame">
        <Shell
        activeNav={activeNav}
        inspector={sidePanel}
        editingDocument={Boolean(previewGrant) || activeNav === "document"}
        documentOpenRevision={documentOpenRevision}
        signal={sidebarTaskSignal}
        account={account}
        update={sidebarUpdate}
        workspaces={workspaces}
        documents={sidebarDocuments}
        activeDocumentId={documentTask?.id}
        activeWorkspaceId={activeNav === "home" ? homeWorkspaceId : activeNav === "spreadsheet" ? spreadsheet.session.workspaceId : activeWorkspace?.id}
        onNavChange={changeNavigation}
        onSelectWorkspace={activeNav === "home" ? selectHomeWorkspace : selectWorkspace}
        onOpenDocument={openSidebarDocument}
        onDeleteDocument={deleteSidebarDocument}
        onDeleteDocuments={deleteSidebarDocuments}
        onSelectAllFiles={selectAllHomeFiles}
        onAddWorkspace={addWorkspace}
        onRenameWorkspace={renameWorkspace}
        onRevealWorkspace={revealWorkspace}
        onRemoveWorkspace={removeWorkspace}
      >
        {activeNav === "home" || completedDocumentRoute ? (
          <HomeScreen
            files={recentFiles}
            productOutputs={productOutputs}
            attentionTasks={tasks}
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
            onReplayPptxDemo={replayBundledDemo}
            replayPptxDemoLoading={bundledDemoLoading}
            onOpenLocalFile={openHomeLocalFile}
            onRemoveFile={removeRecentFile}
            droppedTaskPaths={droppedTaskPaths}
            onRetryRecentFiles={() => void refreshRecentFiles(homeWorkspaceId)}
            pickers={{ taskFile: pickHomeTaskFile, taskDirectory: pickHomeTaskDirectory, referenceImages: pickHomeReferenceImages, referenceTextFiles: pickHomeReferenceTextFiles, importPptxTemplate: importHomePptxTemplate, subscribePptxTemplateProgress: api.onPptxTemplateProgress, deletePptxTemplate: api.deletePptxTemplate }}
            workspaceActions={{ select: selectHomeWorkspace, selectAll: selectAllHomeFiles, add: addWorkspace }}
            taskActions={{
              open: openTaskFromHome,
              retry: retryTaskGeneration,
              retryFailed: retryTaskGeneration,
              checkStatus: api.getPptxTaskStatus ? task => checkPptxTaskStatus(task.id) : undefined,
              skipResearch: api.skipPptxResearch ? (task) => api.skipPptxResearch!(task.id) : undefined,
              steer: steerPptxTask,
              resume: resumePptxTask,
              answer: (task, answer) => resumePptxTask(task, undefined, answer),
              cancel: async (task) => {
                await api.cancel(task.id);
                setState((current) => applyTaskEvent(current, {
                  event_id: `local-cancel-${task.id}-${Date.now()}`,
                  task_id: task.id,
                  type: "task.cancelled",
                  ts: new Date().toISOString(),
                  payload: { message: t("tasks.cancelled") },
                }));
              },
            }}
          />
        ) : null}
        {activeNav === "document" && documentTask && !completedDocumentRoute ? (
          <DocumentWorkspace
            entryTransition={homeEntryTransition}
            task={documentTask}
            artifact={documentTask.artifact}
            pptxStage={documentTask.documentType === "pptx" ? (
              <ProgressivePptxStage
                task={documentTask}
                onCheckStatus={api.getPptxTaskStatus ? () => checkPptxTaskStatus(documentTask.id) : undefined}
                onRetryFailed={(path) => retryTaskGeneration(documentTask, path)}
                onSkipResearch={api.skipPptxResearch ? () => api.skipPptxResearch!(documentTask.id) : undefined}
                onRefresh={async () => {
                  const entries = await api.getTaskHistory(50);
                  const entry = entries.find(entry => entry.taskId === documentTask.id);
                  if (!entry) throw new Error(t("pptx.stage.refreshMissing"));
                  setState(current => entry.events.reduce(applyTaskEvent, current));
                }}
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
                  onCancel: () => void api.cancel(documentTask.id),
                  onRetry: () => retryTaskGeneration(documentTask),
                  // Steers the run when it is still drawing, and becomes a
                  // follow-up modification once it is not — see steerPptxTask.
                  onSteer: (instruction) => steerPptxTask(documentTask, instruction),
                  onPause: api.pausePptx ? () => pausePptxTask(documentTask) : undefined,
                  livePaused: livePausedTaskIds.includes(documentTask.id),
                  onResumeLive: api.resumePptxLive ? () => resumePptxLiveTask(documentTask) : undefined,
                  onResume: () => resumePptxTask(documentTask),
                  onOpenEditor: sourceArtifactFor(documentTask) ? () => openInlinePreview(sourceArtifactFor(documentTask)!) : undefined,
                }}
              />
            ) : undefined}
            onAnswer={documentTask.documentType === "pptx" ? undefined : (answer) => answerDocumentQuestion(documentTask, answer)}
            onApprovePlan={documentTask.documentType === "pptx" ? undefined : () => resumePptxTask(documentTask)}
            onCancel={async () => { await api.cancel(documentTask.id); }}
            onRetry={() => retryTaskGeneration(documentTask)}
            onContinue={documentTask.documentType !== "pptx" && (documentTask.status === "question" || documentTask.status === "plan_review") ? () => resumePptxTask(documentTask) : undefined}
            onArtifactAction={(action, artifact) => {
              if (action === "open") return openInlinePreview(artifact);
              if (action === "locate") return api.showItemInFolder(artifact.filePath);
              return navigator.clipboard.writeText(artifact.filePath);
            }}
            onContinueEditing={sourceArtifactFor(documentTask)
              ? (instruction) => {
                  const documentType = documentTypeFromTask(documentTask);
                  const sourceFile = sourceArtifactFor(documentTask)!.filePath;
                  if (documentType === "img" || documentType === "gif") {
                    return continueGeneration(documentType, instruction, [sourceFile], documentTask.userInput?.imageRatio, documentTask.userInput?.fps);
                  }
                  return continueModify(documentType, instruction, documentTask.id);
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
              void api.revokePreviewToken(previewToken).catch(() => undefined);
            }}
            onCreateDeck={createDeckFromWorkbook}
            onWorkbookSaved={({ filePath, fingerprint }) => {
              if (!api.saveOfficeProductView || !filePath || !fingerprint) return;
              const workbookId = `workbook:${filePath}`;
              void api.saveOfficeProductView({
                id: `${workbookId}:view:active`,
                workbookId,
                sheetName: "active",
                layer: "view",
                fingerprint,
              }).catch(() => undefined);
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
                onRespond={(input) => api.respond(input)}
                onApprovePlan={(task) => resumePptxTask(task)}
                onCancel={(taskId) => api.cancel(taskId)}
                preferredTool={spreadsheetPreferredTool}
                {...verticalPanels}
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
  return isDocumentType(value);
}

function stringOrUndef(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
