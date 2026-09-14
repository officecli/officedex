import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OfficeWorkbenchLayout, pinFrameToOrigin } from "./OfficeWorkbenchLayout";

afterEach(() => cleanup());

function renderLayout(props: Partial<Parameters<typeof OfficeWorkbenchLayout>[0]> = {}) {
  return render(
    <OfficeWorkbenchLayout documentType="pptx" fileName="deck.pptx" {...props}>
      <div data-testid="stage">editor</div>
    </OfficeWorkbenchLayout>,
  );
}

describe("OfficeWorkbenchLayout", () => {
  it("animates document changes without replacing the editor DOM", () => {
    const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "animate");
    const cancel = vi.fn();
    const animate = vi.fn(() => ({ cancel }));
    Object.defineProperty(HTMLElement.prototype, "animate", { configurable: true, value: animate });
    try {
      const { rerender, unmount } = renderLayout();
      const editor = screen.getByTestId("stage");
      expect(animate).toHaveBeenCalledTimes(1);
      rerender(<OfficeWorkbenchLayout documentType="pptx" fileName="next.pptx"><div data-testid="stage">editor</div></OfficeWorkbenchLayout>);
      expect(screen.getByTestId("stage")).toBe(editor);
      expect(animate).toHaveBeenCalledTimes(2);
      expect(cancel).toHaveBeenCalledTimes(1);
      unmount();
      expect(cancel).toHaveBeenCalledTimes(2);
    } finally {
      if (original) Object.defineProperty(HTMLElement.prototype, "animate", original);
      else Reflect.deleteProperty(HTMLElement.prototype, "animate");
    }
  });

  it("names the document once, in the title bar, with the shared format icon", () => {
    const { container } = renderLayout({ saveState: "dirty" });

    expect(screen.getByText("deck.pptx")).toBeInTheDocument();
    // The format is drawn by DocTypeIcon — the one tinted line icon every file
    // list in the app uses — rather than a text badge of the workbench's own.
    expect(container.querySelector(".wb-titlebar__doc .doc-type--pptx")).not.toBeNull();
    expect(screen.queryByText("PPT")).toBeNull();
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
    const toggle = screen.getByRole("button", { name: "Hide AI assistant" });
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(toggle.textContent).toBe("");
    expect(toggle.getAttribute("aria-controls")).toBe(container.querySelector(".wb-panel")?.id);
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(toggle.textContent).toBe("");
    expect(container.querySelector(".wb-panel")?.getAttribute("aria-hidden")).toBe("true");
    expect(container.querySelector(".wb-panel")?.hasAttribute("inert")).toBe(true);
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

  it("draws no rail toggle when the surface has no rail", () => {
    const { container } = renderLayout({ onBack: vi.fn() });

    expect(container.querySelector(".wb-rail")).toBeNull();
    expect(screen.queryByRole("button", { name: "Show file list" })).toBeNull();
    // No rail means the back button stays where it was.
    expect(screen.getByRole("button", { name: "Back" })).toBeInTheDocument();
  });

  it("toggles its own rail, and hands the way back to the rail once it is open", () => {
    const { container } = renderLayout({
      onBack: vi.fn(),
      rail: { label: "Files", children: <div>deck.pptx</div> },
    });

    expect(container.querySelector(".wb-rail")).toBeNull();
    expect(screen.getByRole("button", { name: "Back" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Show file list" }));
    expect(container.querySelector(".wb-rail")).toHaveTextContent("deck.pptx");
    // Exactly one control per trip: the rail carries the way out now.
    expect(screen.queryByRole("button", { name: "Back" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Hide file list" }));
    expect(container.querySelector(".wb-rail")).toBeNull();
    expect(screen.getByRole("button", { name: "Back" })).toBeInTheDocument();
  });

  it("keeps only one drawer open at a time", () => {
    const { container } = renderLayout({
      panel: { title: "Edit with AI", children: <div>transcript</div> },
      rail: { label: "Files", children: <div>deck.pptx</div> },
    });

    // The panel starts open (defaultPanelOpen); opening the rail stands it down.
    expect(container.querySelector(".wb-panel")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show file list" }));
    expect(container.querySelector(".wb-rail")).not.toBeNull();
    expect(container.querySelector(".wb-panel")?.getAttribute("aria-hidden")).toBe("true");
    expect(container.querySelector(".wb-panel")?.hasAttribute("inert")).toBe(true);

    // And the reverse.
    fireEvent.click(screen.getByRole("button", { name: "Show AI assistant" }));
    expect(container.querySelector(".wb-panel")).not.toBeNull();
    expect(container.querySelector(".wb-rail")).toBeNull();
  });

  it("leaves the rail state to the caller when it is controlled", () => {
    const onRailOpenChange = vi.fn();
    const { container } = renderLayout({
      rail: { label: "Files", children: <div>deck.pptx</div> },
      railOpen: false,
      onRailOpenChange,
    });

    fireEvent.click(screen.getByRole("button", { name: "Show file list" }));
    expect(onRailOpenChange).toHaveBeenCalledWith(true);
    expect(container.querySelector(".wb-rail")).toBeNull();
  });

  it("clips the frame instead of letting it scroll", () => {
    // `overflow: hidden` would still be a scroll container, and a descendant
    // that sticks out is all it takes for the browser to scroll the frame and
    // slide every child sideways — assistant heading included.
    const css = readFileSync("src/renderer/workbench/workbench.css", "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    const frame = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
      .filter(([, selectors]) => selectors.split(",").some((part) => part.trim() === ".wb"))
      .map(([, , body]) => body)
      .join(" ");

    expect(frame).toMatch(/overflow:\s*hidden/);
    expect(frame).toMatch(/overflow:\s*clip/);
  });

  it("puts the frame back at its origin whenever anything scrolls it", () => {
    const listeners = new Map<string, () => void>();
    const frame = {
      scrollLeft: 45,
      scrollTop: 3,
      addEventListener: (type: string, handler: () => void) => { listeners.set(type, handler); },
      removeEventListener: (type: string) => { listeners.delete(type); },
    } as unknown as HTMLElement;

    const release = pinFrameToOrigin(frame);

    // Whatever was already scrolled is undone as soon as the frame mounts.
    expect(frame.scrollLeft).toBe(0);
    expect(frame.scrollTop).toBe(0);

    // And anything that scrolls it later is undone too.
    frame.scrollLeft = 45;
    listeners.get("scroll")?.();
    expect(frame.scrollLeft).toBe(0);

    release();
    expect(listeners.size).toBe(0);
  });
});
