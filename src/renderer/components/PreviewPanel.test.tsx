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

  it("keeps the back and close controls outside the Wails window drag region", () => {
    const css = readFileSync("src/renderer/preview/PreviewApp.css", "utf8");

    expect(css).toMatch(/\.preview-panel-header\s*\{[^}]*--wails-draggable:\s*drag/s);
    expect(css).toMatch(
      /\.preview-panel-back,\s*\.preview-panel-close\s*\{[^}]*-webkit-app-region:\s*no-drag[^}]*--wails-draggable:\s*no-drag/s,
    );
  });

  it("uses the in-app dialog instead of window.confirm for unsaved changes", () => {
    const source = readFileSync("src/renderer/components/PreviewPanel.tsx", "utf8");

    expect(source).toContain("dialog.confirm({");
    expect(source).not.toContain("window.confirm(");
  });

  it.each([
    ["back", "Back to project tree"],
    ["close", "Close preview"],
  ])("slides the full preview overlay out to the left before closing from %s", async (_control, accessibleName) => {
    vi.useFakeTimers();
    const grant: PreviewGrant = {
      token: "preview-token-close",
      fileName: "deck.pptx",
      documentType: "pptx",
    };
    const onClose = vi.fn();
    render(<PreviewPanel grant={grant} onClose={onClose} />);

    fireEvent.click(screen.getByRole("button", { name: accessibleName }));

    expect(document.querySelector(".preview-panel-root.is-closing")).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(419);
    });
    expect(onClose).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
