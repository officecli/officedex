import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OfficeWorkbenchLayout } from "./OfficeWorkbenchLayout";

afterEach(() => cleanup());

function renderLayout(props: Partial<Parameters<typeof OfficeWorkbenchLayout>[0]> = {}) {
  return render(
    <OfficeWorkbenchLayout documentType="pptx" fileName="deck.pptx" {...props}>
      <div data-testid="stage">editor</div>
    </OfficeWorkbenchLayout>,
  );
}

describe("OfficeWorkbenchLayout", () => {
  it("names the document once, in the title bar, with its format badge", () => {
    renderLayout({ saveState: "dirty" });

    expect(screen.getByText("deck.pptx")).toBeInTheDocument();
    expect(screen.getByText("PPT")).toBeInTheDocument();
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
    expect(screen.getByTestId("stage")).toBeInTheDocument();
  });

  it("omits the status bar when no surface claims it", () => {
    const { container } = renderLayout();

    expect(container.querySelector(".wb-statusbar")).toBeNull();
  });

  it("shows the zoom cluster in the status bar and reports both directions", () => {
    const onZoomIn = vi.fn();
    const onZoomOut = vi.fn();
    renderLayout({ zoom: { value: 0.9, onZoomIn, onZoomOut } });

    expect(screen.getByText("90%")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    fireEvent.click(screen.getByRole("button", { name: "Zoom out" }));
    expect(onZoomIn).toHaveBeenCalledTimes(1);
    expect(onZoomOut).toHaveBeenCalledTimes(1);
  });

  it("renders no panel — and no panel toggle — when a surface has no assistant", () => {
    const { container } = renderLayout();

    expect(container.querySelector(".wb-panel")).toBeNull();
    expect(screen.queryByRole("button", { name: /AI assistant/i })).toBeNull();
  });

  it("toggles its own panel when the caller does not control it", () => {
    const { container } = renderLayout({
      panel: { title: "Edit with AI", children: <div>transcript</div> },
    });

    expect(container.querySelector(".wb-panel")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Hide AI assistant" }));
    expect(container.querySelector(".wb-panel")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show AI assistant" }));
    expect(container.querySelector(".wb-panel")).not.toBeNull();
  });

  it("leaves the panel state to the caller when it is controlled", () => {
    const onPanelOpenChange = vi.fn();
    const { container } = renderLayout({
      panel: { title: "Edit with AI", children: <div>transcript</div> },
      panelOpen: true,
      onPanelOpenChange,
    });

    fireEvent.click(screen.getByRole("button", { name: "Hide AI assistant" }));
    expect(onPanelOpenChange).toHaveBeenCalledWith(false);
    // Still open: the caller owns the state and has not changed it.
    expect(container.querySelector(".wb-panel")).not.toBeNull();
  });

  it("puts the target and selection scope in the panel header, above the caller's content", () => {
    renderLayout({
      panel: {
        title: "Edit with AI",
        target: "Edits are saved to deck.pptx",
        scope: "Selected: 1 slide(s)",
        onRefreshScope: vi.fn(),
        children: <div>transcript</div>,
      },
    });

    const panel = screen.getByRole("complementary", { name: "Edit with AI" });
    expect(panel).toHaveTextContent("Edits are saved to deck.pptx");
    expect(panel).toHaveTextContent("Selected: 1 slide(s)");
    expect(screen.getByRole("button", { name: "Refresh selection" })).toBeInTheDocument();
  });

  it("wires the title bar's back and save controls", () => {
    const onBack = vi.fn();
    const onSave = vi.fn();
    renderLayout({ onBack, onSave, backLabel: "Close preview", saveState: "dirty" });

    fireEvent.click(screen.getByRole("button", { name: "Close preview" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it("does not offer save while a save is already running", () => {
    const onSave = vi.fn();
    renderLayout({ onSave, saveState: "saving" });

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).not.toHaveBeenCalled();
  });
});
