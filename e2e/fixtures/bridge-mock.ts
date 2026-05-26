import type { Page } from "@playwright/test";

/**
 * Wraps page.addInitScript to inject a window.officecli mock so the renderer's
 * bridge.ts selectAPI() picks it up (the dev server runs outside Wails, and
 * isWailsAvailable() is false there). The mock exposes a control surface on
 * window.__bridgeMock so tests can emit bridge events and inspect calls.
 *
 * Pass overrides for any DesktopAPI method to customise per-test behaviour.
 * Calls to mocked methods are recorded under window.__bridgeMock.calls keyed
 * by method name.
 */
export interface BridgeMockOptions {
  // initial settings returned by getSettings
  settings?: {
    onboardingCompletedAt?: string | null;
    documentType?: "pptx" | "docx" | "xlsx" | "report" | "img";
    mode?: "fast" | "best";
    runtimeMode?: "custom" | "hosted";
    outputDir?: string | null;
    bridgeBinaryPath?: string | null;
    llmProvider?: unknown;
  };
  whoami?: { mode: "anonymous" | "logged_in" | "api_key"; userId?: string; session?: string; expiresAt?: string };
  capabilities?: Record<string, unknown>;
  // openFileDialog and openMultiFileDialog default returns
  pickedFile?: string | null;
  pickedFiles?: string[] | null;
}

export async function installBridgeMock(page: Page, options: BridgeMockOptions = {}): Promise<void> {
  await page.addInitScript((opts: BridgeMockOptions) => {
    const settingsState: Record<string, unknown> = {
      version: 1,
      defaults: {
        documentType: opts.settings?.documentType ?? "pptx",
        mode: opts.settings?.mode ?? "fast",
        runtimeMode: opts.settings?.runtimeMode ?? "hosted",
        enableImages: true,
        imageQuality: "premium",
      },
      outputDir: opts.settings?.outputDir ?? null,
      bridgeBinaryPath: opts.settings?.bridgeBinaryPath ?? null,
      llmProvider: opts.settings?.llmProvider ?? null,
      onboardingCompletedAt: opts.settings?.onboardingCompletedAt ?? "2026-05-22T00:00:00.000Z",
    };

    const bridgeListeners: Array<(event: unknown) => void> = [];
    const authListeners: Array<(event: unknown) => void> = [];
    const calls: Record<string, unknown[][]> = {};
    const record = (name: string, args: unknown[]) => {
      calls[name] = calls[name] || [];
      calls[name].push(args);
    };

    const api: Record<string, (...args: unknown[]) => unknown> = {
      initialize: async (...args: unknown[]) => {
        record("initialize", args);
        return opts.capabilities ?? {};
      },
      getCapabilities: async (...args: unknown[]) => {
        record("getCapabilities", args);
        return opts.capabilities ?? {};
      },
      generate: async (...args: unknown[]) => {
        record("generate", args);
        return { taskId: "mock-task-1", sessionId: "mock-session-1", status: "starting" };
      },
      respond: async (...args: unknown[]) => {
        record("respond", args);
        return undefined;
      },
      cancel: async (...args: unknown[]) => {
        record("cancel", args);
        return undefined;
      },
      openPath: async (...args: unknown[]) => {
        record("openPath", args);
      },
      showItemInFolder: async (...args: unknown[]) => {
        record("showItemInFolder", args);
      },
      openExternal: async (...args: unknown[]) => {
        record("openExternal", args);
      },
      openFileDialog: async (...args: unknown[]) => {
        record("openFileDialog", args);
        return opts.pickedFile ?? null;
      },
      openDirectoryDialog: async (...args: unknown[]) => {
        record("openDirectoryDialog", args);
        return opts.pickedFile ?? null;
      },
      openMultiFileDialog: async (...args: unknown[]) => {
        record("openMultiFileDialog", args);
        return opts.pickedFiles ?? null;
      },
      savePastedImage: async (...args: unknown[]) => {
        record("savePastedImage", args);
        return "/tmp/pasted-mock.png";
      },
      previewArtifact: async (...args: unknown[]) => {
        record("previewArtifact", args);
      },
      issuePreviewToken: async (...args: unknown[]) => {
        record("issuePreviewToken", args);
        const artifact = args[0] as { fileName?: string; documentType?: string };
        return { token: "mock-preview-token", fileName: artifact?.fileName ?? "file", documentType: artifact?.documentType ?? "pptx" };
      },
      revokePreviewToken: async (...args: unknown[]) => {
        record("revokePreviewToken", args);
      },
      readArtifactFile: async (...args: unknown[]) => {
        record("readArtifactFile", args);
        return { data: new Uint8Array() };
      },
      readLocalImage: async (...args: unknown[]) => {
        record("readLocalImage", args);
        return { data: new Uint8Array(), mime: "image/png" };
      },
      renderPreviewHtml: async (...args: unknown[]) => {
        record("renderPreviewHtml", args);
        return { html: "<html><body>mock</body></html>" };
      },
      setPreviewMode: async (...args: unknown[]) => {
        record("setPreviewMode", args);
      },
      login: async (...args: unknown[]) => {
        record("login", args);
        return { url: "https://example.com/login" };
      },
      cancelLogin: async (...args: unknown[]) => {
        record("cancelLogin", args);
      },
      whoami: async (...args: unknown[]) => {
        record("whoami", args);
        return opts.whoami ?? { mode: "anonymous" };
      },
      logout: async (...args: unknown[]) => {
        record("logout", args);
      },
      getSettings: async (...args: unknown[]) => {
        record("getSettings", args);
        return settingsState;
      },
      updateSettings: async (...args: unknown[]) => {
        record("updateSettings", args);
        const patch = (args[0] ?? {}) as Record<string, unknown>;
        Object.assign(settingsState, patch);
        if (patch.defaults) {
          settingsState.defaults = { ...(settingsState.defaults as Record<string, unknown>), ...(patch.defaults as Record<string, unknown>) };
        }
        return settingsState;
      },
      getDefaultWorkspaceDir: async (...args: unknown[]) => {
        record("getDefaultWorkspaceDir", args);
        return "/tmp/mock-workspace";
      },
      onAuthEvent: (cb: (event: unknown) => void) => {
        authListeners.push(cb);
        return () => {
          const i = authListeners.indexOf(cb);
          if (i >= 0) authListeners.splice(i, 1);
        };
      },
      onBridgeEvent: (cb: (event: unknown) => void) => {
        bridgeListeners.push(cb);
        return () => {
          const i = bridgeListeners.indexOf(cb);
          if (i >= 0) bridgeListeners.splice(i, 1);
        };
      },
    };

    (window as unknown as { officecli: typeof api }).officecli = api;
    (window as unknown as { __bridgeMock: unknown }).__bridgeMock = {
      calls,
      settingsState,
      emitBridge: (event: unknown) => bridgeListeners.forEach((l) => l(event)),
      emitAuth: (event: unknown) => authListeners.forEach((l) => l(event)),
    };
  }, options);
}

export async function getBridgeCalls(page: Page, method: string): Promise<unknown[][]> {
  return await page.evaluate((m: string) => {
    const mock = (window as unknown as { __bridgeMock?: { calls: Record<string, unknown[][]> } }).__bridgeMock;
    return mock?.calls[m] ?? [];
  }, method);
}

export async function emitBridgeEvent(page: Page, event: Record<string, unknown>): Promise<void> {
  await page.evaluate((e: Record<string, unknown>) => {
    const mock = (window as unknown as { __bridgeMock?: { emitBridge: (event: Record<string, unknown>) => void } }).__bridgeMock;
    mock?.emitBridge(e);
  }, event);
}

export async function emitAuthEvent(page: Page, event: Record<string, unknown>): Promise<void> {
  await page.evaluate((e: Record<string, unknown>) => {
    const mock = (window as unknown as { __bridgeMock?: { emitAuth: (event: Record<string, unknown>) => void } }).__bridgeMock;
    mock?.emitAuth(e);
  }, event);
}
