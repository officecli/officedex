import type { AppUpdateCheckResult, AppUpdateEvent, AppUpdateStatus, Artifact, AgentClientToolReassignInput, AgentClientToolResultInput, AgentRun, AgentRunApproveInput, AgentRunRespondInput, AgentRunStartInput, ArtifactStageRuntimeInput, AuthEvent, BinaryFileData, BridgeEvent, BridgeRuntimeSnapshot, CreditStatus, CreateImageTemplatePublishRequestInput, CreateUserImageTemplateInput, DesktopAPI, GenerateInput, ImageTemplatePublishRequest, ImagePromptTemplate, InviteInfo, LlmProvider, LocalTextDocument, LoginInput, PlanPptxJSResult, ModifyInput, PeekReportContextResult, CreateWorkbookFromSheetInput, DrawingAsset, CaptureTimelineNodeInput, TimelineCapturedNode, PreparePptxEditorResult, SavePptxEditorSnapshotInput, SavePptxEditorAssetInput, ExportPptxEditorInput, ClosePptxEditorInput, PptxEditorSaveResult, PptxEditorSaveAssetResult, PrepareXlsxEditorResult, PreviewGrant, ProviderTestInput, ProviderSnapshot, ProviderTestResult, RedeemResult, RecentFile, ReportCapabilityResult, RendererLogInput, CloseXlsxEditorInput, SpreadsheetPlanFieldsInput, SpreadsheetPlanFieldsResult, SaveDocxResult, SaveXlsxEditorInput, StageXlsxEditorImageInput, SaveXlsxEditorResult, SubmitReportInput, SubmitReportResult, TaskHistoryEntry, UserSettings, WorkspaceSummary, WhoAmIResult } from "../shared/types";
import type { JiraConnectionSummary, JiraProbeResult, LiquipediaConnectionSummary, LiquipediaProbeResult, MarketingCampaignPlanInput, MarketingCampaignPlanResult, CampaignImageInput, CampaignImageResult } from "../shared/verticals";
import { defaultProxySettings } from "./defaults";
import { agentClientId } from "./agentClientIdentity";

// The Wails-generated bindings live alongside the renderer; tsconfig must
// include them. Imports are static so the build picks them up; calls only
// fire when window.go is available.
import * as WailsApp from "./generated/wailsjs/go/main/App";
import { EventsOn, OnFileDrop, OnFileDropOff } from "./generated/wailsjs/runtime";
import type { settings as settingsNS } from "./generated/wailsjs/go/models";

// toWails coerces a renderer-side typed value into the `never`-shaped argument
// that the Wails-generated bindings expect. The generated d.ts files describe
// arg types as `never` (the Wails codegen quirk), so every call site would
// otherwise sprout an `as never`; concentrating that cast here makes the
// suppression auditable and keeps call sites readable.
function toWails<T>(value: T): never {
  return value as unknown as never;
}

function stampOriginClientId(input: AgentRunStartInput): AgentRunStartInput {
  if (input.metadata?.origin_client_id) return input;
  return {
    ...input,
    metadata: { ...(input.metadata ?? {}), origin_client_id: agentClientId() },
  };
}

function optionalWailsFunction<T extends (...args: never[]) => unknown>(name: string): T | undefined {
  return (WailsApp as unknown as Record<string, unknown>)[name] as T | undefined;
}

const DEFAULT_BROWSER_SETTINGS: UserSettings = {
  version: 1,
  defaults: {
    documentType: "pptx",
    enableImages: true,
    imageQuality: "standard",
  },
  workspaceDir: null,
  outputDir: null,
  llmProvider: null,
  onboardingCompletedAt: null,
  proxy: { ...defaultProxySettings },
  imageWatermark: { showWatermark: true, preferenceSource: "system" },
  waiting2048Enabled: false,
};

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

function createBrowserPreviewAPI(): DesktopAPI {
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
    exportLogs: async (_input?: import("../shared/types").ExportLogsInput) => {
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
function decodeRawBytes(bytes: number[] | null | undefined): unknown {
  if (!bytes || bytes.length === 0) {
    return null;
  }
  const text = new TextDecoder().decode(new Uint8Array(bytes));
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

// The Go layer returns typed documents, but both transports hand back plain
// JSON. Normalise defensively so a malformed row cannot reach the prompt.
// The Go side takes base64; the renderer works in bytes.
function serializeStageXlsxEditorImageInput(input: StageXlsxEditorImageInput) {
  const { data, ...rest } = input;
  return data === undefined ? rest : { ...rest, dataBase64: uint8ArrayToBase64(data) };
}

function normalizeLocalTextDocuments(raw: unknown): LocalTextDocument[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const row = entry as Record<string, unknown>;
    const filePath = typeof row.filePath === "string" ? row.filePath : "";
    const text = typeof row.text === "string" ? row.text : "";
    if (!filePath) return [];
    return [{
      filePath,
      fileName: typeof row.fileName === "string" && row.fileName ? row.fileName : filePath,
      text,
      truncated: row.truncated === true,
    }];
  });
}

function decodeArtifactBytes(raw: unknown): Uint8Array {
  // Wails serializes `[]byte` struct fields as standard Go-JSON base64 strings,
  // while bare `[]byte` returns arrive as number arrays. Handle both, plus the
  // Uint8Array shape used by unit tests.
  if (!raw) return new Uint8Array();
  if (raw instanceof Uint8Array) return raw;
  if (raw instanceof ArrayBuffer) return new Uint8Array(raw);
  if (typeof raw === "string") {
    const binary = atob(raw);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }
  if (Array.isArray(raw)) return new Uint8Array(raw as number[]);
  return new Uint8Array();
}

function serializeSavePptxEditorSnapshotInput(input: SavePptxEditorSnapshotInput) {
  const { content, ...rest } = input;
  return { ...rest, contentBase64: uint8ArrayToBase64(content) };
}

function serializeSavePptxEditorAssetInput(input: SavePptxEditorAssetInput) {
  const { data, contentType, ...rest } = input;
  return { ...rest, contentType: contentType ?? "", dataBase64: uint8ArrayToBase64(data) };
}

/** Go sends []byte as base64; hand the renderer real bytes instead. */
function decodePreparePptxEditorResult(raw: PreparePptxEditorResult): PreparePptxEditorResult {
  return {
    ...raw,
    content: decodeArtifactBytes(raw.content),
    assets: (raw.assets ?? []).map((asset) => ({ ...asset, data: decodeArtifactBytes(asset.data) })),
  };
}

function uint8ArrayToBase64(data: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < data.length; i += chunk) {
    binary += String.fromCharCode(...data.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function normaliseCreditStatus(raw: Partial<CreditStatus> | null | undefined): CreditStatus {
  const numberOrZero = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) ? value : 0);
  const numberOrNull = (value: unknown): number | null =>
    typeof value === "number" && Number.isFinite(value) ? value : null;
  const stringOrEmpty = (value: unknown): string => (typeof value === "string" ? value : "");
  const modes = ["anonymous", "logged_in", "api_key"] as const;
  const mode = (modes as readonly string[]).includes(stringOrEmpty(raw?.mode))
    ? (raw!.mode as CreditStatus["mode"])
    : "anonymous";
  return {
    mode,
    accessMode: stringOrEmpty(raw?.accessMode),
    planName: stringOrEmpty(raw?.planName),
    hostedCreditBalance: numberOrNull(raw?.hostedCreditBalance),
    anonymousCreditAvailable: numberOrNull(raw?.anonymousCreditAvailable),
    anonymousCreditReserved: numberOrNull(raw?.anonymousCreditReserved),
    anonymousCreditBalance: numberOrNull(raw?.anonymousCreditBalance),
    rewardRemaining: numberOrZero(raw?.rewardRemaining),
    paidKeyPrefix: stringOrEmpty(raw?.paidKeyPrefix),
    paidKeyTotal: numberOrZero(raw?.paidKeyTotal),
    paidKeyUsed: numberOrZero(raw?.paidKeyUsed),
    paidKeyRemaining: numberOrZero(raw?.paidKeyRemaining),
    paidEntitlement: raw?.paidEntitlement === true,
    raw: stringOrEmpty(raw?.raw),
  };
}

/**
 * Maps the renderer-facing Partial<UserSettings> shape onto the Wails
 * settings.Patch struct. The Go side distinguishes "leave unchanged" from
 * "set to value" by nil pointers; in JSON-over-Wails that becomes "field
 * absent" vs "field present", so we only assign keys the caller explicitly
 * provided.
 */
function adaptSettingsPatch(patch: Partial<UserSettings>): settingsNS.Patch {
  const out: Record<string, unknown> = {};
  if (patch.defaults !== undefined) {
    const d: Record<string, unknown> = {};
    if (patch.defaults.documentType !== undefined) d.documentType = patch.defaults.documentType;
    if (patch.defaults.enableImages !== undefined) d.enableImages = patch.defaults.enableImages;
    if (patch.defaults.imageQuality !== undefined) d.imageQuality = patch.defaults.imageQuality;
    out.defaults = d;
  }
  if (patch.outputDir !== undefined) {
    out.outputDir = patch.outputDir ?? "";
  }
  if (patch.workspaceDir !== undefined) {
    out.workspaceDir = patch.workspaceDir ?? "";
  }
  if (patch.llmProvider !== undefined) {
    if (patch.llmProvider === null) {
      out.clearLlmProvider = true;
    } else {
      out.llmProvider = patch.llmProvider;
    }
  }
  if (patch.onboardingCompletedAt !== undefined) {
    out.onboardingCompletedAt = patch.onboardingCompletedAt ?? "";
  }
  if (patch.proxy !== undefined) {
    if (patch.proxy === null) {
      out.clearProxy = true;
    } else {
      out.proxy = patch.proxy;
    }
  }
  if (patch.imageWatermark !== undefined) {
    out.imageWatermark = patch.imageWatermark;
  }
  if (patch.waiting2048Enabled !== undefined) {
    out.waiting2048Enabled = patch.waiting2048Enabled;
  }
  return out as unknown as settingsNS.Patch;
}

function normaliseUserSettings(raw: unknown): UserSettings {
  // Wails populates absent optional fields as undefined; the renderer's
  // DesktopAPI expects `string | null`. Coerce here so downstream code can
  // continue to rely on the existing null sentinel.
  const merged = (raw as UserSettings) ?? DEFAULT_BROWSER_SETTINGS;
  return {
    ...merged,
    workspaceDir: merged.workspaceDir ?? merged.outputDir ?? null,
    outputDir: merged.outputDir ?? null,
    llmProvider: (merged.llmProvider ?? null) as LlmProvider | null,
    onboardingCompletedAt: merged.onboardingCompletedAt ?? null,
    proxy: merged.proxy ?? { ...defaultProxySettings },
    imageWatermark: {
      showWatermark: merged.imageWatermark?.showWatermark === true,
      preferenceSource: merged.imageWatermark?.preferenceSource === "user" ? "user" : "system",
    },
    waiting2048Enabled: merged.waiting2048Enabled === true,
  };
}

function normaliseTaskHistory(raw: unknown): TaskHistoryEntry[] {
  if (!Array.isArray(raw)) return [];
  const entries: TaskHistoryEntry[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const taskId = typeof record.taskId === "string" ? record.taskId : "";
    if (!taskId) continue;
    const events = Array.isArray(record.events)
      ? (record.events.filter(
          (event): event is BridgeEvent =>
            Boolean(event) && typeof event === "object" && typeof (event as { type?: unknown }).type === "string",
        ))
      : [];
    entries.push({
      taskId,
      createdAt: typeof record.createdAt === "string" ? record.createdAt : undefined,
      conversationId: typeof record.conversationId === "string" ? record.conversationId : undefined,
      parentTaskId: typeof record.parentTaskId === "string" ? record.parentTaskId : undefined,
      workspaceId: typeof record.workspaceId === "string" ? record.workspaceId : undefined,
      workspacePath: typeof record.workspacePath === "string" ? record.workspacePath : undefined,
      events,
    });
  }
  return entries;
}

function normaliseWorkspaceSummaries(raw: unknown): WorkspaceSummary[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    .map((item) => ({
      id: typeof item.id === "string" ? item.id : "",
      path: typeof item.path === "string" ? item.path : "",
      name: typeof item.name === "string" ? item.name : "",
      active: item.active === true,
      updatedAt: typeof item.updatedAt === "string" ? item.updatedAt : undefined,
      lastActiveAt: typeof item.lastActiveAt === "string" ? item.lastActiveAt : undefined,
    }))
    .filter((workspace) => workspace.id && workspace.path);
}

export function normaliseRecentFiles(raw: unknown): RecentFile[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    .map((item): RecentFile | null => {
      const filePath = typeof item.filePath === "string" ? item.filePath.trim() : "";
      const source = item.source === "generated" || item.source === "local" ? item.source : null;
      if (!filePath || !source) return null;
      const pathName = filePath.split(/[\\/]/).pop() || filePath;
      const fileName = typeof item.fileName === "string" && item.fileName.trim() ? item.fileName.trim() : pathName;
      const extension = pathName.includes(".") ? pathName.split(".").pop()?.toLowerCase() ?? "" : "";
      return {
        filePath,
        fileName,
        documentType: typeof item.documentType === "string" && item.documentType.trim() ? item.documentType.trim().toLowerCase() : extension,
        source,
        ...(typeof item.workspaceId === "string" && item.workspaceId ? { workspaceId: item.workspaceId } : {}),
        ...(typeof item.taskId === "string" && item.taskId ? { taskId: item.taskId } : {}),
        ...(typeof item.conversationId === "string" && item.conversationId ? { conversationId: item.conversationId } : {}),
        lastOpenedAt: typeof item.lastOpenedAt === "string" ? item.lastOpenedAt : "",
      };
    })
    .filter((file): file is RecentFile => file !== null);
}

function createWailsAPI(): DesktopAPI {
  return {
    initialize: async () => decodeRawBytes(await WailsApp.Initialize()),
    getCapabilities: async () => decodeRawBytes(await WailsApp.GetCapabilities()),
    startAgentRun: async (input: AgentRunStartInput): Promise<AgentRun> => {
      const fn = optionalWailsFunction<(arg: never) => Promise<AgentRun>>("StartAgentRun");
      if (!fn) throw new Error("Agent Runtime requires a newer OfficeDex runtime.");
      return fn(toWails(stampOriginClientId(input)));
    },
    getAgentRun: async (runId: string): Promise<AgentRun> => {
      const fn = optionalWailsFunction<(arg: never) => Promise<AgentRun>>("GetAgentRun");
      if (!fn) throw new Error("Agent Runtime requires a newer OfficeDex runtime.");
      return fn(toWails(runId));
    },
    listAgentRuns: async (limit = 50): Promise<AgentRun[]> => {
      const fn = optionalWailsFunction<(arg: never) => Promise<AgentRun[]>>("ListAgentRuns");
      if (!fn) throw new Error("Agent Runtime requires a newer OfficeDex runtime.");
      return fn(toWails(limit));
    },
    respondAgentRun: async (input: AgentRunRespondInput): Promise<void> => {
      const fn = optionalWailsFunction<(arg: never) => Promise<void>>("RespondAgentRun");
      if (!fn) throw new Error("Agent Runtime requires a newer OfficeDex runtime.");
      await fn(toWails(input));
    },
    approveAgentRun: async (input: AgentRunApproveInput): Promise<void> => {
      const fn = optionalWailsFunction<(arg: never) => Promise<void>>("ApproveAgentRun");
      if (!fn) throw new Error("Agent Runtime requires a newer OfficeDex runtime.");
      await fn(toWails(input));
    },
    retryAgentRun: async (runId: string): Promise<AgentRun> => {
      const fn = optionalWailsFunction<(arg: never) => Promise<AgentRun>>("RetryAgentRun");
      if (!fn) throw new Error("Agent Runtime requires a newer OfficeDex runtime.");
      return fn(toWails(runId));
    },
    cancelAgentRun: async (runId: string): Promise<void> => {
      const fn = optionalWailsFunction<(arg: never) => Promise<void>>("CancelAgentRun");
      if (!fn) throw new Error("Agent Runtime requires a newer OfficeDex runtime.");
      await fn(toWails(runId));
    },
    completeAgentClientTool: async (input: AgentClientToolResultInput): Promise<void> => {
      const fn = optionalWailsFunction<(arg: never) => Promise<void>>("CompleteAgentClientTool");
      if (!fn) throw new Error("Agent Runtime requires a newer OfficeDex runtime.");
      await fn(toWails(input));
    },
    reassignAgentClientTool: async (input: AgentClientToolReassignInput): Promise<void> => {
      const fn = optionalWailsFunction<(arg: never) => Promise<void>>("ReassignAgentClientTool");
      if (!fn) throw new Error("Agent Runtime requires a newer OfficeDex runtime.");
      await fn(toWails(input));
    },
    listImageTemplates: async (): Promise<ImagePromptTemplate[]> => {
      const fn = (WailsApp as unknown as { ListImageTemplates?: () => Promise<ImagePromptTemplate[]> }).ListImageTemplates;
      return fn ? fn() : [];
    },
    createImageTemplate: async (input: CreateUserImageTemplateInput): Promise<ImagePromptTemplate> => {
      const fn = (WailsApp as unknown as { CreateImageTemplate?: (arg1: never) => Promise<ImagePromptTemplate> }).CreateImageTemplate;
      if (!fn) throw new Error("Creating image templates requires a newer OfficeDex runtime.");
      return fn(toWails(input));
    },
    createImageTemplatePublishRequest: async (input: CreateImageTemplatePublishRequestInput): Promise<ImageTemplatePublishRequest> => {
      const fn = (WailsApp as unknown as { CreateImageTemplatePublishRequest?: (arg1: never) => Promise<ImageTemplatePublishRequest> }).CreateImageTemplatePublishRequest;
      if (!fn) throw new Error("Publishing image templates requires a newer OfficeDex runtime.");
      return fn(toWails(input));
    },
    generate: async (input: GenerateInput) => {
      const result = await WailsApp.Generate(toWails(input));
      return { taskId: result.taskId, sessionId: result.sessionId, status: result.status };
    },
    getJiraConnection: async () => {
      const fn = optionalWailsFunction<() => Promise<JiraConnectionSummary>>("GetJiraConnection");
      if (!fn) throw new Error("Jira connections require a newer OfficeDex runtime.");
      return fn();
    },
    saveJiraConnection: async (input) => {
      const fn = optionalWailsFunction<(arg: never) => Promise<JiraProbeResult>>("SaveJiraConnection");
      if (!fn) throw new Error("Jira connections require a newer OfficeDex runtime.");
      return fn(toWails(input));
    },
    clearJiraConnection: async () => {
      const fn = optionalWailsFunction<() => Promise<void>>("ClearJiraConnection");
      if (!fn) throw new Error("Jira connections require a newer OfficeDex runtime.");
      await fn();
    },
    getLiquipediaConnection: async () => {
      const fn = optionalWailsFunction<() => Promise<LiquipediaConnectionSummary>>("GetLiquipediaConnection");
      if (!fn) throw new Error("Liquipedia connections require a newer OfficeDex runtime.");
      return fn();
    },
    saveLiquipediaConnection: async (input) => {
      const fn = optionalWailsFunction<(arg: never) => Promise<LiquipediaProbeResult>>("SaveLiquipediaConnection");
      if (!fn) throw new Error("Liquipedia connections require a newer OfficeDex runtime.");
      return fn(toWails(input));
    },
    clearLiquipediaConnection: async () => {
      const fn = optionalWailsFunction<() => Promise<void>>("ClearLiquipediaConnection");
      if (!fn) throw new Error("Liquipedia connections require a newer OfficeDex runtime.");
      await fn();
    },
    planSpreadsheetFields: async (input) => {
      const fn = optionalWailsFunction<(arg: never) => Promise<SpreadsheetPlanFieldsResult>>("PlanSpreadsheetFields");
      if (!fn) throw new Error("Spreadsheet field planning requires a newer OfficeDex runtime.");
      return fn(toWails(input));
    },
    planShopifyCatalogCampaign: async (input) => {
      const fn = optionalWailsFunction<(arg: never) => Promise<MarketingCampaignPlanResult>>("PlanShopifyCatalogCampaign");
      if (!fn) throw new Error("Shopify campaign planning requires a newer OfficeDex runtime.");
      return fn(toWails(input));
    },
    composeCampaignImage: async (input) => {
      const fn = optionalWailsFunction<(arg: never) => Promise<CampaignImageResult>>("ComposeCampaignImage");
      if (!fn) throw new Error("Campaign image composition requires a newer OfficeDex runtime.");
      return fn(toWails(input));
    },
    modify: async (input: ModifyInput) => {
      const result = await WailsApp.Modify(toWails(input));
      return { taskId: result.taskId, sessionId: result.sessionId, status: result.status };
    },
    artifactStageEdit: async (input: ArtifactStageRuntimeInput) => {
      const fn = (WailsApp as unknown as { ArtifactStageEdit?: (arg1: never) => Promise<{ taskId: string; sessionId: string; status: string }> }).ArtifactStageEdit;
      if (!fn) throw new Error("Artifact Stage editing requires a newer OfficeDex runtime.");
      const result = await fn(toWails(input));
      return { taskId: result.taskId, sessionId: result.sessionId, status: result.status };
    },
    respond: async (input) => decodeRawBytes(await WailsApp.Respond(toWails(input))),
    cancel: async (taskId: string) => decodeRawBytes(await WailsApp.Cancel(taskId)),
    openPath: (filePath) => WailsApp.OpenPath(filePath),
    showItemInFolder: (filePath) => WailsApp.ShowItemInFolder(filePath),
    openExternal: (url) => WailsApp.OpenExternal(url),
    openFileDialog: async (options) => {
      const result = await WailsApp.OpenFileDialog(toWails(options ?? { filters: [] }));
      return result ? result : null;
    },
    openDirectoryDialog: async () => {
      const result = await WailsApp.OpenDirectoryDialog();
      return result ? result : null;
    },
    openMultiFileDialog: async (options) => {
      const result = await WailsApp.OpenMultiFileDialog(toWails(options ?? { filters: [] }));
      return result && result.length > 0 ? result : null;
    },
    savePastedImage: async (data: Uint8Array, ext: string) => {
      return WailsApp.SavePastedImage(toWails({
        dataBase64: uint8ArrayToBase64(data),
        ext,
      }));
    },
    savePptx: async (data: Uint8Array, fileName: string, options = {}) => {
      return WailsApp.SavePptx(toWails({
        dataBase64: uint8ArrayToBase64(data),
        fileName,
        targetFilePath: options.targetFilePath,
      }));
    },
    saveDocx: async (data, fileName, options): Promise<SaveDocxResult> => {
      const fn = optionalWailsFunction<(arg: never) => Promise<SaveDocxResult>>("SaveDocx");
      if (!fn) throw new Error("DOCX editing requires a newer OfficeDex runtime.");
      return fn(toWails({
        dataBase64: uint8ArrayToBase64(data),
        fileName,
        previewToken: options.previewToken,
        expectedSHA256: options.expectedSHA256,
        saveAsCopy: options.saveAsCopy,
      }));
    },
    planPptxJS: async (input) => {
      const fn = optionalWailsFunction<(arg: never) => Promise<PlanPptxJSResult>>("PlanPptxJS");
      if (!fn) throw new Error("PlanPptxJS bridge binding is unavailable.");
      return fn(toWails(input));
    },
    previewArtifact: (artifact: Artifact) => WailsApp.PreviewArtifact(toWails(artifact)),
    issuePreviewToken: async (artifact: Artifact): Promise<PreviewGrant> =>
      WailsApp.IssuePreviewToken(toWails(artifact)),
    revokePreviewToken: async (token: string) => {
      await WailsApp.RevokePreviewToken(token);
    },
    createLivePptxDraft: async (taskId: string) => {
      const fn = optionalWailsFunction<(arg: string) => Promise<{ filePath: string; fileName: string }>>("CreateLivePptxDraft");
      if (!fn) throw new Error("Live PPTX drawing requires a newer OfficeDex runtime.");
      return fn(taskId);
    },
    readDrawingAsset: async (assetsDir: string, digest: string): Promise<DrawingAsset> => {
      const fn = optionalWailsFunction<(arg: never) => Promise<DrawingAsset>>("ReadDrawingAsset");
      if (!fn) throw new Error("Drawing assets require a newer OfficeDex runtime.");
      return fn(toWails({ assetsDir, digest }));
    },
    captureTimelineNode: async (input: CaptureTimelineNodeInput): Promise<TimelineCapturedNode> => {
      const fn = optionalWailsFunction<(arg: never) => Promise<TimelineCapturedNode>>("CaptureTimelineNode");
      if (!fn) throw new Error("Timeline capture requires a newer OfficeDex runtime.");
      return fn(toWails(input));
    },
    createWorkbookFromSheet: async (input: CreateWorkbookFromSheetInput): Promise<Artifact> => {
      const fn = optionalWailsFunction<(arg: never) => Promise<Artifact>>("CreateWorkbookFromSheet");
      if (!fn) throw new Error("Creating a workbook requires a newer OfficeDex runtime.");
      return fn(toWails(input));
    },
    preparePptxEditor: async (previewToken: string): Promise<PreparePptxEditorResult> => {
      const fn = optionalWailsFunction<(token: string) => Promise<PreparePptxEditorResult>>("PreparePptxEditor");
      if (!fn) throw new Error("PPTX editing requires a newer OfficeDex runtime.");
      return decodePreparePptxEditorResult(await fn(previewToken));
    },
    savePptxEditorSnapshot: async (input: SavePptxEditorSnapshotInput): Promise<PptxEditorSaveResult> => {
      const fn = optionalWailsFunction<(arg: never) => Promise<PptxEditorSaveResult>>("SavePptxEditorSnapshot");
      if (!fn) throw new Error("PPTX editing requires a newer OfficeDex runtime.");
      return fn(toWails(serializeSavePptxEditorSnapshotInput(input)));
    },
    savePptxEditorAsset: async (input: SavePptxEditorAssetInput): Promise<PptxEditorSaveAssetResult> => {
      const fn = optionalWailsFunction<(arg: never) => Promise<PptxEditorSaveAssetResult>>("SavePptxEditorAsset");
      if (!fn) throw new Error("PPTX editing requires a newer OfficeDex runtime.");
      return fn(toWails(serializeSavePptxEditorAssetInput(input)));
    },
    exportPptxEditor: async (input: ExportPptxEditorInput): Promise<PptxEditorSaveResult> => {
      const fn = optionalWailsFunction<(arg: never) => Promise<PptxEditorSaveResult>>("ExportPptxEditor");
      if (!fn) throw new Error("PPTX editing requires a newer OfficeDex runtime.");
      return fn(toWails(input));
    },
    closePptxEditor: async (input: ClosePptxEditorInput): Promise<void> => {
      const fn = optionalWailsFunction<(arg: never) => Promise<void>>("ClosePptxEditor");
      if (!fn) throw new Error("PPTX editing requires a newer OfficeDex runtime.");
      await fn(toWails(input));
    },
    prepareXlsxEditor: async (previewToken: string): Promise<PrepareXlsxEditorResult> => {
      const fn = optionalWailsFunction<(token: string) => Promise<PrepareXlsxEditorResult>>("PrepareXlsxEditor");
      if (!fn) throw new Error("XLSX editing requires a newer OfficeDex runtime.");
      return fn(previewToken);
    },
    saveXlsxEditor: async (input: SaveXlsxEditorInput): Promise<SaveXlsxEditorResult> => {
      const fn = optionalWailsFunction<(arg: never) => Promise<SaveXlsxEditorResult>>("SaveXlsxEditor");
      if (!fn) throw new Error("XLSX editing requires a newer OfficeDex runtime.");
      return fn(toWails(input));
    },
    stageXlsxEditorImage: async (input: StageXlsxEditorImageInput): Promise<{ url: string }> => {
      const fn = optionalWailsFunction<(arg: never) => Promise<{ url: string }>>("StageXlsxEditorImage");
      if (!fn) throw new Error("XLSX editing requires a newer OfficeDex runtime.");
      return fn(toWails(serializeStageXlsxEditorImageInput(input)));
    },
    closeXlsxEditor: async (input: CloseXlsxEditorInput): Promise<void> => {
      const fn = optionalWailsFunction<(arg: never) => Promise<void>>("CloseXlsxEditor");
      if (!fn) throw new Error("XLSX editing requires a newer OfficeDex runtime.");
      await fn(toWails(input));
    },
    readArtifactFile: async (previewToken: string) => {
      const result = await WailsApp.ReadArtifactFile(previewToken) as { data?: unknown; sha256?: unknown };
      const data: BinaryFileData = decodeArtifactBytes(result?.data);
      return { data, sha256: typeof result?.sha256 === "string" ? result.sha256 : undefined };
    },
    readLocalImage: async (filePath: string) => {
      const result = await WailsApp.ReadLocalImage(filePath);
      const data: BinaryFileData = decodeArtifactBytes(result?.data);
      const mime = typeof result?.mime === "string" ? result.mime : "application/octet-stream";
      return { data, mime };
    },
    readLocalTextDocuments: async (filePaths: string[]) => (
      normalizeLocalTextDocuments(await WailsApp.ReadLocalTextDocuments(filePaths))
    ),
    copyImageToClipboard: (filePath: string) => WailsApp.CopyImageToClipboard(filePath),
    setPreviewMode: (active: boolean) => WailsApp.SetPreviewMode(active),
    login: async (input?: LoginInput) => WailsApp.Login(toWails(input ?? {})),
    cancelLogin: async () => WailsApp.CancelLogin(),
    whoami: async (): Promise<WhoAmIResult> => {
      const result = await WailsApp.WhoAmI();
      return {
        mode: (result.mode as WhoAmIResult["mode"]) ?? "anonymous",
        ...(result.userId ? { userId: result.userId } : {}),
        ...(result.email ? { email: result.email } : {}),
        ...(result.session ? { session: result.session } : {}),
        ...(result.expiresAt ? { expiresAt: result.expiresAt } : {}),
      };
    },
    logout: () => WailsApp.Logout(),
    getCreditStatus: async (): Promise<CreditStatus> => {
      const raw = (await WailsApp.GetCreditStatus()) as Partial<CreditStatus> | null | undefined;
      return normaliseCreditStatus(raw);
    },
    getInviteInfo: async (): Promise<InviteInfo> => {
      const fn = optionalWailsFunction<(arg1?: never) => Promise<InviteInfo>>("GetInviteInfo");
      if (!fn) throw new Error("Invite code requires a newer OfficeDex runtime.");
      const result = await fn();
      return { invite_code: typeof result?.invite_code === "string" ? result.invite_code : "" };
    },
    redeem: async (code: string): Promise<RedeemResult> => {
      const result = await WailsApp.Redeem(code);
      return {
        code: result?.code ?? "",
        credit_amount: result?.credit_amount ?? 0,
        new_balance: result?.new_balance ?? 0,
        redeemed_at: result?.redeemed_at ?? "",
        expires_at: result?.expires_at ?? null,
      };
    },
    getSettings: async () => normaliseUserSettings(await WailsApp.GetSettings()),
    updateSettings: async (patch: Partial<UserSettings>) =>
      normaliseUserSettings(await WailsApp.UpdateSettings(adaptSettingsPatch(patch))),
    getDefaultWorkspaceDir: () => WailsApp.GetDefaultWorkspaceDir(),
    listWorkspaces: async () => {
      const fn = optionalWailsFunction<() => Promise<unknown>>(["List", "Workspaces"].join(""));
      if (!fn) return [];
      return normaliseWorkspaceSummaries(await fn());
    },
    listRecentFiles: async (workspaceId?: string) => {
      const fn = optionalWailsFunction<(workspaceId: string) => Promise<unknown>>(["List", "Recent", "Files"].join(""));
      if (!fn) throw new Error("Recent files require a newer OfficeDex runtime.");
      return normaliseRecentFiles(await fn(workspaceId ?? ""));
    },
    removeRecentFile: async (filePath: string) => {
      const fn = optionalWailsFunction<(filePath: string) => Promise<void>>(["Remove", "Recent", "File"].join(""));
      if (!fn) throw new Error("Recent file removal requires a newer OfficeDex runtime.");
      await fn(filePath);
    },
    deleteDocument: async (taskId: string) => {
      const fn = optionalWailsFunction<(taskId: string) => Promise<void>>(["Delete", "Document"].join(""));
      if (!fn) throw new Error("Document deletion requires a newer OfficeDex runtime.");
      await fn(taskId);
    },
    renameWorkspace: async (workspaceId: string, name: string) => {
      const fn = optionalWailsFunction<(workspaceId: string, name: string) => Promise<unknown>>(["Rename", "Workspace"].join(""));
      if (!fn) throw new Error("Workspace rename requires a newer OfficeDex runtime.");
      return normaliseWorkspaceSummaries([await fn(workspaceId, name)])[0];
    },
    openRecentFile: async (file: RecentFile) => {
      const fn = optionalWailsFunction<(file: never) => Promise<Artifact>>(["Open", "Recent", "File"].join(""));
      if (!fn) throw new Error("Opening recent files requires a newer OfficeDex runtime.");
      return fn(toWails(file));
    },
    addWorkspace: async (path: string) => {
      const fn = optionalWailsFunction<(path: string) => Promise<unknown>>(["Add", "Workspace"].join(""));
      if (!fn) throw new Error("Workspace switching requires a newer OfficeDex runtime.");
      return normaliseWorkspaceSummaries([await fn(path)])[0];
    },
    selectWorkspace: async (workspaceId: string) => {
      const fn = optionalWailsFunction<(workspaceId: string) => Promise<unknown>>(["Select", "Workspace"].join(""));
      if (!fn) throw new Error("Workspace switching requires a newer OfficeDex runtime.");
      return normaliseWorkspaceSummaries([await fn(workspaceId)])[0];
    },
    removeWorkspace: async (workspaceId: string) => {
      const fn = optionalWailsFunction<(workspaceId: string) => Promise<void>>(["Remove", "Workspace"].join(""));
      if (!fn) throw new Error("Workspace removal requires a newer OfficeDex runtime.");
      await fn(workspaceId);
    },
    onAuthEvent: (callback: (event: AuthEvent) => void) =>
      EventsOn("auth:event", (payload: unknown) => callback(payload as AuthEvent)),
    onBridgeEvent: (callback: (event: BridgeEvent) => void) =>
      EventsOn("bridge:event", (payload: unknown) => callback(payload as BridgeEvent)),
    onFileDrop: (callback: (paths: string[]) => void) => {
      OnFileDrop((_x: number, _y: number, paths: string[]) => callback(Array.isArray(paths) ? paths : []), true);
      return () => OnFileDropOff();
    },
    getAppVersion: () => WailsApp.GetAppVersion(),
    getAppUpdateStatus: async () => normaliseAppUpdateStatus(await WailsApp.GetAppUpdateStatus()),
    checkAppUpdate: async () => {
      const result = await WailsApp.CheckAppUpdate();
      return normaliseAppUpdateCheckResult(result);
    },
    downloadAppUpdate: () => WailsApp.DownloadAppUpdate(),
    installAppUpdate: () => WailsApp.InstallAppUpdate(),
    cancelAppUpdate: () => WailsApp.CancelAppUpdate(),
    onAppUpdateEvent: (callback: (event: AppUpdateEvent) => void) =>
      EventsOn("appupdate:event", (payload: unknown) => callback(payload as AppUpdateEvent)),
    exportLogs: (input?: import("../shared/types").ExportLogsInput) =>
      WailsApp.ExportLogs(toWails(input ?? {})) as Promise<{ path: string; manifest: import("../shared/types").BundleManifest }>,
    recordRendererLog: async (input: RendererLogInput) => {
      const fn = optionalWailsFunction<(input: never) => Promise<void>>("RecordRendererLog");
      if (!fn) return;
      await fn(toWails(input));
    },
    submitReport: (input: SubmitReportInput) =>
      WailsApp.SubmitReport(toWails(input)) as Promise<SubmitReportResult>,
    getReportCapability: () =>
      WailsApp.GetReportCapability() as Promise<ReportCapabilityResult>,
    peekReportContext: (taskId: string) =>
      WailsApp.PeekReportContext(taskId) as Promise<PeekReportContextResult>,
    getTaskHistory: async (limit?: number): Promise<TaskHistoryEntry[]> => {
      const raw = (await WailsApp.GetTaskHistory(toWails(limit ?? 50))) as unknown;
      return normaliseTaskHistory(raw);
    },
    getBridgeRuntimeSnapshot: async (): Promise<BridgeRuntimeSnapshot> => {
      const raw = (await WailsApp.GetBridgeRuntimeSnapshot()) as Partial<BridgeRuntimeSnapshot> | null;
      return normaliseBridgeRuntimeSnapshot(raw);
    },
    sendDesktopNotification: async (input: { title: string; body: string }): Promise<void> => {
      const fn = optionalWailsFunction<(arg1: never) => Promise<void>>("SendDesktopNotification");
      if (!fn) throw new Error("Desktop notifications require a newer OfficeDex runtime.");
      await fn(toWails(input));
    },
    testProvider: async (input?: ProviderTestInput): Promise<ProviderTestResult> => {
      const raw = input
        ? ((await WailsApp.TestProviderWithInput(toWails(input))) as Partial<ProviderTestResult> | null)
        : ((await WailsApp.TestProvider()) as Partial<ProviderTestResult> | null);
      return {
        ok: Boolean(raw?.ok),
        httpStatus: typeof raw?.httpStatus === "number" ? raw.httpStatus : 0,
        latencyMs: typeof raw?.latencyMs === "number" ? raw.latencyMs : 0,
        url: typeof raw?.url === "string" ? raw.url : "",
        ...(raw?.error ? { error: raw.error } : {}),
        ...(raw?.responseMessage ? { responseMessage: raw.responseMessage } : {}),
        ...(raw?.unavailable ? { unavailable: Boolean(raw.unavailable) } : {}),
        ...(raw?.probeType === "officialPaid" || raw?.probeType === "http" ? { probeType: raw.probeType } : {}),
      };
    },
  };
}

export function createRealE2EAPI(endpoint: string): DesktopAPI {
  const base = endpoint.replace(/\/+$/, "");
  const rpc = async <T,>(method: string, input?: unknown): Promise<T> => {
    const response = await fetch(`${base}/rpc/${encodeURIComponent(method)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input ?? null),
    });
    const text = await response.text();
    const body = text ? JSON.parse(text) : null;
    if (!response.ok || body?.ok === false) {
      throw new Error(body?.error || `Real E2E bridge RPC ${method} failed with ${response.status}`);
    }
    return body?.result as T;
  };
  const subscribers = new Map<string, Set<(payload: unknown) => void>>();
  let eventSource: EventSource | undefined;
  const dispatchEvent = (message: MessageEvent) => {
    if (!message.data) return;
    const envelope = JSON.parse(message.data) as { channel?: string; payload?: unknown };
    if (!envelope.channel) return;
    for (const callback of subscribers.get(envelope.channel) ?? []) callback(envelope.payload);
  };
  const ensureEventSource = () => {
    if (eventSource) return eventSource;
    // One HTTP/1.1 EventSource per tab leaves connection capacity for RPCs.
    // Opening one stream per channel exhausts Chrome's per-host connection
    // limit as soon as a second OfficeDex tab is open, causing localstore RPCs
    // to queue until the renderer timeout fires.
    eventSource = new EventSource(`${base}/events?channel=*`);
    for (const channel of ["auth", "bridge", "filedrop"]) {
      eventSource.addEventListener(channel, dispatchEvent as EventListener);
    }
    eventSource.onmessage = dispatchEvent;
    return eventSource;
  };
  const subscribe = <T,>(channel: string, callback: (event: T) => void): (() => void) => {
    const callbacks = subscribers.get(channel) ?? new Set<(payload: unknown) => void>();
    const wrapped = callback as (payload: unknown) => void;
    callbacks.add(wrapped);
    subscribers.set(channel, callbacks);
    ensureEventSource();
    return () => {
      callbacks.delete(wrapped);
      if (callbacks.size === 0) subscribers.delete(channel);
      if (subscribers.size === 0 && eventSource) {
        eventSource.close();
        eventSource = undefined;
      }
    };
  };
  return {
    initialize: async () => decodeRealE2ERawBytes(await rpc<unknown>("Initialize")),
    getCapabilities: async () => decodeRealE2ERawBytes(await rpc<unknown>("GetCapabilities")),
    startAgentRun: (input: AgentRunStartInput) => rpc<AgentRun>("StartAgentRun", stampOriginClientId(input)),
    getAgentRun: (runId: string) => rpc<AgentRun>("GetAgentRun", runId),
    listAgentRuns: (limit = 50) => rpc<AgentRun[]>("ListAgentRuns", limit),
    respondAgentRun: (input: AgentRunRespondInput) => rpc<void>("RespondAgentRun", input),
    approveAgentRun: (input: AgentRunApproveInput) => rpc<void>("ApproveAgentRun", input),
    retryAgentRun: (runId: string) => rpc<AgentRun>("RetryAgentRun", runId),
    cancelAgentRun: (runId: string) => rpc<void>("CancelAgentRun", runId),
    completeAgentClientTool: (input: AgentClientToolResultInput) => rpc<void>("CompleteAgentClientTool", input),
    reassignAgentClientTool: (input: AgentClientToolReassignInput) => rpc<void>("ReassignAgentClientTool", input),
    listImageTemplates: () => rpc<ImagePromptTemplate[]>("ListImageTemplates"),
    createImageTemplate: (input: CreateUserImageTemplateInput) =>
      rpc<ImagePromptTemplate>("CreateImageTemplate", input),
    createImageTemplatePublishRequest: (input: CreateImageTemplatePublishRequestInput) =>
      rpc<ImageTemplatePublishRequest>("CreateImageTemplatePublishRequest", input),
    generate: (input: GenerateInput) =>
      rpc<{ taskId: string; sessionId: string; status: string }>("Generate", input),
    getJiraConnection: () => rpc<JiraConnectionSummary>("GetJiraConnection"),
    saveJiraConnection: (input) => rpc<JiraProbeResult>("SaveJiraConnection", input),
    clearJiraConnection: () => rpc<void>("ClearJiraConnection"),
    getLiquipediaConnection: () => rpc<LiquipediaConnectionSummary>("GetLiquipediaConnection"),
    saveLiquipediaConnection: (input) => rpc<LiquipediaProbeResult>("SaveLiquipediaConnection", input),
    clearLiquipediaConnection: () => rpc<void>("ClearLiquipediaConnection"),
    planSpreadsheetFields: (input) => rpc<SpreadsheetPlanFieldsResult>("PlanSpreadsheetFields", input),
    planShopifyCatalogCampaign: (input) => rpc<MarketingCampaignPlanResult>("PlanShopifyCatalogCampaign", input),
    composeCampaignImage: (input) => rpc<CampaignImageResult>("ComposeCampaignImage", input),
    modify: (input: ModifyInput) =>
      rpc<{ taskId: string; sessionId: string; status: string }>("Modify", input),
    artifactStageEdit: (input: ArtifactStageRuntimeInput) =>
      rpc<{ taskId: string; sessionId: string; status: string }>("ArtifactStageEdit", input),
    respond: async (input) => decodeRealE2ERawBytes(await rpc<unknown>("Respond", input)),
    cancel: async (taskId: string) => decodeRealE2ERawBytes(await rpc<unknown>("Cancel", taskId)),
    openPath: (filePath: string) => rpc<void>("OpenPath", filePath),
    showItemInFolder: (filePath: string) => rpc<void>("ShowItemInFolder", filePath),
    openExternal: (url: string) => rpc<void>("OpenExternal", url),
    openFileDialog: async (options) => {
      const result = await rpc<string>("OpenFileDialog", options ?? { filters: [] });
      return result ? result : null;
    },
    openDirectoryDialog: async () => {
      const result = await rpc<string>("OpenDirectoryDialog");
      return result ? result : null;
    },
    openMultiFileDialog: async (options) => {
      const result = await rpc<string[]>("OpenMultiFileDialog", options ?? { filters: [] });
      return result && result.length > 0 ? result : null;
    },
    savePastedImage: (data: Uint8Array, ext: string) =>
      rpc<string>("SavePastedImage", { dataBase64: uint8ArrayToBase64(data), ext }),
    savePptx: (data: Uint8Array, fileName: string, options = {}) =>
      rpc<string>("SavePptx", { dataBase64: uint8ArrayToBase64(data), fileName, targetFilePath: options.targetFilePath }),
    saveDocx: (data, fileName, options) =>
      rpc<SaveDocxResult>("SaveDocx", {
        dataBase64: uint8ArrayToBase64(data),
        fileName,
        previewToken: options.previewToken,
        expectedSHA256: options.expectedSHA256,
        saveAsCopy: options.saveAsCopy,
      }),
    planPptxJS: (input) => rpc<PlanPptxJSResult>("PlanPptxJS", input),
    previewArtifact: (artifact: Artifact) => rpc<void>("PreviewArtifact", artifact),
    issuePreviewToken: (artifact: Artifact) => rpc<PreviewGrant>("IssuePreviewToken", artifact),
    revokePreviewToken: (token: string) => rpc<void>("RevokePreviewToken", token),
    createLivePptxDraft: (taskId: string) => rpc<{ filePath: string; fileName: string }>("CreateLivePptxDraft", taskId),
    readDrawingAsset: (assetsDir: string, digest: string) =>
      rpc<DrawingAsset>("ReadDrawingAsset", { assetsDir, digest }),
    captureTimelineNode: (input: CaptureTimelineNodeInput) =>
      rpc<TimelineCapturedNode>("CaptureTimelineNode", input),
    createWorkbookFromSheet: (input: CreateWorkbookFromSheetInput) =>
      rpc<Artifact>("CreateWorkbookFromSheet", input),
    preparePptxEditor: async (previewToken: string) =>
      decodePreparePptxEditorResult(await rpc<PreparePptxEditorResult>("PreparePptxEditor", previewToken)),
    savePptxEditorSnapshot: (input: SavePptxEditorSnapshotInput) =>
      rpc<PptxEditorSaveResult>("SavePptxEditorSnapshot", serializeSavePptxEditorSnapshotInput(input)),
    savePptxEditorAsset: (input: SavePptxEditorAssetInput) =>
      rpc<PptxEditorSaveAssetResult>("SavePptxEditorAsset", serializeSavePptxEditorAssetInput(input)),
    exportPptxEditor: (input: ExportPptxEditorInput) =>
      rpc<PptxEditorSaveResult>("ExportPptxEditor", input),
    closePptxEditor: (input: ClosePptxEditorInput) =>
      rpc<void>("ClosePptxEditor", input),
    prepareXlsxEditor: (previewToken: string) =>
      rpc<PrepareXlsxEditorResult>("PrepareXlsxEditor", previewToken),
    saveXlsxEditor: (input: SaveXlsxEditorInput) =>
      rpc<SaveXlsxEditorResult>("SaveXlsxEditor", input),
    stageXlsxEditorImage: (input: StageXlsxEditorImageInput) =>
      rpc<{ url: string }>("StageXlsxEditorImage", serializeStageXlsxEditorImageInput(input)),
    closeXlsxEditor: (input: CloseXlsxEditorInput) =>
      rpc<void>("CloseXlsxEditor", input),
    readArtifactFile: async (previewToken: string) => {
      const result = await rpc<{ data?: unknown; sha256?: unknown }>("ReadArtifactFile", previewToken);
      return {
        data: decodeArtifactBytes(result?.data),
        sha256: typeof result?.sha256 === "string" ? result.sha256 : undefined,
      };
    },
    readLocalImage: async (filePath: string) => {
      const result = await rpc<{ data?: unknown; mime?: unknown }>("ReadLocalImage", filePath);
      return {
        data: decodeArtifactBytes(result?.data),
        mime: typeof result?.mime === "string" ? result.mime : "application/octet-stream",
      };
    },
    readLocalTextDocuments: async (filePaths: string[]) => (
      normalizeLocalTextDocuments(await rpc<unknown>("ReadLocalTextDocuments", filePaths))
    ),
    copyImageToClipboard: (filePath: string) => rpc<void>("CopyImageToClipboard", filePath),
    setPreviewMode: (active: boolean) => rpc<void>("SetPreviewMode", active),
    login: (input?: LoginInput) => rpc<{ url: string }>("Login", input ?? {}),
    cancelLogin: () => rpc<void>("CancelLogin"),
    whoami: async (): Promise<WhoAmIResult> => {
      const result = await rpc<Partial<WhoAmIResult>>("WhoAmI");
      return {
        mode: (result.mode as WhoAmIResult["mode"]) ?? "anonymous",
        ...(result.userId ? { userId: result.userId } : {}),
        ...(result.email ? { email: result.email } : {}),
        ...(result.session ? { session: result.session } : {}),
        ...(result.expiresAt ? { expiresAt: result.expiresAt } : {}),
      };
    },
    logout: () => rpc<void>("Logout"),
    getCreditStatus: async () => normaliseCreditStatus(await rpc<Partial<CreditStatus> | null>("GetCreditStatus")),
    getInviteInfo: async (): Promise<InviteInfo> => {
      const result = await rpc<Partial<InviteInfo> | null>("GetInviteInfo");
      return { invite_code: typeof result?.invite_code === "string" ? result.invite_code : "" };
    },
    redeem: async (code: string): Promise<RedeemResult> => {
      const result = await rpc<Partial<RedeemResult> | null>("Redeem", code);
      return {
        code: result?.code ?? "",
        credit_amount: result?.credit_amount ?? 0,
        new_balance: result?.new_balance ?? 0,
        redeemed_at: result?.redeemed_at ?? "",
        expires_at: result?.expires_at ?? null,
      };
    },
    getSettings: async () => normaliseUserSettings(await rpc<unknown>("GetSettings")),
    updateSettings: async (patch: Partial<UserSettings>) =>
      normaliseUserSettings(await rpc<unknown>("UpdateSettings", adaptSettingsPatch(patch))),
    getDefaultWorkspaceDir: () => rpc<string>("GetDefaultWorkspaceDir"),
    listWorkspaces: async () => normaliseWorkspaceSummaries(await rpc<unknown>("ListWorkspaces")),
    listRecentFiles: async (workspaceId?: string) => normaliseRecentFiles(await rpc<unknown>("ListRecentFiles", workspaceId ?? "")),
    removeRecentFile: (filePath: string) => rpc<void>("RemoveRecentFile", filePath),
    deleteDocument: (taskId: string) => rpc<void>("DeleteDocument", taskId),
    renameWorkspace: async (workspaceId: string, name: string) => normaliseWorkspaceSummaries([await rpc<unknown>("RenameWorkspace", { workspaceId, name })])[0],
    openRecentFile: (file: RecentFile) => rpc<Artifact>("OpenRecentFile", file),
    addWorkspace: async (path: string) => normaliseWorkspaceSummaries([await rpc<unknown>("AddWorkspace", path)])[0],
    selectWorkspace: async (workspaceId: string) => normaliseWorkspaceSummaries([await rpc<unknown>("SelectWorkspace", workspaceId)])[0],
    removeWorkspace: (workspaceId: string) => rpc<void>("RemoveWorkspace", workspaceId),
    onAuthEvent: (callback: (event: AuthEvent) => void) => subscribe<AuthEvent>("auth", callback),
    onBridgeEvent: (callback: (event: BridgeEvent) => void) => subscribe<BridgeEvent>("bridge", callback),
    onFileDrop: (callback: (paths: string[]) => void) => subscribe<string[]>("filedrop", (paths) => callback(Array.isArray(paths) ? paths : [])),
    getAppVersion: () => rpc<string>("GetAppVersion"),
    getAppUpdateStatus: async () => normaliseAppUpdateStatus(await rpc<unknown>("GetAppUpdateStatus")),
    checkAppUpdate: async () => normaliseAppUpdateCheckResult(await rpc<unknown>("CheckAppUpdate")),
    downloadAppUpdate: () => rpc<string>("DownloadAppUpdate"),
    installAppUpdate: () => rpc<void>("InstallAppUpdate"),
    cancelAppUpdate: () => rpc<void>("CancelAppUpdate"),
    onAppUpdateEvent: (callback: (event: AppUpdateEvent) => void) => subscribe<AppUpdateEvent>("appupdate", callback),
    exportLogs: (input?: import("../shared/types").ExportLogsInput) =>
      rpc<{ path: string; manifest: import("../shared/types").BundleManifest }>("ExportLogs", input ?? {}),
    recordRendererLog: (input: RendererLogInput) => rpc<void>("RecordRendererLog", input),
    submitReport: (input: SubmitReportInput) =>
      rpc<SubmitReportResult>("SubmitReport", input),
    getReportCapability: () =>
      rpc<ReportCapabilityResult>("GetReportCapability"),
    peekReportContext: (taskId: string) =>
      rpc<PeekReportContextResult>("PeekReportContext", taskId),
    getTaskHistory: async (limit?: number): Promise<TaskHistoryEntry[]> =>
      normaliseTaskHistory(await rpc<unknown>("GetTaskHistory", limit ?? 50)),
    getBridgeRuntimeSnapshot: async () =>
      normaliseBridgeRuntimeSnapshot(await rpc<Partial<BridgeRuntimeSnapshot> | null>("GetBridgeRuntimeSnapshot")),
    sendDesktopNotification: (input: { title: string; body: string }) =>
      rpc<void>("SendDesktopNotification", input),
    testProvider: async (input?: ProviderTestInput): Promise<ProviderTestResult> => {
      const raw = await rpc<Partial<ProviderTestResult> | null>("TestProvider", input ?? null);
      return {
        ok: Boolean(raw?.ok),
        httpStatus: typeof raw?.httpStatus === "number" ? raw.httpStatus : 0,
        latencyMs: typeof raw?.latencyMs === "number" ? raw.latencyMs : 0,
        url: typeof raw?.url === "string" ? raw.url : "",
        ...(raw?.error ? { error: raw.error } : {}),
        ...(raw?.responseMessage ? { responseMessage: raw.responseMessage } : {}),
        ...(raw?.unavailable ? { unavailable: Boolean(raw.unavailable) } : {}),
        ...(raw?.probeType === "officialPaid" || raw?.probeType === "http" ? { probeType: raw.probeType } : {}),
      };
    },
  };
}

function decodeRealE2ERawBytes(raw: unknown): unknown {
  if (typeof raw === "string") {
    try {
      const decoded = decodeArtifactBytes(raw);
      return decodeRawBytes(Array.from(decoded));
    } catch {
      try {
        return JSON.parse(raw);
      } catch {
        return raw;
      }
    }
  }
  if (Array.isArray(raw)) {
    return decodeRawBytes(raw as number[]);
  }
  return raw;
}

function normaliseAppUpdateStatus(raw: unknown): AppUpdateStatus {
  const value = (raw ?? {}) as Partial<AppUpdateStatus>;
  return {
    currentVersion: value.currentVersion ?? "0.0.0",
    latestVersion: value.latestVersion ?? null,
    updateAvailable: Boolean(value.updateAvailable),
    mandatory: Boolean(value.mandatory),
    downloading: Boolean(value.downloading),
    downloadedPath: value.downloadedPath ?? null,
    lastCheckedAt: value.lastCheckedAt ?? null,
    lastError: value.lastError ?? null,
    notes: value.notes,
    lastErrors: Array.isArray(value.lastErrors) ? value.lastErrors : [],
  };
}

function normaliseAppUpdateCheckResult(raw: unknown): AppUpdateCheckResult {
  const value = (raw ?? {}) as Partial<AppUpdateCheckResult>;
  return {
    release: (value.release ?? null) as AppUpdateCheckResult["release"],
    status: normaliseAppUpdateStatus(value.status),
  };
}

function normaliseBridgeRuntimeSnapshot(raw: Partial<BridgeRuntimeSnapshot> | null | undefined): BridgeRuntimeSnapshot {
  const value = raw ?? {};
  const raw_mode = value.runtimeMode as string | undefined;
  const mode: BridgeRuntimeSnapshot["runtimeMode"] = (raw_mode === "custom") ? "custom" : "hosted";
  const provider = normaliseProviderSnapshot(value.provider ?? null);
  const snap: BridgeRuntimeSnapshot = {
    runtimeMode: mode,
    binaryPath: typeof value.binaryPath === "string" ? value.binaryPath : "",
    envApplied: Boolean(value.envApplied),
  };
  if (typeof value.resolvedAt === "string" && value.resolvedAt) snap.resolvedAt = value.resolvedAt;
  if (typeof value.proxyHost === "string" && value.proxyHost) snap.proxyHost = value.proxyHost;
  if (provider) snap.provider = provider;
  return snap;
}

function normaliseProviderSnapshot(raw: Partial<ProviderSnapshot> | null | undefined): ProviderSnapshot | null {
  if (!raw || typeof raw !== "object") return null;
  const t = raw.type;
  if (t !== "openai" && t !== "anthropic" && t !== "azure" && t !== "custom") return null;
  return {
    type: t,
    baseUrlHost: typeof raw.baseUrlHost === "string" ? raw.baseUrlHost : "",
    model: typeof raw.model === "string" ? raw.model : "",
    apiKeyMasked: typeof raw.apiKeyMasked === "string" ? raw.apiKeyMasked : "",
    apiKeyLength: typeof raw.apiKeyLength === "number" ? raw.apiKeyLength : 0,
  };
}

function isWailsAvailable(): boolean {
  if (typeof window === "undefined") return false;
  const go = (window as unknown as { go?: { main?: { App?: unknown } } }).go;
  return Boolean(go?.main?.App);
}

function selectAPI(): DesktopAPI {
  if (isWailsAvailable()) {
    return createWailsAPI();
  }
  const realE2EEndpoint = typeof import.meta.env.VITE_OFFICEDEX_REAL_E2E_ENDPOINT === "string"
    ? import.meta.env.VITE_OFFICEDEX_REAL_E2E_ENDPOINT.trim()
    : "";
  if (import.meta.env.DEV && realE2EEndpoint) {
    // Keep browser RPC/SSE on the Vite origin. Besides avoiding CORS, this
    // isolates new tabs from stale direct bridge connections left by older
    // dev pages and lets Vite proxy the managed bridge endpoint consistently.
    return createRealE2EAPI("/__officedex_bridge");
  }
  // Test-only injection is kept for Vitest. Dev-browser E2E uses the real
  // endpoint transport above; production desktop builds always go through Wails.
  const injected = typeof window !== "undefined"
    ? ((window as unknown as Record<string, unknown>)["officecli"] as DesktopAPI | undefined)
    : undefined;
  if (injected && import.meta.env.MODE === "test") {
    return injected;
  }
  return createBrowserPreviewAPI();
}

export const officecli: DesktopAPI = selectAPI();
