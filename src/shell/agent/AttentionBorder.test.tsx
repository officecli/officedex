import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AttentionBorder } from "./AttentionBorder";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/**
 * jsdom measures every element as 0×0, and the border refuses to draw a box it
 * cannot fit — so a size has to be faked before any of this means anything.
 */
function withSize(width: number, height: number) {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: width,
    bottom: height,
    width,
    height,
    toJSON: () => ({}),
  } as DOMRect);
}

const overlay = (container: HTMLElement) =>
  container.querySelector<SVGSVGElement>("[data-shell-attention]");

describe("AttentionBorder", () => {
  it("stays out of the way until the agent is working", () => {
    withSize(800, 600);
    const { container } = render(<AttentionBorder active={false} />);
    expect(overlay(container)?.style.display).toBe("none");
  });

  it("frames the canvas while the agent works", () => {
    withSize(800, 600);
    const { container } = render(<AttentionBorder active />);
    const svg = overlay(container);
    expect(svg?.style.display).toBe("block");

    // Every stroke in the stack sits on the same inset box.
    const rects = [...(svg?.querySelectorAll("g rect") ?? [])];
    expect(rects.length).toBeGreaterThan(5);
    for (const rect of rects) {
      expect(rect.getAttribute("x")).toBe("10");
      expect(rect.getAttribute("width")).toBe("780");
      expect(rect.getAttribute("height")).toBe("580");
    }
  });

  it("takes a box when the canvas can say where the work is", () => {
    withSize(800, 600);
    const { container } = render(
      <AttentionBorder active box={{ left: 40, top: 120, width: 300, height: 80 }} />,
    );
    const rect = overlay(container)?.querySelector("g rect");
    expect(rect?.getAttribute("x")).toBe("40");
    expect(rect?.getAttribute("y")).toBe("120");
    expect(rect?.getAttribute("width")).toBe("300");
  });

  // A box smaller than its own inset would be drawn inside out.
  it("draws nothing in a collapsed workspace", () => {
    withSize(8, 600);
    const { container } = render(<AttentionBorder active />);
    expect(overlay(container)?.style.display).toBe("none");
  });

  it("removes its layer when the shell tears down", () => {
    withSize(800, 600);
    const { container, unmount } = render(<AttentionBorder active />);
    expect(overlay(container)).not.toBeNull();
    unmount();
    expect(overlay(container)).toBeNull();
  });
});
