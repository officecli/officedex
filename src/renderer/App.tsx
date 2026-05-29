import { ConfigProvider, message } from "antd";
import zhCN from "antd/locale/zh_CN";
import enUS from "antd/locale/en_US";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Artifact, BridgeEvent, GenerateInput, ModifyInput, PreviewGrant } from "../shared/types";
import { applyTaskEvent, attachUserInput, createInitialTaskState, deleteConversation, deleteTask, getConversationList, getConversationTasks, type TaskState } from "./taskState";
import { officecli } from "./bridge";
import { theme } from "./designTokens";
import { defaultGenerateInput, type NavKey } from "./defaults";
import { Shell } from "./components/Shell";
import { PreviewPanel } from "./components/PreviewPanel";
import { UpdateBanner } from "./components/UpdateBanner";
import { ForceUpdateOverlay } from "./components/ForceUpdateOverlay";
import { DialogueScreen, type FailureKind, type NewGenerationDraft } from "./screens/DialogueScreens";
import { TasksScreen } from "./screens/DataScreens";
import { LoginScreen, SettingsScreen } from "./screens/SettingsScreens";
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
  input: {
    prompt: string;
    sourceFile?: string;
    referenceImages?: string[];
  };
  parentTaskId?: string;
};

export function App() {
  const [state, setState] = useState<TaskState>(() => createInitialTaskState());
  const [selectedTaskID, setSelectedTaskID] = useState<SelectedTask>({ kind: "auto" });
  const [activeNav, setActiveNav] = useState<NavKey>("dialogue");
  const [busy, setBusy] = useState(false);
  const [capabilityStatus, setCapabilityStatus] = useState("Not connected");
  const [lastError, setLastError] = useState<string>();
  const [errorKind, setErrorKind] = useState<FailureKind>("connection");
  const [errorDetails, setErrorDetails] = useState<string>();
  const [connectAttempt, setConnectAttempt] = useState(0);
  const [previewGrant, setPreviewGrant] = useState<PreviewGrant | null>(null);
  const pendingGenerateRef = useRef<PendingGenerate | null>(null);
  const { settings: persistedSettings, defaultWorkspaceDir, loading: settingsLoading } = useSettings();
  const [newGenerationDraft, setNewGenerationDraft] = useState<NewGenerationDraft>(() => createNewGenerationDraft());
  const [newGenerationDraftDirty, setNewGenerationDraftDirty] = useState(false);
  const [onboardingDismissed, setOnboardingDismissed] = useState(false);
  const appUpdate = useAppUpdate();
  const { credit, refresh: refreshCredit, nudgeForTaskTransition } = useCreditStatus();
  const locale = useLocale();
  const t = useT();
  const antdLocale = locale === "zh" ? zhCN : enUS;
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
          next = attachUserInput(next, event.task_id, pending.input, pending.parentTaskId);
        }
        return next;
      });
      if (event.task_id) {
        if (pending && shouldReplaceLocalTask) {
          pendingGenerateRef.current = null;
          setSelectedTaskID({ kind: "task", id: event.task_id });
          setBusy(false);
        } else {
          setSelectedTaskID((current) => current.kind === "none" ? { kind: "task", id: event.task_id! } : current);
        }
        setActiveNav("dialogue");
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
        clearError();
      })
      .catch((error) => {
        const text = errorMessage(error);
        setCapabilityStatus(text);
      });
    return off;
  }, [connectAttempt, clearError, recordError, settingsLoading, showOnboarding, forceUpdate, nudgeForTaskTransition, t]);

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

  const conversationTasks = useMemo(() => {
    if (!conversationId) return [];
    return getConversationTasks(state, conversationId);
  }, [state, conversationId]);
  const artifacts = useMemo(() => state.artifacts, [state.artifacts]);
  const tasks = useMemo(() => state.taskOrder.map((taskID) => state.tasks[taskID]).filter(Boolean), [state]);
  const conversations = useMemo(() => getConversationList(state), [state]);

  async function submit(values: GenerateInput) {
    if (forceUpdate) {
      recordError("Update required before continuing", "setup");
      return;
    }
    clearError();
    const topic = values.topic || summarizePrompt(values.prompt);
    const localTaskId = createLocalTaskId();
    const submittedDraft = createNewGenerationDraft(values);
    pendingGenerateRef.current = {
      localTaskId,
      input: {
        prompt: values.prompt,
        sourceFile: values.sourceFile,
        referenceImages: values.referenceImages,
      },
    };
    setState((current) => attachUserInput(applyTaskEvent(current, {
      task_id: localTaskId,
      type: "task.started",
      ts: new Date().toISOString(),
      payload: {
        document_type: values.documentType,
        topic,
        message: "Task submitted",
      },
    }), localTaskId, pendingGenerateRef.current!.input));
    setSelectedTaskID({ kind: "task", id: localTaskId });
    setActiveNav("dialogue");
    resetNewGenerationDraft();
    setBusy(false);
    try {
      const result = await officecli.generate({ ...values, topic });
      if (pendingGenerateRef.current?.localTaskId === localTaskId && result.taskId) {
        const pending = pendingGenerateRef.current;
        pendingGenerateRef.current = null;
        setState((current) => attachUserInput(deleteTask(current, localTaskId), result.taskId, pending.input));
        setSelectedTaskID({ kind: "task", id: result.taskId });
        setActiveNav("dialogue");
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

  const newGeneration = useCallback(() => {
    setSelectedTaskID({ kind: "none" });
    clearError();
    setActiveNav("dialogue");
  }, [clearError]);

  const selectTask = useCallback((taskId: string) => {
    setSelectedTaskID({ kind: "task", id: taskId });
    setLastError(undefined);
    setActiveNav("dialogue");
  }, []);

  const continueGeneration = useCallback(async (documentType: string, prompt: string, referenceImages?: string[]) => {
    if (forceUpdate) {
      recordError("Update required before continuing", "setup");
      return;
    }
    const parentTaskId = conversationTasks.at(-1)?.id;
    clearError();
    const topic = summarizePrompt(prompt);
    const localTaskId = createLocalTaskId();
    pendingGenerateRef.current = {
      localTaskId,
      input: {
        prompt,
        referenceImages: referenceImages && referenceImages.length > 0 ? referenceImages : undefined,
      },
      parentTaskId,
    };
    setState((current) => attachUserInput(applyTaskEvent(current, {
      task_id: localTaskId,
      type: "task.started",
      ts: new Date().toISOString(),
      payload: {
        document_type: documentType,
        topic,
        message: "Task submitted",
      },
    }), localTaskId, pendingGenerateRef.current!.input, parentTaskId));
    setSelectedTaskID({ kind: "task", id: localTaskId });
    setActiveNav("dialogue");
    setBusy(false);
    try {
      const result = await officecli.generate({
        documentType: documentType as GenerateInput["documentType"],
        topic,
        prompt,
        mode: persistedSettings.defaults.mode,
        enableImages: persistedSettings.defaults.enableImages,
        imageQuality: persistedSettings.defaults.imageQuality,
        referenceImages,
      });
      if (pendingGenerateRef.current?.localTaskId === localTaskId && result.taskId) {
        const pending = pendingGenerateRef.current;
        pendingGenerateRef.current = null;
        setState((current) => attachUserInput(deleteTask(current, localTaskId), result.taskId, pending.input, parentTaskId));
        setSelectedTaskID({ kind: "task", id: result.taskId });
        setActiveNav("dialogue");
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
  }, [forceUpdate, recordError, clearError, persistedSettings.defaults, nudgeForTaskTransition, conversationTasks]);

  const continueModify = useCallback(async (documentType: string, prompt: string) => {
    if (forceUpdate) {
      recordError("Update required before continuing", "setup");
      return;
    }
    const parent = conversationTasks.at(-1);
    const sourceFile = parent?.artifact?.filePath;
    if (!sourceFile) {
      recordError("No source document to modify", "other");
      return;
    }
    const parentTaskId = parent?.id;
    clearError();
    const topic = summarizePrompt(prompt);
    const localTaskId = createLocalTaskId();
    pendingGenerateRef.current = {
      localTaskId,
      input: { prompt, sourceFile },
      parentTaskId,
    };
    setState((current) => attachUserInput(applyTaskEvent(current, {
      task_id: localTaskId,
      type: "task.started",
      ts: new Date().toISOString(),
      payload: {
        document_type: documentType,
        topic,
        message: "Task submitted",
      },
    }), localTaskId, pendingGenerateRef.current!.input, parentTaskId));
    setSelectedTaskID({ kind: "task", id: localTaskId });
    setActiveNav("dialogue");
    setBusy(false);
    try {
      const result = await officecli.modify({
        documentType: documentType as ModifyInput["documentType"],
        sourceFile,
        prompt,
      });
      if (pendingGenerateRef.current?.localTaskId === localTaskId && result.taskId) {
        const pending = pendingGenerateRef.current;
        pendingGenerateRef.current = null;
        setState((current) => attachUserInput(deleteTask(current, localTaskId), result.taskId, pending.input, parentTaskId));
        setSelectedTaskID({ kind: "task", id: result.taskId });
        setActiveNav("dialogue");
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
  }, [forceUpdate, recordError, clearError, nudgeForTaskTransition, conversationTasks]);

  const retry = useCallback(() => {
    clearError();
    setCapabilityStatus("Reconnecting...");
    setConnectAttempt((current) => current + 1);
  }, [clearError]);

  const openLogin = useCallback(() => {
    setActiveNav("login");
  }, []);

  const handleDeleteConversation = useCallback((targetConversationId: string) => {
    setState((current) => deleteConversation(current, targetConversationId));
    setSelectedTaskID((current) => {
      if (current.kind !== "task") return current;
      return state.tasks[current.id]?.conversationId === targetConversationId ? { kind: "auto" } : current;
    });
  }, [state.tasks]);

  const openInlinePreview = useCallback(async (artifact: Artifact) => {
    if (previewGrant) {
      await officecli.revokePreviewToken(previewGrant.token).catch(() => {});
    }
    try {
      const grant = await officecli.issuePreviewToken(artifact);
      setPreviewGrant(grant);
      officecli.setPreviewMode(true).catch(() => {});
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      message.error(`Preview unavailable: ${text}`);
    }
  }, [previewGrant]);

  const closeInlinePreview = useCallback(async () => {
    if (previewGrant) {
      await officecli.revokePreviewToken(previewGrant.token).catch(() => {});
    }
    setPreviewGrant(null);
    officecli.setPreviewMode(false).catch(() => {});
  }, [previewGrant]);

  const sidePanel = previewGrant
    ? <PreviewPanel grant={previewGrant} onClose={closeInlinePreview} />
    : undefined;

  const showBanner =
    appUpdate.release !== null &&
    appUpdate.status.updateAvailable &&
    !appUpdate.status.mandatory &&
    !appUpdate.dismissed;

  if (forceUpdate && appUpdate.release) {
    return (
      <ConfigProvider theme={theme} locale={antdLocale}>
        <ForceUpdateOverlay
          release={appUpdate.release}
          phase={appUpdate.phase}
          progress={appUpdate.progress}
          error={appUpdate.error}
          currentVersion={appUpdate.status.currentVersion}
          onUpdate={() => void appUpdate.download()}
          onInstall={() => void appUpdate.install()}
        />
      </ConfigProvider>
    );
  }

  return (
    <ConfigProvider theme={theme} locale={antdLocale}>
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
        bridgeStatus={capabilityStatus}
        failed={Boolean(lastError)}
        errorKind={lastError ? errorKind : undefined}
        inspector={sidePanel}
        credit={credit}
        hasCustomProvider={persistedSettings.llmProvider !== null}
        conversations={conversations}
        selectedConversationId={conversationId}
        onNavChange={setActiveNav}
        onNewGeneration={newGeneration}
        onSelectTask={selectTask}
        onDeleteConversation={handleDeleteConversation}
      >
        {activeNav === "dialogue" ? (
          <DialogueScreen
            tasks={conversationTasks}
            conversationId={conversationId}
            artifacts={artifacts}
            newGenerationDraft={newGenerationDraft}
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
            onContinueGeneration={continueGeneration}
            onContinueModify={continueModify}
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
    </ConfigProvider>
  );
}

function summarizePrompt(prompt: string) {
  const normalized = prompt.trim().replace(/\s+/g, " ");
  return normalized.length > 24 ? `${normalized.slice(0, 24)}...` : normalized || "Untitled generation";
}

function createNewGenerationDraft(input: Partial<GenerateInput> = {}): NewGenerationDraft {
  return {
    documentType: input.documentType ?? defaultGenerateInput.documentType ?? "pptx",
    topic: input.topic ?? "",
    prompt: input.prompt ?? "",
    mode: input.mode ?? defaultGenerateInput.mode,
    sourceFile: input.sourceFile,
    referenceImages: input.referenceImages,
  };
}

function createLocalTaskId(): string {
  return `local-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
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
