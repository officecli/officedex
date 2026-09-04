// The dev-browser E2E transport: JSON RPC + SSE to a real officedex process
// behind the Vite proxy.
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
import { stampOriginClientId } from "./codec";

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
    exportLogs: (input?: import("../../shared/types").ExportLogsInput) =>
      rpc<{ path: string; manifest: import("../../shared/types").BundleManifest }>("ExportLogs", input ?? {}),
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
