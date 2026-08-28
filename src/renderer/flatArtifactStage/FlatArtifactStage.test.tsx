import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FlatArtifactStage } from "./FlatArtifactStage";
import { flatArtifactGifFixture, flatArtifactImageFixture } from "./fixtures";

afterEach(() => cleanup());

function measurableCanvas(width = 400, height = 200): HTMLElement {
  const canvas = screen.getByRole("group", { name: "Artifact region selection" });
  canvas.getBoundingClientRect = () => ({
    left: 0,
    top: 0,
    right: width,
    bottom: height,
    width,
    height,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  }) as DOMRect;
  return canvas;
}

function pointer(canvas: HTMLElement, type: string, clientX: number, clientY: number): void {
  fireEvent(canvas, new MouseEvent(type, { button: 0, bubbles: true, clientX, clientY }));
}

describe("FlatArtifactStage", () => {
  it("emits a normalized image region and clears it from the keyboard", () => {
    const onSelectionChange = vi.fn();
    render(<FlatArtifactStage artifact={flatArtifactImageFixture} onSelectionChange={onSelectionChange} />);
    const canvas = measurableCanvas();

    pointer(canvas, "pointerdown", 40, 20);
    pointer(canvas, "pointermove", 240, 120);
    pointer(canvas, "pointerup", 240, 120);

    expect(onSelectionChange).toHaveBeenCalledWith(expect.objectContaining({
      scope: { kind: "region", region: { x: 0.1, y: 0.1, width: 0.5, height: 0.5 } },
      frameSelection: { kind: "single", index: 0 },
    }));
    expect(screen.getByLabelText("Selected artifact region")).toBeTruthy();

    fireEvent.keyDown(canvas, { key: "-" });
    expect(onSelectionChange).toHaveBeenLastCalledWith(expect.objectContaining({
      scope: { kind: "region", region: { x: 0.1, y: 0.1, width: 0.49, height: 0.49 } },
    }));

    fireEvent.keyDown(canvas, { key: "Delete" });
    expect(screen.queryByLabelText("Selected artifact region")).toBeNull();
    expect(onSelectionChange).toHaveBeenLastCalledWith(expect.objectContaining({ scope: { kind: "document" } }));
  });

  it("supports single-frame and inclusive range controls for GIF only", () => {
    const onSelectionChange = vi.fn();
    render(<FlatArtifactStage artifact={flatArtifactGifFixture} onSelectionChange={onSelectionChange} />);
    expect(screen.getByLabelText("GIF frame")).toBeTruthy();
    expect(screen.queryByLabelText("GIF range start")).toBeNull();

    fireEvent.click(screen.getByLabelText("Frame range"));
    fireEvent.change(screen.getByLabelText("GIF range start"), { target: { value: "3" } });
    fireEvent.change(screen.getByLabelText("GIF range end"), { target: { value: "7" } });

    expect(onSelectionChange).toHaveBeenLastCalledWith(expect.objectContaining({
      frameSelection: { kind: "range", start: 3, end: 7 },
    }));

    cleanup();
    render(<FlatArtifactStage artifact={flatArtifactImageFixture} />);
    expect(screen.queryByLabelText("GIF frame")).toBeNull();
    expect(screen.queryByLabelText("GIF range start")).toBeNull();
  });

  it("fails closed with a visible error for a too-small region and invalid range", () => {
    const onSelectionChange = vi.fn();
    render(<FlatArtifactStage artifact={flatArtifactGifFixture} onSelectionChange={onSelectionChange} />);
    const canvas = measurableCanvas();
    pointer(canvas, "pointerdown", 10, 10);
    pointer(canvas, "pointerup", 11, 11);
    expect(screen.getByRole("alert")).toHaveTextContent(/minimum editable area/i);
    expect(onSelectionChange).not.toHaveBeenCalled();

    fireEvent.click(screen.getByLabelText("Frame range"));
    fireEvent.change(screen.getByLabelText("GIF range start"), { target: { value: "8" } });
    fireEvent.change(screen.getByLabelText("GIF range end"), { target: { value: "4" } });
    expect(screen.getByRole("alert")).toHaveTextContent(/valid inclusive frame range/i);
  });

  it("emits identity-only edit requests without reading preview content", () => {
    const onEditRequest = vi.fn();
    render(<FlatArtifactStage artifact={flatArtifactImageFixture} previewSrc="data:image/png;base64,fixture" onEditRequest={onEditRequest} />);
    fireEvent.change(screen.getByLabelText("Instruction"), { target: { value: "Remove the object" } });
    fireEvent.click(screen.getByRole("button", { name: "Request redraw" }));
    expect(onEditRequest).toHaveBeenCalledWith(expect.objectContaining({
      action: "redraw",
      artifact: { artifactId: flatArtifactImageFixture.artifactId, artifactPath: flatArtifactImageFixture.artifactPath, kind: "image" },
      scope: { kind: "document" },
    }));
    expect(JSON.stringify(onEditRequest.mock.calls[0][0])).not.toContain("data:image/png");
  });
});
