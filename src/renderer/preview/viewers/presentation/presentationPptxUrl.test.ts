import { afterEach, describe, expect, it, vi } from "vitest";
import { EMBEDDED_PRESENTATION_PATH, PRESENTATION_EDITOR_URL_STORAGE_KEY, resolvePresentationEditorBaseUrl } from "./presentationPptxUrl";

afterEach(() => {
  vi.unstubAllEnvs();
  window.localStorage.clear();
});

describe("resolvePresentationEditorBaseUrl", () => {
  it("defaults to the editor embedded in the app's own assets", () => {
    vi.stubEnv("DEV", false);
    vi.stubEnv("VITE_PRESENTATION_EDITOR_URL", "");
    // A packaged build has no sibling Vite server: pointing at 127.0.0.1:4178 by
    // default made the workbench wait 30s and fall back to the read-only preview.
    expect(resolvePresentationEditorBaseUrl()).toBe(EMBEDDED_PRESENTATION_PATH);
  });

  it("prefers an explicitly configured editor URL", () => {
    vi.stubEnv("DEV", false);
    vi.stubEnv("VITE_PRESENTATION_EDITOR_URL", " http://127.0.0.1:4178/ ");
    expect(resolvePresentationEditorBaseUrl()).toBe("http://127.0.0.1:4178/");
  });

  it("lets a dev build retarget the editor through localStorage", () => {
    vi.stubEnv("DEV", true);
    vi.stubEnv("VITE_PRESENTATION_EDITOR_URL", "http://127.0.0.1:4178/");
    window.localStorage.setItem(PRESENTATION_EDITOR_URL_STORAGE_KEY, "http://127.0.0.1:5199/");
    expect(resolvePresentationEditorBaseUrl()).toBe("http://127.0.0.1:5199/");
  });

  it("reports not-configured for an unconfigured dev build", () => {
    vi.stubEnv("DEV", true);
    vi.stubEnv("VITE_PRESENTATION_EDITOR_URL", "");
    expect(resolvePresentationEditorBaseUrl()).toBe(EMBEDDED_PRESENTATION_PATH);
  });

  it("ignores the localStorage override outside development", () => {
    vi.stubEnv("DEV", false);
    vi.stubEnv("VITE_PRESENTATION_EDITOR_URL", "");
    window.localStorage.setItem(PRESENTATION_EDITOR_URL_STORAGE_KEY, "http://127.0.0.1:5199/");
    expect(resolvePresentationEditorBaseUrl()).toBe(EMBEDDED_PRESENTATION_PATH);
  });
});
