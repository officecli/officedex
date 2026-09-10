import { readFileSync } from "node:fs";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PreviewGrant } from "../../shared/types";
import { PreviewPanel } from "./PreviewPanel";

beforeEach(() => {
  if (!window.matchMedia) {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
  }
  vi.spyOn(window, "getComputedStyle").mockImplementation(
    () => ({ getPropertyValue: () => "" }) as unknown as CSSStyleDeclaration,
  );
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("PreviewPanel", () => {
  it("renders UnsupportedViewer for unknown documentType", () => {
    const grant: PreviewGrant = {
      token: "preview-token-1",
      fileName: "exotic.bin",
      documentType: "bin",
    };
    render(<PreviewPanel grant={grant} onClose={vi.fn()} />);
    expect(screen.getByText(/format not supported for preview/i)).toBeTruthy();
    expect(screen.getByText(/exotic\.bin/)).toBeTruthy();
  });

  it("shows Suspense loading state while a lazy viewer is loading", () => {
    const grant: PreviewGrant = {
      token: "preview-token-2",
      fileName: "deck.pptx",
      documentType: "pptx",
    };
    render(<PreviewPanel grant={grant} onClose={vi.fn()} />);
    // PptxViewer is lazy-loaded; the Suspense fallback (LoadingState)
    // renders "Rendering {fileName}…" synchronously before the dynamic import
    // resolves.
    expect(screen.getByText(/Rendering deck\.pptx/i)).toBeTruthy();
  });

  it("slides the full preview overlay in from the left", () => {
    const css = readFileSync("src/renderer/styles/shell.css", "utf8");

    expect(css).toMatch(/animation:\s*preview-overlay-slide-in\s+420ms\s+cubic-bezier\(0\.22,\s*1,\s*0\.36,\s*1\)/);
    expect(css).toMatch(/@keyframes\s+preview-overlay-slide-in/);
    expect(css).toMatch(/@keyframes\s+preview-overlay-slide-out/);
    expect(css).toMatch(/\.preview-panel-root\.is-closing\s*\{/);
    expect(css).toMatch(/transform:\s*translateX\(-100%\)/);
    expect(css).toMatch(/transform:\s*translateX\(0\)/);
  });

  it("does not render the removed preview header chrome", () => {
    const css = readFileSync("src/renderer/preview/PreviewApp.css", "utf8");

    expect(css).not.toMatch(/\.preview-panel-header\s*\{/);
  });

  it("uses the in-app dialog instead of window.confirm for unsaved changes", () => {
    const source = readFileSync("src/renderer/components/PreviewPanel.tsx", "utf8");

    expect(source).toContain("dialog.confirm({");
    expect(source).not.toContain("window.confirm(");
  });

  it("keeps the folder action without showing an external-open action", () => {
    const grant: PreviewGrant = {
      token: "preview-token-footer",
      fileName: "deck.pptx",
      documentType: "pptx",
    };
    const artifact = {
      filePath: "/tmp/deck.pptx",
      fileName: "deck.pptx",
      documentType: "pptx",
    };

    render(<PreviewPanel grant={grant} artifact={artifact} onClose={vi.fn()} />);

    expect(screen.queryByRole("button", { name: "Back to workspace" })).toBeNull();
    expect(screen.queryByText("Document preview")).toBeNull();
    expect(document.querySelector(".preview-panel-footer")).toBeNull();
    expect(screen.getByRole("button", { name: "Show in folder" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Open externally" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Replay generation" })).toBeNull();
  });


});
