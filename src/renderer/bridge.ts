import type {
  AppUpdateCheckResult,
  AppUpdateEvent,
  AppUpdateStatus,
  Artifact,
  AuthEvent,
  BinaryFileData,
  BridgeEvent,
  BridgeRuntimeSnapshot,
  CreditStatus,
  CreateImageTemplatePublishRequestInput,
  CreateUserImageTemplateInput,
  DesktopAPI,
  GenerateInput,
  ImageTemplatePublishRequest,
  ImagePromptTemplate,
  InviteInfo,
  LlmProvider,
  LoginInput,
  ModifyPptistDeckResult,
  ModifyInput,
  PeekReportContextResult,
  PrepareXlsxEditorResult,
  PreviewGrant,
  ProviderTestInput,
  ProviderSnapshot,
  ProviderTestResult,
  RedeemResult,
  RecentFile,
  ReportCapabilityResult,
  RendererLogInput,
  SaveXlsxEditorInput,
  SaveXlsxEditorResult,
  CloseXlsxEditorInput,
  SubmitReportInput,
  SubmitReportResult,
  TaskHistoryEntry,
  UserSettings,
  WorkspaceConversationSummary,
  WorkspaceSummary,
  WhoAmIResult,
} from "../shared/types";
import { defaultProxySettings } from "./defaults";

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
      conversations: [],
    },
  ];
  const browserChats: WorkspaceConversationSummary[] = [];
  let browserRecentFiles: RecentFile[] = [];
  return {
    initialize: async () => ({ browserPreview: true }),
    getCapabilities: async () => ({ browserPreview: true }),
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
    modify: async () => {
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
    exportVibeTreePptx: async () => {
      throw new Error("Exporting PPTX via pptxgenjs requires desktop bridge access.");
    },
    modifyPptistDeck: async () => {
      throw new Error("Editing PPTist decks with AI requires the desktop app.");
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
    prepareXlsxEditor: async () => {
      throw new Error("XLSX editor is unavailable in browser preview.");
    },
    saveXlsxEditor: async () => {
      throw new Error("XLSX editor is unavailable in browser preview.");
    },
    closeXlsxEditor: async () => undefined,
    readArtifactFile: async () => {
      throw new Error("Artifact file reading requires desktop file access.");
    },
    readLocalImage: async () => {
      throw new Error("Local image reading requires desktop file access.");
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
    listChats: async () => browserChats,
    listRecentFiles: async (workspaceId?: string) => browserRecentFiles.filter((file) => !workspaceId || file.workspaceId === workspaceId),
    removeRecentFile: async (filePath: string) => {
      browserRecentFiles = browserRecentFiles.filter((file) => file.filePath !== filePath);
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
    deleteConversation: async (conversationId: string) => {
      browserWorkspaces = browserWorkspaces.map((workspace) => ({
        ...workspace,
        conversations: workspace.conversations.filter((conversation) => conversation.conversationId !== conversationId),
      }));
      const chatIndex = browserChats.findIndex((conversation) => conversation.conversationId === conversationId);
      if (chatIndex >= 0) {
        browserChats.splice(chatIndex, 1);
      }
    },
    addWorkspace: async (path: string) => {
      const workspace: WorkspaceSummary = {
        id: `browser-${browserWorkspaces.length + 1}`,
        name: path.split(/[\\/]/).pop() || path,
        path,
        active: true,
        conversations: [],
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
      const removed = browserWorkspaces.find((workspace) => workspace.id === workspaceId);
      if (removed) {
        browserWorkspaces = browserWorkspaces.filter((workspace) => workspace.id !== workspaceId);
        browserChats.push(...removed.conversations);
      }
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
      conversations: Array.isArray(item.conversations)
        ? item.conversations
            .filter((conversation): conversation is Record<string, unknown> => Boolean(conversation) && typeof conversation === "object")
            .map((conversation) => ({
              conversationId: typeof conversation.conversationId === "string" ? conversation.conversationId : "",
              firstTaskId: typeof conversation.firstTaskId === "string" ? conversation.firstTaskId : "",
              latestTaskId: typeof conversation.latestTaskId === "string" ? conversation.latestTaskId : "",
              title: typeof conversation.title === "string" ? conversation.title : "",
              status: typeof conversation.status === "string" ? conversation.status as WorkspaceSummary["conversations"][number]["status"] : "completed",
              documentType: typeof conversation.documentType === "string" ? conversation.documentType : undefined,
              updatedAt: typeof conversation.updatedAt === "string" ? conversation.updatedAt : undefined,
            }))
            .filter((conversation) => conversation.conversationId && conversation.latestTaskId)
        : [],
    }))
    .filter((workspace) => workspace.id && workspace.path);
}

function normaliseConversationSummaries(raw: unknown): WorkspaceConversationSummary[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((conversation): conversation is Record<string, unknown> => Boolean(conversation) && typeof conversation === "object")
    .map((conversation) => ({
      conversationId: typeof conversation.conversationId === "string" ? conversation.conversationId : "",
      firstTaskId: typeof conversation.firstTaskId === "string" ? conversation.firstTaskId : "",
      latestTaskId: typeof conversation.latestTaskId === "string" ? conversation.latestTaskId : "",
      title: typeof conversation.title === "string" ? conversation.title : "",
      status: typeof conversation.status === "string" ? conversation.status as WorkspaceConversationSummary["status"] : "completed",
      documentType: typeof conversation.documentType === "string" ? conversation.documentType : undefined,
      updatedAt: typeof conversation.updatedAt === "string" ? conversation.updatedAt : undefined,
    }))
    .filter((conversation) => conversation.conversationId && conversation.latestTaskId);
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
    modify: async (input: ModifyInput) => {
      const result = await WailsApp.Modify(toWails(input));
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
    exportVibeTreePptx: async (tree, fileName) => {
      return WailsApp.ExportVibeTreePptx(toWails({
        treeJSON: JSON.stringify(tree),
        fileName,
      }));
    },
    modifyPptistDeck: async (input) => {
      const fn = optionalWailsFunction<(arg: never) => Promise<ModifyPptistDeckResult>>("ModifyPptistDeck");
      if (!fn) throw new Error("ModifyPptistDeck bridge binding is unavailable.");
      return fn(toWails(input));
    },
    previewArtifact: (artifact: Artifact) => WailsApp.PreviewArtifact(toWails(artifact)),
    issuePreviewToken: async (artifact: Artifact): Promise<PreviewGrant> =>
      WailsApp.IssuePreviewToken(toWails(artifact)),
    revokePreviewToken: async (token: string) => {
      await WailsApp.RevokePreviewToken(token);
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
    closeXlsxEditor: async (input: CloseXlsxEditorInput): Promise<void> => {
      const fn = optionalWailsFunction<(arg: never) => Promise<void>>("CloseXlsxEditor");
      if (!fn) throw new Error("XLSX editing requires a newer OfficeDex runtime.");
      await fn(toWails(input));
    },
    readArtifactFile: async (previewToken: string) => {
      const result = await WailsApp.ReadArtifactFile(previewToken);
      const data: BinaryFileData = decodeArtifactBytes(result?.data);
      return { data };
    },
    readLocalImage: async (filePath: string) => {
      const result = await WailsApp.ReadLocalImage(filePath);
      const data: BinaryFileData = decodeArtifactBytes(result?.data);
      const mime = typeof result?.mime === "string" ? result.mime : "application/octet-stream";
      return { data, mime };
    },
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
    listChats: async () => {
      const fn = optionalWailsFunction<() => Promise<unknown>>(["List", "Chats"].join(""));
      if (!fn) return [];
      return normaliseConversationSummaries(await fn());
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
    deleteConversation: async (conversationId: string) => {
      const fn = optionalWailsFunction<(conversationId: string) => Promise<void>>(["Delete", "Conversation"].join(""));
      if (!fn) throw new Error("Conversation deletion requires a newer OfficeDex runtime.");
      await fn(conversationId);
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

function createRealE2EAPI(endpoint: string): DesktopAPI {
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
  const subscribe = <T,>(channel: string, callback: (event: T) => void): (() => void) => {
    const source = new EventSource(`${base}/events?channel=${encodeURIComponent(channel)}`);
    const handle = (message: MessageEvent) => {
      if (!message.data) return;
      const envelope = JSON.parse(message.data) as { channel?: string; payload?: unknown };
      callback(envelope.payload as T);
    };
    source.addEventListener(channel, handle as EventListener);
    source.onmessage = handle;
    return () => source.close();
  };
  return {
    initialize: async () => decodeRealE2ERawBytes(await rpc<unknown>("Initialize")),
    getCapabilities: async () => decodeRealE2ERawBytes(await rpc<unknown>("GetCapabilities")),
    listImageTemplates: () => rpc<ImagePromptTemplate[]>("ListImageTemplates"),
    createImageTemplate: (input: CreateUserImageTemplateInput) =>
      rpc<ImagePromptTemplate>("CreateImageTemplate", input),
    createImageTemplatePublishRequest: (input: CreateImageTemplatePublishRequestInput) =>
      rpc<ImageTemplatePublishRequest>("CreateImageTemplatePublishRequest", input),
    generate: (input: GenerateInput) =>
      rpc<{ taskId: string; sessionId: string; status: string }>("Generate", input),
    modify: (input: ModifyInput) =>
      rpc<{ taskId: string; sessionId: string; status: string }>("Modify", input),
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
    exportVibeTreePptx: (tree, fileName) =>
      rpc<string>("ExportVibeTreePptx", { treeJSON: JSON.stringify(tree), fileName }),
    modifyPptistDeck: (input) => rpc("ModifyPptistDeck", input),
    previewArtifact: (artifact: Artifact) => rpc<void>("PreviewArtifact", artifact),
    issuePreviewToken: (artifact: Artifact) => rpc<PreviewGrant>("IssuePreviewToken", artifact),
    revokePreviewToken: (token: string) => rpc<void>("RevokePreviewToken", token),
    prepareXlsxEditor: (previewToken: string) =>
      rpc<PrepareXlsxEditorResult>("PrepareXlsxEditor", previewToken),
    saveXlsxEditor: (input: SaveXlsxEditorInput) =>
      rpc<SaveXlsxEditorResult>("SaveXlsxEditor", input),
    closeXlsxEditor: (input: CloseXlsxEditorInput) =>
      rpc<void>("CloseXlsxEditor", input),
    readArtifactFile: async (previewToken: string) => {
      const result = await rpc<{ data?: unknown }>("ReadArtifactFile", previewToken);
      return { data: decodeArtifactBytes(result?.data) };
    },
    readLocalImage: async (filePath: string) => {
      const result = await rpc<{ data?: unknown; mime?: unknown }>("ReadLocalImage", filePath);
      return {
        data: decodeArtifactBytes(result?.data),
        mime: typeof result?.mime === "string" ? result.mime : "application/octet-stream",
      };
    },
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
    listChats: async () => normaliseConversationSummaries(await rpc<unknown>("ListChats")),
    listRecentFiles: async (workspaceId?: string) => normaliseRecentFiles(await rpc<unknown>("ListRecentFiles", workspaceId ?? "")),
    removeRecentFile: (filePath: string) => rpc<void>("RemoveRecentFile", filePath),
    renameWorkspace: async (workspaceId: string, name: string) => normaliseWorkspaceSummaries([await rpc<unknown>("RenameWorkspace", { workspaceId, name })])[0],
    openRecentFile: (file: RecentFile) => rpc<Artifact>("OpenRecentFile", file),
    deleteConversation: (conversationId: string) => rpc<void>("DeleteConversation", conversationId),
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
    return createRealE2EAPI(realE2EEndpoint);
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
