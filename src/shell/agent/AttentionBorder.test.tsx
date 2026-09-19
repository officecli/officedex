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

/**
 * Agent Home's hero glow is this same component, flush with the composer and
 * lit by input focus (see the note on AttentionBorder). These assert the two
 * things that make it a glow rather than a second copy of the canvas frame.
 */
describe("AttentionBorder as the hero composer's focus glow", () => {
  it("sits flush with the composer instead of inset inside it", () => {
    withSize(720, 190);
    const { container } = render(<AttentionBorder active inset={0} radius={20} />);
    const svg = overlay(container);
    expect(svg?.style.display).toBe("block");

    const rects = [...(svg?.querySelectorAll("g rect") ?? [])];
    expect(rects.length).toBeGreaterThan(5);
    for (const rect of rects) {
      expect(rect.getAttribute("x")).toBe("0");
      expect(rect.getAttribute("y")).toBe("0");
      expect(rect.getAttribute("width")).toBe("720");
      expect(rect.getAttribute("height")).toBe("190");
      // The composer's own corner, not the overlay's default 18.
      expect(rect.getAttribute("rx")).toBe("20");
    }
  });

  it("goes out when the composer loses focus", () => {
    withSize(720, 190);
    // Reduced motion so the exit is immediate: the fade otherwise needs a
    // frame loop, and jsdom is not running one.
    const { container, rerender } = render(
      <AttentionBorder active inset={0} radius={20} reducedMotion />,
    );
    expect(overlay(container)?.style.display).toBe("block");
    rerender(<AttentionBorder active={false} inset={0} radius={20} reducedMotion />);
    expect(overlay(container)?.style.display).toBe("none");
  });

  it("parks the travelling light when the user asked for less motion", () => {
    withSize(720, 190);
    const frame = vi.spyOn(window, "requestAnimationFrame");
    const { container } = render(
      <AttentionBorder active inset={0} radius={20} reducedMotion />,
    );
    // The border is still drawn — it is information, not decoration — but
    // nothing is scheduled to move it.
    expect(overlay(container)?.style.display).toBe("block");
    expect(frame).not.toHaveBeenCalled();
  });

  it("starts moving again when the setting is turned back off", () => {
    withSize(720, 190);
    const frame = vi.spyOn(window, "requestAnimationFrame").mockReturnValue(1);
    const { rerender } = render(<AttentionBorder active inset={0} radius={20} reducedMotion />);
    expect(frame).not.toHaveBeenCalled();
    rerender(<AttentionBorder active inset={0} radius={20} reducedMotion={false} />);
    expect(frame).toHaveBeenCalled();
  });
});

