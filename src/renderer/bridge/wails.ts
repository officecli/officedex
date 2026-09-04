// The production transport: the Wails-generated bindings over the Go App.
import type { AppUpdateEvent, Artifact, AgentClientToolReassignInput, AgentClientToolResultInput, AgentRun, AgentRunApproveInput, AgentRunRespondInput, AgentRunStartInput, ArtifactStageRuntimeInput, AuthEvent, BinaryFileData, BridgeEvent, BridgeRuntimeSnapshot, CreditStatus, CreateImageTemplatePublishRequestInput, CreateUserImageTemplateInput, DesktopAPI, GenerateInput, ImageTemplatePublishRequest, ImagePromptTemplate, InviteInfo, LoginInput, PlanPptxJSResult, ModifyInput, PeekReportContextResult, CreateWorkbookFromSheetInput, DrawingAsset, CaptureTimelineNodeInput, TimelineCapturedNode, PreparePptxEditorResult, SavePptxEditorSnapshotInput, SavePptxEditorAssetInput, ExportPptxEditorInput, ClosePptxEditorInput, PptxEditorSaveResult, PptxEditorSaveAssetResult, PrepareXlsxEditorResult, PreviewGrant, ProviderTestInput, ProviderTestResult, RedeemResult, RecentFile, ReportCapabilityResult, RendererLogInput, CloseXlsxEditorInput, SpreadsheetPlanFieldsResult, SaveDocxResult, SaveXlsxEditorInput, StageXlsxEditorImageInput, SaveXlsxEditorResult, SubmitReportInput, SubmitReportResult, TaskHistoryEntry, UserSettings, WhoAmIResult } from "../../shared/types";
import type { JiraConnectionSummary, JiraProbeResult, LiquipediaConnectionSummary, LiquipediaProbeResult, MarketingCampaignPlanResult, CampaignImageResult } from "../../shared/verticals";
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

function toWails<T>(value: T): never {
  return value as unknown as never;
}


function optionalWailsFunction<T extends (...args: never[]) => unknown>(name: string): T | undefined {
  return (WailsApp as unknown as Record<string, unknown>)[name] as T | undefined;
}

export function createWailsAPI(): DesktopAPI {
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
    exportLogs: (input?: import("../../shared/types").ExportLogsInput) =>
      WailsApp.ExportLogs(toWails(input ?? {})) as Promise<{ path: string; manifest: import("../../shared/types").BundleManifest }>,
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
