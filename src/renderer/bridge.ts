import type {
  AppUpdateCheckResult,
  AppUpdateEvent,
  AppUpdateStatus,
  Artifact,
  AuthEvent,
  BinaryFileData,
  BridgeEvent,
  DesktopAPI,
  GenerateInput,
  LlmProvider,
  PreviewGrant,
  UserSettings,
  WhoAmIResult,
} from "../shared/types";

// The Wails-generated bindings live alongside the renderer; tsconfig must
// include them. Imports are static so the build picks them up; calls only
// fire when window.go is available.
import * as WailsApp from "./generated/wailsjs/go/main/App";
import { EventsOn } from "./generated/wailsjs/runtime";
import type { settings as settingsNS } from "./generated/wailsjs/go/models";

const DEFAULT_BROWSER_SETTINGS: UserSettings = {
  version: 1,
  defaults: {
    documentType: "pptx",
    mode: "fast",
    runtimeMode: "hosted",
    enableImages: true,
    imageQuality: "standard",
  },
  outputDir: null,
  bridgeBinaryPath: null,
  llmProvider: null,
  onboardingCompletedAt: null,
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
    renderPreviewHtml: async () => null,
    setPreviewMode: async () => undefined,
    login: async () => {
      throw new Error("Login is only available inside the desktop app.");
    },
    cancelLogin: async () => undefined,
    whoami: async () => ({ mode: "anonymous" }),
    logout: async () => undefined,
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

function uint8ArrayToBase64(data: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < data.length; i += chunk) {
    binary += String.fromCharCode(...data.subarray(i, i + chunk));
  }
  return btoa(binary);
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
    if (patch.defaults.runtimeMode !== undefined) d.runtimeMode = patch.defaults.runtimeMode;
    if (patch.defaults.enableImages !== undefined) d.enableImages = patch.defaults.enableImages;
    if (patch.defaults.imageQuality !== undefined) d.imageQuality = patch.defaults.imageQuality;
    out.defaults = d;
  }
  if (patch.outputDir !== undefined) {
    out.outputDir = patch.outputDir ?? "";
  }
  if (patch.bridgeBinaryPath !== undefined) {
    out.bridgeBinaryPath = patch.bridgeBinaryPath ?? "";
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
    bridgeBinaryPath: merged.bridgeBinaryPath ?? null,
    llmProvider: (merged.llmProvider ?? null) as LlmProvider | null,
    onboardingCompletedAt: merged.onboardingCompletedAt ?? null,
  };
}

function createWailsAPI(): DesktopAPI {
  return {
    initialize: async () => decodeRawBytes(await WailsApp.Initialize()),
    getCapabilities: async () => decodeRawBytes(await WailsApp.GetCapabilities()),
    generate: async (input: GenerateInput) => {
      const result = await WailsApp.Generate(input as never);
      return { taskId: result.taskId, sessionId: result.sessionId, status: result.status };
    },
    respond: async (input) => decodeRawBytes(await WailsApp.Respond(input as never)),
    cancel: async (taskId: string) => decodeRawBytes(await WailsApp.Cancel(taskId)),
    openPath: (filePath) => WailsApp.OpenPath(filePath),
    showItemInFolder: (filePath) => WailsApp.ShowItemInFolder(filePath),
    openExternal: (url) => WailsApp.OpenExternal(url),
    openFileDialog: async (options) => {
      const result = await WailsApp.OpenFileDialog((options ?? { filters: [] }) as never);
      return result ? result : null;
    },
    openMultiFileDialog: async (options) => {
      const result = await WailsApp.OpenMultiFileDialog((options ?? { filters: [] }) as never);
      return result && result.length > 0 ? result : null;
    },
    savePastedImage: async (data: Uint8Array, ext: string) => {
      return WailsApp.SavePastedImage({
        dataBase64: uint8ArrayToBase64(data),
        ext,
      } as never);
    },
    previewArtifact: (artifact: Artifact) => WailsApp.PreviewArtifact(artifact as never),
    issuePreviewToken: async (artifact: Artifact): Promise<PreviewGrant> =>
      WailsApp.IssuePreviewToken(artifact as never),
    revokePreviewToken: async (token: string) => {
      await WailsApp.RevokePreviewToken(token);
    },
    readArtifactFile: async (previewToken: string) => {
      const result = await WailsApp.ReadArtifactFile(previewToken);
      const bytes = (result?.data ?? []) as number[];
      const data: BinaryFileData = new Uint8Array(bytes);
      return { data };
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
        ...(result.session ? { session: result.session } : {}),
        ...(result.expiresAt ? { expiresAt: result.expiresAt } : {}),
      };
    },
    logout: () => WailsApp.Logout(),
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
  };
}

function normaliseAppUpdateCheckResult(raw: unknown): AppUpdateCheckResult {
  const value = (raw ?? {}) as Partial<AppUpdateCheckResult>;
  return {
    release: (value.release ?? null) as AppUpdateCheckResult["release"],
    status: normaliseAppUpdateStatus(value.status),
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
  // in a plain browser.
  if (typeof window !== "undefined" && (window as unknown as { officecli?: DesktopAPI }).officecli) {
    return (window as unknown as { officecli: DesktopAPI }).officecli;
  }
  return createBrowserPreviewAPI();
}

export const officecli: DesktopAPI = selectAPI();
