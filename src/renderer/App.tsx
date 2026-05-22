import { ConfigProvider } from "antd";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Artifact, BridgeEvent, GenerateInput, PreviewGrant } from "../shared/types";
import { applyTaskEvent, createInitialTaskState, type TaskState } from "./taskState";
import { officecli } from "./bridge";
import { theme } from "./designTokens";
import type { NavKey } from "./mockData";
import { Shell } from "./components/Shell";
import { PreviewPanel } from "./components/PreviewPanel";
import { DialogueScreen, type FailureKind } from "./screens/DialogueScreens";
import { ArtifactsScreen, TasksScreen, TemplatesScreen } from "./screens/DataScreens";
import { LoginScreen, SettingsScreen } from "./screens/SettingsScreens";
import { OnboardingScreen } from "./screens/OnboardingScreen";
import { useSettings } from "./useSettings";

export function App() {
  const [state, setState] = useState<TaskState>(() => createInitialTaskState());
  const [selectedTaskID, setSelectedTaskID] = useState<string | null>();
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
      setState((current) => {
        const next = applyTaskEvent(current, event);
        if (event.task_id) {
          setSelectedTaskID((currentTaskID) => (currentTaskID === undefined ? event.task_id : currentTaskID));
        }
        return next;
      });
      if (event.task_id) {
        setActiveNav("dialogue");
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
  }, [connectAttempt, clearError, recordError, settingsLoading, showOnboarding]);

  const selectedTask = selectedTaskID === null ? undefined : selectedTaskID ? state.tasks[selectedTaskID] : state.taskOrder.length > 0 ? state.tasks[state.taskOrder[0]] : undefined;
  const displayTask = selectedTask;
  const artifacts = useMemo(() => {
    const live = state.artifacts;
    return displayTask?.artifact && !live.some((artifact) => artifact.filePath === displayTask.artifact?.filePath) ? [displayTask.artifact, ...live] : live;
  }, [displayTask, state.artifacts]);
  const tasks = useMemo(() => state.taskOrder.map((taskID) => state.tasks[taskID]).filter(Boolean), [state]);

  async function submit(values: GenerateInput) {
    setBusy(true);
    clearError();
    try {
      const topic = values.topic || summarizePrompt(values.prompt);
      const result = await officecli.generate({ ...values, topic });
      setSelectedTaskID(result.taskId);
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
    setSelectedTaskID(null);
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

  return (
    <ConfigProvider theme={theme}>
      <Shell
        activeNav={activeNav}
        bridgeStatus={capabilityStatus}
        failed={Boolean(lastError)}
        errorKind={lastError ? errorKind : undefined}
        inspector={sidePanel}
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
            fluid
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
              setSelectedTaskID(taskID);
              setLastError(undefined);
              setActiveNav("dialogue");
            }}
            onNewGeneration={newGeneration}
          />
        ) : null}
        {activeNav === "artifacts" ? <ArtifactsScreen artifacts={artifacts} fluid onNewGeneration={newGeneration} onPreview={openInlinePreview} /> : null}
        {activeNav === "templates" ? <TemplatesScreen onNewGeneration={newGeneration} /> : null}
        {activeNav === "settings" ? <SettingsScreen fluid={false} /> : null}
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
