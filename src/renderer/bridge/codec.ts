// Shapes crossing the Go/TS boundary: byte decoding, request serialisation,
// and the normalisers that turn whatever the bridge sent into the renderer
// types. Shared by the Wails, browser-preview and real-E2E transports.
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

export const DEFAULT_BROWSER_SETTINGS: UserSettings = {
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

export function stampOriginClientId(input: AgentRunStartInput): AgentRunStartInput {
  if (input.metadata?.origin_client_id) return input;
  return {
    ...input,
    metadata: { ...(input.metadata ?? {}), origin_client_id: agentClientId() },
  };
}

export function decodeRawBytes(bytes: number[] | null | undefined): unknown {
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
export function serializeStageXlsxEditorImageInput(input: StageXlsxEditorImageInput) {
  const { data, ...rest } = input;
  return data === undefined ? rest : { ...rest, dataBase64: uint8ArrayToBase64(data) };
}

export function normalizeLocalTextDocuments(raw: unknown): LocalTextDocument[] {
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

export function decodeArtifactBytes(raw: unknown): Uint8Array {
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

export function serializeSavePptxEditorSnapshotInput(input: SavePptxEditorSnapshotInput) {
  const { content, ...rest } = input;
  return { ...rest, contentBase64: uint8ArrayToBase64(content) };
}

export function serializeSavePptxEditorAssetInput(input: SavePptxEditorAssetInput) {
  const { data, contentType, ...rest } = input;
  return { ...rest, contentType: contentType ?? "", dataBase64: uint8ArrayToBase64(data) };
}

/** Go sends []byte as base64; hand the renderer real bytes instead. */

export function decodePreparePptxEditorResult(raw: PreparePptxEditorResult): PreparePptxEditorResult {
  return {
    ...raw,
    content: decodeArtifactBytes(raw.content),
    assets: (raw.assets ?? []).map((asset) => ({ ...asset, data: decodeArtifactBytes(asset.data) })),
  };
}

export function uint8ArrayToBase64(data: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < data.length; i += chunk) {
    binary += String.fromCharCode(...data.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function normaliseCreditStatus(raw: Partial<CreditStatus> | null | undefined): CreditStatus {
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

export function adaptSettingsPatch(patch: Partial<UserSettings>): settingsNS.Patch {
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

export function normaliseUserSettings(raw: unknown): UserSettings {
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

export function normaliseTaskHistory(raw: unknown): TaskHistoryEntry[] {
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

export function normaliseWorkspaceSummaries(raw: unknown): WorkspaceSummary[] {
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

export function normaliseAppUpdateStatus(raw: unknown): AppUpdateStatus {
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

export function normaliseAppUpdateCheckResult(raw: unknown): AppUpdateCheckResult {
  const value = (raw ?? {}) as Partial<AppUpdateCheckResult>;
  return {
    release: (value.release ?? null) as AppUpdateCheckResult["release"],
    status: normaliseAppUpdateStatus(value.status),
  };
}

export function normaliseBridgeRuntimeSnapshot(raw: Partial<BridgeRuntimeSnapshot> | null | undefined): BridgeRuntimeSnapshot {
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

export function normaliseProviderSnapshot(raw: Partial<ProviderSnapshot> | null | undefined): ProviderSnapshot | null {
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
