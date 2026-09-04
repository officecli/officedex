// Transport selection for the renderer. The choice used to be inline next to
// 1300 lines of transports; here it is a function of an explicit environment.

import type { DesktopAPI } from "../../shared/types";
import { createBrowserPreviewAPI } from "./browserPreview";
import { createRealE2EAPI } from "./realE2E";
import { createWailsAPI } from "./wails";

function isWailsAvailable(): boolean {
  if (typeof window === "undefined") return false;
  const go = (window as unknown as { go?: { main?: { App?: unknown } } }).go;
  return Boolean(go?.main?.App);
}

/** What the factory reads to pick a transport; read from the page in production, given in tests. */
export interface BridgeEnvironment {
  wailsAvailable: boolean;
  dev: boolean;
  mode: string;
  realE2EEndpoint: string;
  injected?: DesktopAPI;
}

export interface BridgeFactories {
  wails: () => DesktopAPI;
  realE2E: (endpoint: string) => DesktopAPI;
  browserPreview: () => DesktopAPI;
}

const defaultFactories: BridgeFactories = { wails: createWailsAPI, realE2E: createRealE2EAPI, browserPreview: createBrowserPreviewAPI };

export function readBridgeEnvironment(): BridgeEnvironment {
  const endpoint = import.meta.env.VITE_OFFICEDEX_REAL_E2E_ENDPOINT;
  return {
    wailsAvailable: isWailsAvailable(),
    dev: Boolean(import.meta.env.DEV),
    mode: import.meta.env.MODE,
    realE2EEndpoint: typeof endpoint === "string" ? endpoint.trim() : "",
    injected: typeof window !== "undefined"
      ? ((window as unknown as Record<string, unknown>)["officecli"] as DesktopAPI | undefined)
      : undefined,
  };
}

/**
 * Picks the transport: Wails when the Go app is present; the real-E2E RPC
 * transport in dev when an endpoint is configured; a test-injected API under
 * Vitest; otherwise the browser preview stand-in.
 */
export function createDesktopAPI(env: BridgeEnvironment, factories: BridgeFactories = defaultFactories): DesktopAPI {
  if (env.wailsAvailable) {
    return factories.wails();
  }
  if (env.dev && env.realE2EEndpoint) {
    // Keep browser RPC/SSE on the Vite origin. Besides avoiding CORS, this
    // isolates new tabs from stale direct bridge connections left by older
    // dev pages and lets Vite proxy the managed bridge endpoint consistently.
    return factories.realE2E("/__officedex_bridge");
  }
  // Test-only injection is kept for Vitest. Dev-browser E2E uses the real
  // endpoint transport above; production desktop builds always go through Wails.
  if (env.injected && env.mode === "test") {
    return env.injected;
  }
  return factories.browserPreview();
}
