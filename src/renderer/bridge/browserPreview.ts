// A stand-in DesktopAPI for `npm run dev` in a plain browser: local state,
// no generation, enough for the UI to render.
import type { AppUpdateCheckResult, AppUpdateEvent, AppUpdateStatus, Artifact, AgentClientToolReassignInput, AgentClientToolResultInput, AgentRun, AgentRunApproveInput, AgentRunRespondInput, AgentRunStartInput, ArtifactStageRuntimeInput, AuthEvent, BinaryFileData, BridgeEvent, BridgeRuntimeSnapshot, CreditStatus, CreateImageTemplatePublishRequestInput, CreateUserImageTemplateInput, DesktopAPI, GenerateInput, ImageTemplatePublishRequest, ImagePromptTemplate, InviteInfo, LlmProvider, LocalTextDocument, LoginInput, PlanPptxJSResult, ModifyInput, PeekReportContextResult, CreateWorkbookFromSheetInput, DrawingAsset, CaptureTimelineNodeInput, TimelineCapturedNode, PreparePptxEditorResult, SavePptxEditorSnapshotInput, SavePptxEditorAssetInput, ExportPptxEditorInput, ClosePptxEditorInput, PptxEditorSaveResult, PptxEditorSaveAssetResult, PrepareXlsxEditorResult, PreviewGrant, ProviderTestInput, ProviderSnapshot, ProviderTestResult, RedeemResult, RecentFile, ReportCapabilityResult, RendererLogInput, CloseXlsxEditorInput, SpreadsheetPlanFieldsInput, SpreadsheetPlanFieldsResult, SaveDocxResult, SaveXlsxEditorInput, StageXlsxEditorImageInput, SaveXlsxEditorResult, SubmitReportInput, SubmitReportResult, TaskHistoryEntry, UserSettings, WorkspaceSummary, WhoAmIResult } from "../../shared/types";
import type { JiraConnectionSummary, JiraProbeResult, LiquipediaConnectionSummary, LiquipediaProbeResult, MarketingCampaignPlanInput, MarketingCampaignPlanResult, CampaignImageInput, CampaignImageResult } from "../../shared/verticals";
import { defaultProxySettings } from "../defaults";
import { agentClientId } from "../agentClientIdentity";

// The Wails-generated bindings live alongside the renderer; tsconfig must
// include them. Imports are static so the build picks them up; calls only
// fire when window.go is available.
import * as WailsApp from "../generated/wailsjs/go/main/App";
import { EventsOn, OnFileDrop, OnFileDropOff } from "../generated/wailsjs/runtime";
import type { settings as settingsNS } from "../generated/wailsjs/go/models";

// toWails coerces a renderer-side typed value into the `never`-shaped argument
// that the Wails-generated bindings expect. The generated d.ts files describe
// arg types as `never` (the Wails codegen quirk), so every call site would
// otherwise sprout an `as never`; concentrating that cast here makes the
// suppression auditable and keeps call sites readable.
import { decodeRawBytes, serializeStageXlsxEditorImageInput, normalizeLocalTextDocuments, decodeArtifactBytes, serializeSavePptxEditorSnapshotInput, serializeSavePptxEditorAssetInput, decodePreparePptxEditorResult, uint8ArrayToBase64, normaliseCreditStatus, adaptSettingsPatch, normaliseUserSettings, normaliseTaskHistory, normaliseWorkspaceSummaries, normaliseRecentFiles, normaliseAppUpdateStatus, normaliseAppUpdateCheckResult, normaliseBridgeRuntimeSnapshot, normaliseProviderSnapshot } from "./codec";
import { DEFAULT_BROWSER_SETTINGS } from "./codec";


async function sendBrowserNotification(input: { title: string; body: string }): Promise<void> {
  if (typeof Notification === "undefined") {
    throw new Error("Desktop notifications are not supported in this browser.");
  }
  let permission = Notification.permission;
  if (permission === "default") {
    permission = await Notification.requestPermission();
  }
  if (permission !== "granted") {
    throw new Error("desktop notification permission denied");
  }
  new Notification(input.title, { body: input.body });
}

export function createBrowserPreviewAPI(): DesktopAPI {
  let browserSettings: UserSettings = {
    ...DEFAULT_BROWSER_SETTINGS,
    defaults: { ...DEFAULT_BROWSER_SETTINGS.defaults },
  };
  let browserWorkspaces: WorkspaceSummary[] = [
    {
      id: "browser-default",
      name: "Browser Preview",
      path: "(browser preview)",
      active: true,
    },
  ];
  let browserRecentFiles: RecentFile[] = [];
  return {
    initialize: async () => ({ browserPreview: true }),
    getCapabilities: async () => ({ browserPreview: true }),
    startAgentRun: async () => { throw new Error("Agent Runtime requires the OfficeDex bridge."); },
    getAgentRun: async () => { throw new Error("Agent Runtime requires the OfficeDex bridge."); },
    listAgentRuns: async () => [],
    respondAgentRun: async () => { throw new Error("Agent Runtime requires the OfficeDex bridge."); },
    approveAgentRun: async () => { throw new Error("Agent Runtime requires the OfficeDex bridge."); },
    retryAgentRun: async () => { throw new Error("Agent Runtime requires the OfficeDex bridge."); },
    cancelAgentRun: async () => undefined,
    completeAgentClientTool: async () => { throw new Error("Agent Runtime requires the OfficeDex bridge."); },
    reassignAgentClientTool: async () => { throw new Error("Agent Runtime requires the OfficeDex bridge."); },
    listImageTemplates: async () => [],
    createImageTemplate: async () => {
      throw new Error("Creating image templates requires the desktop app.");
    },
    createImageTemplatePublishRequest: async () => {
      throw new Error("Publishing image templates requires the desktop app.");
    },
    generate: async () => {
      throw new Error("Bridge IPC is only available inside the desktop app.");
    },
    getJiraConnection: async () => ({ configured: false, baseUrl: "", authType: "" }),
    saveJiraConnection: async () => { throw new Error("Jira connections require the desktop app."); },
    clearJiraConnection: async () => { throw new Error("Jira connections require the desktop app."); },
    getLiquipediaConnection: async () => ({ configured: false, baseUrl: "https://liquipedia.net/dota2" }),
    saveLiquipediaConnection: async () => { throw new Error("Liquipedia connections require the desktop app."); },
    clearLiquipediaConnection: async () => { throw new Error("Liquipedia connections require the desktop app."); },
    planSpreadsheetFields: async () => { throw new Error("Spreadsheet field planning requires the desktop app."); },
    planShopifyCatalogCampaign: async () => { throw new Error("Shopify campaign planning requires the desktop app."); },
    composeCampaignImage: async () => { throw new Error("Campaign image composition requires the desktop app."); },
    modify: async () => {
      throw new Error("Bridge IPC is only available inside the desktop app.");
    },
    artifactStageEdit: async () => {
      throw new Error("Bridge IPC is only available inside the desktop app.");
    },
    respond: async () => undefined,
    cancel: async () => undefined,
    openPath: async () => undefined,
    showItemInFolder: async () => undefined,
    openExternal: async (url: string) => {
      window.open(url, "_blank", "noopener,noreferrer");
    },
    sendDesktopNotification: sendBrowserNotification,
    openFileDialog: async () => null,
    openDirectoryDialog: async () => null,
    openMultiFileDialog: async () => null,
    savePastedImage: async () => {
      throw new Error("Saving pasted images requires desktop file access.");
    },
    savePptx: async () => {
      throw new Error("Saving PPTX requires desktop file access.");
    },
    saveDocx: async () => {
      throw new Error("Saving DOCX requires desktop file access.");
    },
    planPptxJS: async () => {
      throw new Error("Editing presentations with AI requires the OfficeDex desktop bridge.");
    },
    previewArtifact: async (artifact) => {
      const params = new URLSearchParams({
        offlinePreview: "1",
        previewToken: "browser-preview",
        fileName: artifact.fileName,
        documentType: artifact.documentType,
      });
      window.open(`${window.location.pathname}?${params.toString()}`, "_blank", "noopener,noreferrer");
    },
    issuePreviewToken: async (artifact) => ({
      token: "browser-preview",
      fileName: artifact.fileName,
      documentType: artifact.documentType,
    }),
    revokePreviewToken: async () => undefined,
    createLivePptxDraft: async () => {
      throw new Error("Live PPTX drawing requires the desktop app.");
    },
    createWorkbookFromSheet: async () => {
      throw new Error("Creating a workbook requires the desktop app.");
    },
    readDrawingAsset: async () => {
      throw new Error("Drawing assets require the desktop app.");
    },
    captureTimelineNode: async () => {
      throw new Error("Timeline capture requires the desktop app.");
    },
    preparePptxEditor: async () => {
      throw new Error("PPTX editor is unavailable in browser preview.");
    },
    savePptxEditorSnapshot: async () => {
      throw new Error("PPTX editor is unavailable in browser preview.");
    },
    savePptxEditorAsset: async () => {
      throw new Error("PPTX editor is unavailable in browser preview.");
    },
    exportPptxEditor: async () => {
      throw new Error("PPTX editor is unavailable in browser preview.");
    },
    closePptxEditor: async () => undefined,
    prepareXlsxEditor: async () => {
      throw new Error("XLSX editor is unavailable in browser preview.");
    },
    saveXlsxEditor: async () => {
      throw new Error("XLSX editor is unavailable in browser preview.");
    },
    stageXlsxEditorImage: async () => {
      throw new Error("XLSX editor is unavailable in browser preview.");
    },
    closeXlsxEditor: async () => undefined,
    readArtifactFile: async () => {
      throw new Error("Artifact file reading requires desktop file access.");
    },
    readLocalImage: async () => {
      throw new Error("Local image reading requires desktop file access.");
    },
    readLocalTextDocuments: async () => {
      throw new Error("Local text reading requires desktop file access.");
    },
    copyImageToClipboard: async () => {
      throw new Error("Image clipboard access requires the desktop app.");
    },
    setPreviewMode: async () => undefined,
    login: async () => {
      throw new Error("Login is only available inside the desktop app.");
    },
    cancelLogin: async () => undefined,
    whoami: async () => ({ mode: "anonymous" }),
    logout: async () => undefined,
    getCreditStatus: async () => normaliseCreditStatus(null),
    getInviteInfo: async () => {
      throw new Error("Invite code is only available inside the desktop app.");
    },
    redeem: async () => {
      throw new Error("Redemption is only available inside the desktop app.");
    },
    getSettings: async () => browserSettings,
    updateSettings: async (patch) => {
      browserSettings = {
        ...browserSettings,
        ...patch,
        defaults: { ...browserSettings.defaults, ...(patch.defaults ?? {}) },
        imageWatermark: { ...browserSettings.imageWatermark, ...(patch.imageWatermark ?? {}) },
      };
      return browserSettings;
    },
    getDefaultWorkspaceDir: async () => "(default workspace inside desktop app)",
    listWorkspaces: async () => browserWorkspaces,
    listRecentFiles: async (workspaceId?: string) => browserRecentFiles.filter((file) => !workspaceId || file.workspaceId === workspaceId),
    removeRecentFile: async (filePath: string) => {
      browserRecentFiles = browserRecentFiles.filter((file) => file.filePath !== filePath);
    },
    deleteDocument: async (taskId: string) => {
      browserRecentFiles = browserRecentFiles.filter((file) => file.taskId !== taskId);
    },
    renameWorkspace: async (workspaceId: string, name: string) => {
      const trimmed = name.trim();
      const workspace = browserWorkspaces.find((item) => item.id === workspaceId);
      if (!workspace || !trimmed) throw new Error("Workspace name is required.");
      browserWorkspaces = browserWorkspaces.map((item) => item.id === workspaceId ? { ...item, name: trimmed } : item);
      return { ...workspace, name: trimmed };
    },
    openRecentFile: async (file: RecentFile) => {
      const normalized = normaliseRecentFiles([file])[0];
      if (!normalized) throw new Error("Recent file is invalid.");
      const refreshed = { ...normalized, lastOpenedAt: new Date().toISOString() };
      browserRecentFiles = [refreshed, ...browserRecentFiles.filter((item) => item.filePath !== refreshed.filePath)];
      return {
        taskId: refreshed.taskId,
        filePath: refreshed.filePath,
        fileName: refreshed.fileName,
        documentType: refreshed.documentType,
      };
    },
    addWorkspace: async (path: string) => {
      const workspace: WorkspaceSummary = {
        id: `browser-${browserWorkspaces.length + 1}`,
        name: path.split(/[\\/]/).pop() || path,
        path,
        active: true,
      };
      browserWorkspaces = browserWorkspaces.map((item) => ({ ...item, active: false })).concat(workspace);
      return workspace;
    },
    selectWorkspace: async (workspaceId: string) => {
      let selected = browserWorkspaces.find((workspace) => workspace.id === workspaceId);
      if (!selected) {
        selected = browserWorkspaces[0];
      }
      browserWorkspaces = browserWorkspaces.map((item) => ({ ...item, active: item.id === selected?.id }));
      return { ...selected, active: true };
    },
    removeWorkspace: async (workspaceId: string) => {
      browserWorkspaces = browserWorkspaces.filter((workspace) => workspace.id !== workspaceId);
    },
    onAuthEvent: () => () => undefined,
    onBridgeEvent: () => () => undefined,
    onFileDrop: () => () => undefined,
    getAppVersion: async () => "0.0.0-browser",
    getAppUpdateStatus: async () => ({
      currentVersion: "0.0.0-browser",
      latestVersion: null,
      updateAvailable: false,
      mandatory: false,
      downloading: false,
      downloadedPath: null,
      lastCheckedAt: null,
      lastError: null,
    }),
    checkAppUpdate: async () => {
      throw new Error("App updates require the desktop app.");
    },
    downloadAppUpdate: async () => {
      throw new Error("App updates require the desktop app.");
    },
    installAppUpdate: async () => {
      throw new Error("App updates require the desktop app.");
    },
    cancelAppUpdate: async () => undefined,
    onAppUpdateEvent: () => () => undefined,
    exportLogs: async (_input?: import("../../shared/types").ExportLogsInput) => {
      throw new Error("Log export is only available inside the desktop app.");
    },
    recordRendererLog: async (_input: RendererLogInput) => undefined,
    submitReport: async (_input: SubmitReportInput): Promise<SubmitReportResult> => {
      throw new Error("Issue reporting is only available inside the desktop app.");
    },
    getReportCapability: async (): Promise<ReportCapabilityResult> => {
      return { enabled: false, reason: "browser-preview" };
    },
    peekReportContext: async (): Promise<PeekReportContextResult> => {
      return { requestId: "", errorCode: "", errorMessage: "" };
    },
    getTaskHistory: async (): Promise<TaskHistoryEntry[]> => [],
    getBridgeRuntimeSnapshot: async () => ({
      runtimeMode: "custom",
      binaryPath: "",
      envApplied: false,
    }),
    testProvider: async (_input?: ProviderTestInput) => {
      throw new Error("Provider test is only available inside the desktop app.");
    },
  };
}

/**
 * Decodes the Array<number> result that Wails returns for raw []byte responses
 * (used by Initialize / GetCapabilities / Respond / Cancel). Tries JSON first
 * and falls back to the decoded string when the payload isn't JSON.
 */
