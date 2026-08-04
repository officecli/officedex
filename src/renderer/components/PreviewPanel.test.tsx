import { readFileSync } from "node:fs";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PreviewGrant } from "../../shared/types";

const viewerMocks = vi.hoisted(() => ({
  onDirtyChange: undefined as ((dirty: boolean) => void) | undefined,
}));

vi.mock("../preview/viewers/previewViewers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../preview/viewers/previewViewers")>();
  const React = await import("react");
  return {
    ...actual,
    XlsxViewer: React.lazy(async () => ({
      default: (props: { onDirtyChange?: (dirty: boolean) => void }) => {
        viewerMocks.onDirtyChange = props.onDirtyChange;
        return React.createElement("div", null, "XLSX test viewer");
      },
    })),
  };
});

import { PreviewPanel } from "./PreviewPanel";

beforeEach(() => {
  viewerMocks.onDirtyChange = undefined;
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

  it.each([
    ["back", "Back to project tree"],
    ["close", "Close preview"],
  ])("keeps a dirty xlsx open when %s confirmation is cancelled", async (_control, accessibleName) => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const onClose = vi.fn();
    render(<PreviewPanel grant={{
      token: "preview-token-dirty",
      fileName: "budget.xlsx",
      documentType: "xlsx",
    }} onClose={onClose} />);
    await screen.findByText("XLSX test viewer");
    act(() => viewerMocks.onDirtyChange?.(true));

    fireEvent.click(screen.getByRole("button", { name: accessibleName }));

    expect(confirm).toHaveBeenCalledWith("This spreadsheet has unsaved changes. Close it without saving?");
    expect(document.querySelector(".preview-panel-root.is-closing")).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("closes a dirty xlsx after confirmation", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const onClose = vi.fn();
    render(<PreviewPanel grant={{
      token: "preview-token-dirty-confirmed",
      fileName: "budget.xlsx",
      documentType: "xlsx",
    }} onClose={onClose} />);
    await screen.findByText("XLSX test viewer");
    act(() => viewerMocks.onDirtyChange?.(true));
    vi.useFakeTimers();

    fireEvent.click(screen.getByRole("button", { name: "Close preview" }));
    expect(document.querySelector(".preview-panel-root.is-closing")).toBeTruthy();

    await act(async () => vi.advanceTimersByTime(420));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
