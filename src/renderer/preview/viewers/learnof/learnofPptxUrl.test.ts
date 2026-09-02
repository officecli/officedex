import { afterEach, describe, expect, it, vi } from "vitest";
import { EMBEDDED_LEARNOF_PPTX_PATH, LEARNOF_PPTX_URL_STORAGE_KEY, resolveLearnofPptxBaseUrl } from "./learnofPptxUrl";

afterEach(() => {
  vi.unstubAllEnvs();
  window.localStorage.clear();
});

describe("resolveLearnofPptxBaseUrl", () => {
  it("defaults to the editor embedded in the app's own assets", () => {
    vi.stubEnv("DEV", false);
    vi.stubEnv("VITE_LEARNOF_PPTX_URL", "");
    // A packaged build has no sibling Vite server: pointing at 127.0.0.1:4178 by
    // default made the workbench wait 30s and fall back to the read-only preview.
    expect(resolveLearnofPptxBaseUrl()).toBe(EMBEDDED_LEARNOF_PPTX_PATH);
  });

  it("prefers an explicitly configured editor URL", () => {
    vi.stubEnv("DEV", false);
    vi.stubEnv("VITE_LEARNOF_PPTX_URL", " http://127.0.0.1:4178/ ");
    expect(resolveLearnofPptxBaseUrl()).toBe("http://127.0.0.1:4178/");
  });

  it("lets a dev build retarget the editor through localStorage", () => {
    vi.stubEnv("DEV", true);
    vi.stubEnv("VITE_LEARNOF_PPTX_URL", "http://127.0.0.1:4178/");
    window.localStorage.setItem(LEARNOF_PPTX_URL_STORAGE_KEY, "http://127.0.0.1:5199/");
    expect(resolveLearnofPptxBaseUrl()).toBe("http://127.0.0.1:5199/");
  });

  it("reports not-configured for an unconfigured dev build", () => {
    vi.stubEnv("DEV", true);
    vi.stubEnv("VITE_LEARNOF_PPTX_URL", "");
    // The Vite dev server serves the app from source and has no /pptx/ route.
    expect(resolveLearnofPptxBaseUrl()).toBeNull();
  });

  it("ignores the localStorage override outside development", () => {
    vi.stubEnv("DEV", false);
    vi.stubEnv("VITE_LEARNOF_PPTX_URL", "");
    window.localStorage.setItem(LEARNOF_PPTX_URL_STORAGE_KEY, "http://127.0.0.1:5199/");
    expect(resolveLearnofPptxBaseUrl()).toBe(EMBEDDED_LEARNOF_PPTX_PATH);
  });
});
