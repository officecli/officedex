import { ConfigProvider } from "antd";
import zhCN from "antd/locale/zh_CN";
import enUS from "antd/locale/en_US";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Artifact, BridgeEvent, GenerateInput, PreviewGrant } from "../shared/types";
import { applyTaskEvent, attachUserInput, createInitialTaskState, type TaskState } from "./taskState";
import { officecli } from "./bridge";
import { theme } from "./designTokens";
import type { NavKey } from "./defaults";
import { Shell } from "./components/Shell";
import { PreviewPanel } from "./components/PreviewPanel";
import { UpdateBanner } from "./components/UpdateBanner";
import { ForceUpdateOverlay } from "./components/ForceUpdateOverlay";
import { DialogueScreen, type FailureKind } from "./screens/DialogueScreens";
import { TasksScreen } from "./screens/DataScreens";
import { LoginScreen, SettingsScreen } from "./screens/SettingsScreens";
import { OnboardingScreen } from "./screens/OnboardingScreen";
import { useSettings } from "./useSettings";
import { useAppUpdate } from "./useAppUpdate";
import { useCreditStatus } from "./useCreditStatus";
import { useLocale } from "./i18n";

type SelectedTask =
  | { kind: "auto" }
  | { kind: "none" }
  | { kind: "task"; id: string };

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
  const { settings: persistedSettings, defaultWorkspaceDir, loading: settingsLoading } = useSettings();
  const [onboardingDismissed, setOnboardingDismissed] = useState(false);
  const appUpdate = useAppUpdate();
  const { credit, nudgeForTaskTransition } = useCreditStatus();
  const locale = useLocale();
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
      setState((current) => applyTaskEvent(current, event));
      if (event.task_id) {
        setActiveNav("dialogue");
      }
      if (event.type === "task.completed" || event.type === "task.failed" || event.type === "task.cancelled") {
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
  }, [connectAttempt, clearError, recordError, settingsLoading, showOnboarding, forceUpdate, nudgeForTaskTransition]);

  const firstTaskID = state.taskOrder[0];
  useEffect(() => {
    if (firstTaskID && selectedTaskID.kind === "auto") {
      setSelectedTaskID({ kind: "task", id: firstTaskID });
    }
  }, [firstTaskID, selectedTaskID.kind]);

  const selectedTask = useMemo(() => {
    switch (selectedTaskID.kind) {
      case "none":
        return undefined;
      case "task":
        return state.tasks[selectedTaskID.id];
      case "auto":
        return firstTaskID ? state.tasks[firstTaskID] : undefined;
    }
  }, [selectedTaskID, state.tasks, firstTaskID]);
  const displayTask = useMemo(() => selectedTask, [selectedTask]);
  const artifacts = useMemo(() => {
    const live = state.artifacts;
    return displayTask?.artifact && !live.some((artifact) => artifact.filePath === displayTask.artifact?.filePath) ? [displayTask.artifact, ...live] : live;
  }, [displayTask, state.artifacts]);
  const tasks = useMemo(() => state.taskOrder.map((taskID) => state.tasks[taskID]).filter(Boolean), [state]);

  async function submit(values: GenerateInput) {
    if (forceUpdate) {
      recordError("Update required before continuing", "setup");
      return;
    }
    setBusy(true);
    clearError();
    try {
      const topic = values.topic || summarizePrompt(values.prompt);
      const result = await officecli.generate({ ...values, topic });
      setState((current) => attachUserInput(current, result.taskId, {
        prompt: values.prompt,
        sourceFile: values.sourceFile,
        referenceImages: values.referenceImages,
      }));
      setSelectedTaskID({ kind: "task", id: result.taskId });
      setActiveNav("dialogue");
    } catch (error) {
      const text = errorMessage(error);
      recordError(text, classifyError(text), extractStderr(text));
      setActiveNav("dialogue");
    } finally {
      setBusy(false);
    }
  }

  const newGeneration = useCallback(() => {
    setSelectedTaskID({ kind: "none" });
    clearError();
    setActiveNav("dialogue");
  }, [clearError]);

  const retry = useCallback(() => {
    clearError();
    setCapabilityStatus("Reconnecting...");
    setConnectAttempt((current) => current + 1);
  }, [clearError]);

  const openLogin = useCallback(() => {
    setActiveNav("login");
  }, []);

  const openInlinePreview = useCallback(async (artifact: Artifact) => {
    if (previewGrant) {
      await officecli.revokePreviewToken(previewGrant.token).catch(() => {});
    }
    const grant = await officecli.issuePreviewToken(artifact);
    setPreviewGrant(grant);
    officecli.setPreviewMode(true).catch(() => {});
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
        onNavChange={setActiveNav}
        onNewGeneration={newGeneration}
      >
        {activeNav === "dialogue" ? (
          <DialogueScreen
            task={displayTask}
            artifacts={artifacts}
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
          />
        ) : null}
        {activeNav === "tasks" ? (
          <TasksScreen
            tasks={tasks}
            onSelectTask={(taskID) => {
              setSelectedTaskID({ kind: "task", id: taskID });
              setLastError(undefined);
              setActiveNav("dialogue");
            }}
            onNewGeneration={newGeneration}
          />
        ) : null}
        {activeNav === "settings" ? <SettingsScreen /> : null}
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
