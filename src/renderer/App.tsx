import { DialogHost, ToastHost, toast as message } from "./ui";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Artifact, BridgeEvent, DesktopTask, GenerateInput, ModifyInput, PreviewGrant, RecentFile, WorkspaceConversationSummary, WorkspaceSummary } from "../shared/types";
import { applyTaskEvent, attachTaskContext, attachUserInput, createInitialTaskState, deleteConversation, deleteTask, getConversationList, getConversationTasks, type TaskContextPatch, type TaskState } from "./taskState";
import { officecli } from "./bridge";
import { defaultGenerateInput, type NavKey } from "./defaults";
import { Shell } from "./components/Shell";
import { PreviewPanel } from "./components/PreviewPanel";
import { UpdateBanner } from "./components/UpdateBanner";
import { ForceUpdateOverlay } from "./components/ForceUpdateOverlay";
import { DialogueScreen, type FailureKind, type NewChatTarget, type NewGenerationDraft } from "./screens/DialogueScreens";
import { TasksScreen } from "./screens/DataScreens";
import { LoginScreen, SettingsScreen } from "./screens/SettingsScreens";
import { HomeScreen } from "./screens/HomeScreen";
import { OnboardingScreen } from "./screens/OnboardingScreen";
import { useSettings } from "./useSettings";
import { useAppUpdate } from "./useAppUpdate";
import { useCreditStatus } from "./useCreditStatus";
import { useLocale, useT } from "./i18n";
import { maybeNotify } from "./notifications";

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

function materializePendingContext(pending: PendingGenerate, taskId: string): TaskContextPatch | undefined {
  if (pending.context?.conversationId !== pending.localTaskId) {
    return pending.context;
  }
  return { ...pending.context, conversationId: taskId };
}

function generationModeForDocumentType(documentType: string | undefined): GenerateInput["generationMode"] | undefined {
  return documentType === "pptx" || documentType === "docx" || documentType === "xlsx" || documentType === "report" ? "plan" : undefined;
}

function normalizeGenerationMode(_value: unknown): GenerateInput["generationMode"] {
  return "plan";
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
  const [errorDetails, setErrorDetails] = useState<string>();
  const [connectAttempt, setConnectAttempt] = useState(0);
  const [previewGrant, setPreviewGrant] = useState<PreviewGrant | null>(null);
  const [previewArtifact, setPreviewArtifact] = useState<Artifact | null>(null);
  const pendingGenerateRef = useRef<PendingGenerate | null>(null);
  const { settings: persistedSettings, defaultWorkspaceDir, loading: settingsLoading } = useSettings();
  const [newGenerationDraft, setNewGenerationDraft] = useState<NewGenerationDraft>(() => createNewGenerationDraft());
  const [newChatTarget, setNewChatTarget] = useState<NewChatTarget>({ kind: "none" });
  const [newChatNudgeKey, setNewChatNudgeKey] = useState(0);
  const [newGenerationDraftDirty, setNewGenerationDraftDirty] = useState(false);
  const [onboardingDismissed, setOnboardingDismissed] = useState(false);
  const appUpdate = useAppUpdate();
  const { credit, refresh: refreshCredit, nudgeForTaskTransition } = useCreditStatus();
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

  const showOnboarding = !settingsLoading && !onboardingDismissed && persistedSettings.onboardingCompletedAt === null;
  const activeWorkspace = useMemo(() => workspaces.find((workspace) => workspace.active), [workspaces]);

  const refreshProjectLists = useCallback(() => {
    Promise.all([officecli.listWorkspaces(), officecli.listChats()])
      .then(([workspaceItems, chatItems]) => {
        setWorkspaces(workspaceItems);
        setChats(chatItems);
      })
      .catch(() => undefined);
  }, []);

  const refreshRecentFiles = useCallback(async (workspaceId?: string) => {
    setRecentFilesLoading(true);
    setRecentFilesError(undefined);
    try {
      setRecentFiles(await officecli.listRecentFiles(workspaceId));
    } catch (error) {
      setRecentFilesError(errorMessage(error));
    } finally {
      setRecentFilesLoading(false);
    }
  }, []);

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
        return;
      }
      const pending = pendingGenerateRef.current;
      const shouldReplaceLocalTask = Boolean(
        event.task_id &&
        pending &&
        event.task_id !== pending.localTaskId,
      );
      setState((current) => {
        let next = applyTaskEvent(current, event);
        if (event.task_id && pending && shouldReplaceLocalTask) {
          next = deleteTask(next, pending.localTaskId);
          next = attachUserInput(next, event.task_id, pending.input, pending.parentTaskId, materializePendingContext(pending, event.task_id));
        }
        return next;
      });
      if (event.task_id) {
        if (pending && shouldReplaceLocalTask) {
          pendingGenerateRef.current = null;
          setSelectedTaskID({ kind: "task", id: event.task_id });
          setBusy(false);
          refreshProjectLists();
          setActiveNav("dialogue");
        }
      }
      if (event.type === "task.completed" || event.type === "task.failed" || event.type === "task.cancelled") {
        if (event.type === "task.completed") {
          maybeNotify({ title: t("notification.title"), body: t("notification.taskCompleted") });
        }
        if (event.type === "task.failed") {
          maybeNotify({ title: t("notification.title"), body: t("notification.taskFailed") });
        }
        nudgeForTaskTransition();
      }
    });
    if (settingsLoading || showOnboarding) {
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
  }, [connectAttempt, clearError, recordError, settingsLoading, showOnboarding, forceUpdate, nudgeForTaskTransition, refreshProjectLists, t]);

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
    if (activeNav !== "dialogue") return undefined;
    return conversationTasks.find((task) => task.documentType === "pptx" && task.vibeTree)?.id;
  }, [activeNav, conversationTasks]);
  const activeVibeTask = useMemo(
    () => (activeNav === "dialogue"
      ? conversationTasks.find((task) => task.documentType === "pptx" && task.vibeTree)
      : undefined),
    [activeNav, conversationTasks],
  );
  const vibeStage = activeVibeTask?.vibeTree?.stage;
  const tasks = useMemo(() => state.taskOrder.map((taskID) => state.tasks[taskID]).filter(Boolean), [state]);
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
    setActiveNav("dialogue");
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
        setActiveNav("dialogue");
        refreshProjectLists();
      }
    } catch (error) {
      if (pendingGenerateRef.current?.localTaskId !== localTaskId) return;
      pendingGenerateRef.current = null;
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

  const createFromHome = useCallback((documentType: Exclude<GenerateInput["documentType"], "gif">) => {
    resetNewGenerationDraft();
    updateNewGenerationDraft({ documentType });
    setSelectedTaskID({ kind: "none" });
    setNewChatTarget(homeWorkspaceId ? { kind: "workspace", workspaceId: homeWorkspaceId } : { kind: "none" });
    clearError();
    setActiveNav("dialogue");
    setNewChatNudgeKey((current) => current + 1);
  }, [clearError, homeWorkspaceId, resetNewGenerationDraft, updateNewGenerationDraft]);

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

  const openRecentFile = useCallback(async (file: RecentFile) => {
    try {
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
  }, [homeWorkspaceId, openInlinePreview, refreshRecentFiles, removeRecentFile, selectTask, t, tasks]);

  const openLocalFileFromHome = useCallback(async () => {
    const filePath = await officecli.openFileDialog({
      filters: [{ name: "Office files", extensions: ["docx", "xlsx", "pptx", "pdf", "html", "htm"] }],
    });
    if (!filePath) return;
    const file: RecentFile = {
      filePath,
      fileName: fileNameFromPath(filePath),
      documentType: documentTypeFromPath(filePath),
      source: "local",
      ...(homeWorkspaceId ? { workspaceId: homeWorkspaceId } : {}),
      lastOpenedAt: new Date().toISOString(),
    };
    await openRecentFile(file);
  }, [homeWorkspaceId, openRecentFile]);

  const closeInlinePreview = useCallback(async () => {
    if (previewGrant) {
      await officecli.revokePreviewToken(previewGrant.token).catch(() => {});
    }
    setPreviewGrant(null);
    setPreviewArtifact(null);
    setDeckPanelDismissedId(activeVibeTask?.id ?? null);
  }, [previewGrant, activeVibeTask?.id]);

  // The Living Tree Cockpit already embeds a PPTist preview at the slides_ready/completed
  // stages, so auto-opening the full-window PreviewPanel is no longer needed for vibe tasks.

  const sidePanel = previewGrant
    ? <PreviewPanel grant={previewGrant} onClose={closeInlinePreview} artifact={previewArtifact} />
    : undefined;

  const showBanner =
    appUpdate.release !== null &&
    appUpdate.status.updateAvailable &&
    !appUpdate.status.mandatory &&
    !appUpdate.dismissed;

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
      {showBanner && appUpdate.release ? (
        <UpdateBanner
          release={appUpdate.release}
          phase={appUpdate.phase}
          progress={appUpdate.progress}
          error={appUpdate.error}
          onUpdate={() => void appUpdate.download()}
          onInstall={() => void appUpdate.install()}
          onDismiss={appUpdate.dismiss}
        />
      ) : null}
      <Shell
        activeNav={activeNav}
        failed={Boolean(lastError)}
        errorKind={lastError ? errorKind : undefined}
        inspector={sidePanel}
        autoCollapseSidebarKey={activePptCanvasTaskId}
        credit={credit}
        hasCustomProvider={persistedSettings.llmProvider !== null}
        workspaces={sidebarWorkspaces}
        chats={sidebarChats}
        activeWorkspaceId={activeNav === "home" ? homeWorkspaceId : activeWorkspace?.id}
        activeWorkspaceName={activeNav === "home" ? workspaces.find((workspace) => workspace.id === homeWorkspaceId)?.name : activeWorkspace?.name}
        selectedConversationId={conversationId}
        onNavChange={setActiveNav}
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
            loading={recentFilesLoading}
            error={recentFilesError}
            activeWorkspaceId={homeWorkspaceId}
            onCreate={createFromHome}
            onOpenFile={openRecentFile}
            onRemoveFile={removeRecentFile}
            onOpenLocalFile={openLocalFileFromHome}
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
        {activeNav === "tasks" ? (
          <TasksScreen
            tasks={tasks}
            onSelectTask={selectTask}
            onNewGeneration={newGeneration}
          />
        ) : null}
        {activeNav === "settings" ? <SettingsScreen onCreditRefresh={nudgeForTaskTransition} onOpenLogin={openLogin} /> : null}
        {activeNav === "login" ? <LoginScreen /> : null}
      </Shell>
      {showOnboarding ? (
        <OnboardingScreen settings={persistedSettings} defaultWorkspaceDir={defaultWorkspaceDir} onComplete={() => setOnboardingDismissed(true)} />
      ) : null}
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

function fileNameFromPath(filePath: string): string {
  return filePath.split(/[/\\]/).filter(Boolean).at(-1) ?? filePath;
}

function documentTypeFromPath(filePath: string): string {
  const fileName = fileNameFromPath(filePath);
  const dot = fileName.lastIndexOf(".");
  return dot >= 0 ? fileName.slice(dot + 1).toLowerCase() : "";
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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
