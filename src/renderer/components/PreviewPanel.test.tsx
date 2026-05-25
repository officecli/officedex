import { cleanup, render, screen } from "@testing-library/react";
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
    // OfficeHtmlViewer is lazy-loaded; the Suspense fallback (LoadingState)
    // renders "Rendering {fileName}…" synchronously before the dynamic import
    // resolves.
    expect(screen.getByText(/Rendering deck\.pptx/i)).toBeTruthy();
  });
});
