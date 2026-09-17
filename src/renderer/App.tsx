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
import { documentTypeFromTask, generationModeForDocumentType, sourceArtifactFor, useGeneration } from "./controllers/useGeneration";
import { OPEN_LOCAL_FILE_TYPES, useDocumentLibrary } from "./controllers/useDocumentLibrary";
// Re-exported because the route codec moved with the controller that owns it.
export { readStoredAppRoute, writeStoredAppRoute } from "./controllers/useAppRouting";
// Re-exported for callers that still import them from here; they moved with
// the generation controller that owns them.
export { findModifySourceTask, findRecoverableTaskHistoryEntry, sourceArtifactFor } from "./controllers/useGeneration";
export { sortSidebarDocuments } from "./controllers/useDocumentLibrary";

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

  // Home can route a request into the spreadsheet workspace instead of a
  // generation. What that workspace needs to mount is this component's
  // business, so the generation controller calls back rather than knowing.
  const onCatalogCleanup = useCallback(async (sourceFile: string) => {
    const file: RecentFile = {
      filePath: sourceFile,
      fileName: fileNameFromPath(sourceFile),
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
      routingRef.current?.setNav("spreadsheet");
      void refreshRecentFiles(homeWorkspaceId);
    });
  }, [api, clearError, homeWorkspaceId, refreshRecentFiles, runSpreadsheetAction]);

  const onWorkbookGeneration = useCallback(async (input: GenerateInput) => {
    setSpreadsheetPreferredTool("assistant");
    setCatalogAutoScanFile(undefined);
    setSpreadsheetEntry({ kind: "new", ...(homeWorkspaceId ? { workspaceId: homeWorkspaceId } : {}) });
    routingRef.current?.setNav("spreadsheet");
    clearError();
    try {
      await spreadsheet.startGeneration(input);
      refreshProjectLists();
    } catch (error) {
      const text = errorMessage(error);
      recordError(text, classifyError(text), extractStderr(text));
      routingRef.current?.setNav("home");
      throw error;
    } finally {
      nudgeForTaskTransition();
    }
  }, [clearError, homeWorkspaceId, nudgeForTaskTransition, recordError, refreshProjectLists, spreadsheet]);

  const generation = useGeneration({
    routing,
    workspaces,
    homeWorkspaceId,
    activeWorkspace,
    refreshWorkspaces: refreshProjectLists,
    defaults: persistedSettings.defaults,
    blocked: forceUpdate,
    recordError,
    clearError,
    onSettled: nudgeForTaskTransition,
    onHomeEntryTransition: setHomeEntryTransition,
    onCatalogCleanup,
    onWorkbookGeneration,
    t,
  });
  const submit = generation.submit;
  const retryTaskGeneration = generation.retry;
  const startTaskFromHome = generation.startFromHome;
  const continueGeneration = generation.continueGeneration;
  const continueModify = generation.continueModify;

  // The submission that owns the production stage hands over to the editor when
  // it finishes (R-D-03).
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
      if (onScreenDraft?.taskId !== taskId && task.artifact?.filePath) {
        void openInlinePreview(task.artifact);
      }
      return;
    }
    if (task.status === "failed" || task.status === "cancelled") {
      routing.clearStage();
    }
  }, [openInlinePreview, previewArtifact, routing, state.tasks]);


  const openWorkbookFile = useCallback((file: RecentFile) => runSpreadsheetAction(async () => {
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
    routingRef.current?.setNav("spreadsheet");
    documentSession.reportOpened();
    clearError();
    void refreshRecentFiles(homeWorkspaceId);
  }), [api, clearError, documentSession, homeWorkspaceId, refreshRecentFiles, runSpreadsheetAction]);

  const library = useDocumentLibrary({
    recent,
    session: documentSession,
    routing,
    homeWorkspaceId,
    openWorkbookFile,
    clearError,
    t,
  });
  const sidebarDocuments = library.documents;
  const sidebarTaskSignal = library.signal;
  const openSidebarDocument = library.openDocument;
  const deleteSidebarDocument = library.deleteDocument;
  const deleteSidebarDocuments = library.deleteDocuments;
  const openRecentFile = library.openRecentFile;
  const openHomeLocalFile = library.openLocalFile;
  const removeRecentFile = library.removeRecentFile;
  // A completed run opens its artifact; anything else just selects the run.
  // Kept separate from library.openDocument, which additionally falls back to
  // the recent-file list for ids that name no task (R-D-04, R-D-05).
  const openTaskFromHome = useCallback((taskId: string) => {
    const task = state.tasks[taskId];
    if (task?.status === "completed" && task.artifact?.filePath) {
      routing.setSelectedTask({ kind: "task", id: taskId });
      routing.setNav("document");
      void documentSession.open(task.artifact);
      return;
    }
    routing.selectTask(taskId);
  }, [documentSession, routing, state.tasks]);

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
              onViewed={library.setActivityVisible}
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

