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
  DesktopAPI,
  GenerateInput,
  LlmProvider,
  PeekReportContextResult,
  PreviewGrant,
  ProviderTestInput,
  ProviderSnapshot,
  ProviderTestResult,
  RedeemResult,
  ReportCapabilityResult,
  SubmitReportInput,
  SubmitReportResult,
  TaskHistoryEntry,
  UserSettings,
  WhoAmIResult,
} from "../shared/types";
import { defaultProxySettings } from "./defaults";

// The Wails-generated bindings live alongside the renderer; tsconfig must
// include them. Imports are static so the build picks them up; calls only
// fire when window.go is available.
import * as WailsApp from "./generated/wailsjs/go/main/App";
import { EventsOn } from "./generated/wailsjs/runtime";
import type { settings as settingsNS } from "./generated/wailsjs/go/models";

// toWails coerces a renderer-side typed value into the `never`-shaped argument
// that the Wails-generated bindings expect. The generated d.ts files describe
// arg types as `never` (the Wails codegen quirk), so every call site would
// otherwise sprout an `as never`; concentrating that cast here makes the
// suppression auditable and keeps call sites readable.
function toWails<T>(value: T): never {
  return value as unknown as never;
}

const DEFAULT_BROWSER_SETTINGS: UserSettings = {
  version: 1,
  defaults: {
    documentType: "pptx",
    mode: "fast",
    enableImages: true,
    imageQuality: "standard",
  },
  outputDir: null,
  llmProvider: null,
  onboardingCompletedAt: null,
  proxy: { ...defaultProxySettings },
};

function createBrowserPreviewAPI(): DesktopAPI {
  let browserSettings: UserSettings = {
    ...DEFAULT_BROWSER_SETTINGS,
    defaults: { ...DEFAULT_BROWSER_SETTINGS.defaults },
  };
  return {
    initialize: async () => ({ browserPreview: true }),
    getCapabilities: async () => ({ browserPreview: true }),
    generate: async () => {
      throw new Error("Bridge IPC is only available inside the desktop app.");
    },
    respond: async () => undefined,
    cancel: async () => undefined,
    openPath: async () => undefined,
    showItemInFolder: async () => undefined,
    openExternal: async (url: string) => {
      window.open(url, "_blank", "noopener,noreferrer");
    },
    openFileDialog: async () => null,
    openDirectoryDialog: async () => null,
    openMultiFileDialog: async () => null,
    savePastedImage: async () => {
      throw new Error("Saving pasted images requires desktop file access.");
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
    readArtifactFile: async () => {
      throw new Error("Artifact file reading requires desktop file access.");
    },
    readLocalImage: async () => {
      throw new Error("Local image reading requires desktop file access.");
    },
    renderPreviewHtml: async () => null,
    setPreviewMode: async () => undefined,
    login: async () => {
      throw new Error("Login is only available inside the desktop app.");
    },
    cancelLogin: async () => undefined,
    whoami: async () => ({ mode: "anonymous" }),
    logout: async () => undefined,
    getCreditStatus: async () => normaliseCreditStatus(null),
    redeem: async () => {
      throw new Error("Redemption is only available inside the desktop app.");
    },
    getSettings: async () => browserSettings,
    updateSettings: async (patch) => {
      browserSettings = {
        ...browserSettings,
        ...patch,
        defaults: { ...browserSettings.defaults, ...(patch.defaults ?? {}) },
      };
      return browserSettings;
    },
    getDefaultWorkspaceDir: async () => "(default workspace inside desktop app)",
    onAuthEvent: () => () => undefined,
    onBridgeEvent: () => () => undefined,
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
    if (patch.defaults.mode !== undefined) d.mode = patch.defaults.mode;
    if (patch.defaults.enableImages !== undefined) d.enableImages = patch.defaults.enableImages;
    if (patch.defaults.imageQuality !== undefined) d.imageQuality = patch.defaults.imageQuality;
    out.defaults = d;
  }
  if (patch.outputDir !== undefined) {
    out.outputDir = patch.outputDir ?? "";
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
  return out as unknown as settingsNS.Patch;
}

function normaliseUserSettings(raw: unknown): UserSettings {
  // Wails populates absent optional fields as undefined; the renderer's
  // DesktopAPI expects `string | null`. Coerce here so downstream code can
  // continue to rely on the existing null sentinel.
  const merged = (raw as UserSettings) ?? DEFAULT_BROWSER_SETTINGS;
  return {
    ...merged,
    outputDir: merged.outputDir ?? null,
    llmProvider: (merged.llmProvider ?? null) as LlmProvider | null,
    onboardingCompletedAt: merged.onboardingCompletedAt ?? null,
    proxy: merged.proxy ?? { ...defaultProxySettings },
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
    entries.push({ taskId, events });
  }
  return entries;
}

function createWailsAPI(): DesktopAPI {
  return {
    initialize: async () => decodeRawBytes(await WailsApp.Initialize()),
    getCapabilities: async () => decodeRawBytes(await WailsApp.GetCapabilities()),
    generate: async (input: GenerateInput) => {
      const result = await WailsApp.Generate(toWails(input));
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
    previewArtifact: (artifact: Artifact) => WailsApp.PreviewArtifact(toWails(artifact)),
    issuePreviewToken: async (artifact: Artifact): Promise<PreviewGrant> =>
      WailsApp.IssuePreviewToken(toWails(artifact)),
    revokePreviewToken: async (token: string) => {
      await WailsApp.RevokePreviewToken(token);
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
    renderPreviewHtml: async (previewToken: string) => {
      const result = await WailsApp.RenderPreviewHtml(previewToken);
      if (!result || typeof result.html !== "string") {
        return null;
      }
      return { html: result.html };
    },
    setPreviewMode: (active: boolean) => WailsApp.SetPreviewMode(active),
    login: async () => WailsApp.Login(),
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
    onAuthEvent: (callback: (event: AuthEvent) => void) =>
      EventsOn("auth:event", (payload: unknown) => callback(payload as AuthEvent)),
    onBridgeEvent: (callback: (event: BridgeEvent) => void) =>
      EventsOn("bridge:event", (payload: unknown) => callback(payload as BridgeEvent)),
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
  // window.officecli is the test-only injection point used by App.test.tsx
  // and the renderer vitest fixtures. Production desktop builds always go
  // through Wails above; the browser-preview fallback covers `npm run dev`
  // in a plain browser. The import.meta.env.MODE === 'test' guard lets
  // Vite's dead-code elimination drop this branch from production bundles.
  if (
    import.meta.env.MODE === "test" &&
    typeof window !== "undefined" &&
    (window as unknown as { officecli?: DesktopAPI }).officecli
  ) {
    return (window as unknown as { officecli: DesktopAPI }).officecli;
  }
  return createBrowserPreviewAPI();
}

export const officecli: DesktopAPI = selectAPI();
