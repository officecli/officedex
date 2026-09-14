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

  it("fades the preview overlay in where it stands, never sliding it in from off-column", () => {
    const css = readFileSync("src/renderer/styles/shell.css", "utf8");

    expect(css).toMatch(/animation:\s*preview-overlay-fade-in\s+180ms\s+ease/);
    expect(css).toMatch(/animation:\s*preview-overlay-fade-out\s+180ms\s+ease\s+forwards/);
    expect(css).toMatch(/@keyframes\s+preview-overlay-fade-in/);
    expect(css).toMatch(/@keyframes\s+preview-overlay-fade-out/);
    expect(css).toMatch(/\.preview-panel-root\.is-closing\s*\{/);
    // The assistant is the overlay's left edge now. A translate would carry its
    // heading and prompt off the window and read as a broken layout, not motion.
    expect(css).not.toMatch(/preview-overlay[^{]*\{[^}]*translateX/s);
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

  it.each(["pptx", "docx"])("does not add a duplicate ready notice below the %s workbench", (documentType) => {
    const grant: PreviewGrant = {
      token: "preview-token-footer",
      fileName: `document.${documentType}`,
      documentType,
    };
    const artifact = {
      filePath: `/tmp/document.${documentType}`,
      fileName: `document.${documentType}`,
      documentType,
    };

    render(<PreviewPanel grant={grant} artifact={artifact} onClose={vi.fn()} />);

    expect(screen.queryByRole("button", { name: "Back to workspace" })).toBeNull();
    expect(screen.queryByText("Document preview")).toBeNull();
    expect(document.querySelector(".preview-panel-footer")).toBeNull();
    expect(document.querySelector(".preview-ready-notice")).toBeNull();
    expect(screen.queryByRole("button", { name: "Open externally" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Replay generation" })).toBeNull();
  });


});
