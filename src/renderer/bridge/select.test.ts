import { describe, expect, it } from "vitest";
import type { DesktopAPI } from "../../shared/types";
import { createDesktopAPI, type BridgeEnvironment, type BridgeFactories } from "./select";

const api = (name: string) => ({ name }) as unknown as DesktopAPI;
const factories: BridgeFactories = {
  wails: () => api("wails"),
  realE2E: (endpoint) => api(`e2e:${endpoint}`),
  browserPreview: () => api("browser"),
};
const env = (overrides: Partial<BridgeEnvironment>): BridgeEnvironment => ({
  wailsAvailable: false, dev: false, mode: "production", realE2EEndpoint: "", ...overrides,
});
const pick = (overrides: Partial<BridgeEnvironment>) => (createDesktopAPI(env(overrides), factories) as unknown as { name: string }).name;

describe("createDesktopAPI", () => {
  it("always takes Wails when the Go app is present, whatever else is set", () => {
    expect(pick({ wailsAvailable: true, dev: true, realE2EEndpoint: "http://x", mode: "test", injected: api("injected") })).toBe("wails");
  });

  it("uses the real E2E transport over the Vite proxy only in dev with an endpoint configured", () => {
    expect(pick({ dev: true, realE2EEndpoint: "http://127.0.0.1:1" })).toBe("e2e:/__officedex_bridge");
    expect(pick({ dev: false, realE2EEndpoint: "http://127.0.0.1:1" })).toBe("browser");
    expect(pick({ dev: true, realE2EEndpoint: "" })).toBe("browser");
  });

  it("honours a window-injected API only under the test mode", () => {
    expect(pick({ mode: "test", injected: api("injected") })).toBe("injected");
    expect(pick({ mode: "development", injected: api("injected") })).toBe("browser");
  });

  it("falls back to the browser preview stand-in", () => {
    expect(pick({})).toBe("browser");
  });
});
