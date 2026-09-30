/**
 * Name tips for controls that carry `data-tooltip` — OD-UI-1.2 §08, §17.
 *
 * The rules the shell depends on: a pointer waits about half a second, a
 * keyboard does not wait at all, the tip goes away on anything that looks like
 * the user moving on, and it is never the control's accessible name — it is an
 * `aria-describedby`, added while it is up and taken away with it.
 *
 * jsdom keeps no hover state, so `:hover` is false for every element and the
 * pointer path could never reach the show. `hovering()` below teaches one
 * element to answer that one selector; nothing else here is stubbed.
 */
import { fireEvent } from "@testing-library/dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { mountTooltips } from "./tooltips";

let host: HTMLElement;
let dispose: () => void;

const TIP = "Document (.docx) · Open editor";

/** A control with a tip, and one without, both inside the host. */
function controls(): { withTip: HTMLButtonElement; plain: HTMLButtonElement } {
  const withTip = document.createElement("button");
  withTip.dataset.tooltip = TIP;
  withTip.textContent = "docx";
  const plain = document.createElement("button");
  plain.textContent = "send";
  host.append(withTip, plain);
  return { withTip, plain };
}

/** Makes one element report that the pointer is resting on it. */
function hovering(element: HTMLElement) {
  const real = element.matches.bind(element);
  element.matches = (selector: string) => (selector === ":hover" ? true : real(selector));
}

const tip = () => host.querySelector("#dx-control-tooltip");

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  dispose = mountTooltips(host);
});

afterEach(() => {
  dispose();
  host.remove();
  vi.useRealTimers();
});

describe("the pointer", () => {
  it("waits about half a second before naming a control", () => {
    vi.useFakeTimers();
    const { withTip } = controls();
    hovering(withTip);

    fireEvent.pointerOver(withTip);
    expect(tip()).toBeNull();

    vi.advanceTimersByTime(499);
    expect(tip()).toBeNull();

    vi.advanceTimersByTime(1);
    expect(tip()?.textContent).toBe(TIP);
  });

  // The delay is there so a pointer crossing a row of nine type buttons names
  // none of them. Leaving before it elapses shows nothing at all.
  it("shows nothing when the pointer leaves before the delay", () => {
    vi.useFakeTimers();
    const { withTip } = controls();
    hovering(withTip);

    fireEvent.pointerOver(withTip);
    vi.advanceTimersByTime(200);
    fireEvent.pointerOut(withTip);
    vi.advanceTimersByTime(1000);

    expect(tip()).toBeNull();
  });

  it("withdraws the tip when the pointer leaves the control", () => {
    const { withTip } = controls();
    fireEvent.focusIn(withTip);
    expect(tip()).not.toBeNull();

    fireEvent.pointerOut(withTip);
    expect(tip()).toBeNull();
  });

  it("withdraws the tip on a press", () => {
    const { withTip } = controls();
    fireEvent.focusIn(withTip);
    fireEvent.pointerDown(withTip);
    expect(tip()).toBeNull();
  });
});

describe("the keyboard", () => {
  it("names a control the moment it takes focus", () => {
    const { withTip } = controls();
    fireEvent.focusIn(withTip);
    expect(tip()?.textContent).toBe(TIP);
    expect(tip()?.getAttribute("role")).toBe("tooltip");
  });

  it("withdraws the tip on blur", () => {
    const { withTip } = controls();
    fireEvent.focusIn(withTip);
    fireEvent.focusOut(withTip);
    expect(tip()).toBeNull();
  });

  it("withdraws the tip on Escape", () => {
    const { withTip } = controls();
    fireEvent.focusIn(withTip);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(tip()).toBeNull();
  });

  // Another key is somebody working, not somebody dismissing the tip.
  it("keeps the tip for any other key", () => {
    const { withTip } = controls();
    fireEvent.focusIn(withTip);
    fireEvent.keyDown(document, { key: "ArrowRight" });
    expect(tip()).not.toBeNull();
  });
});

describe("a control with no tip", () => {
  it("never gets one from the pointer", () => {
    vi.useFakeTimers();
    const { plain } = controls();
    hovering(plain);

    fireEvent.pointerOver(plain);
    vi.advanceTimersByTime(2000);

    expect(tip()).toBeNull();
    expect(plain.hasAttribute("aria-describedby")).toBe(false);
  });

  it("never gets one from focus, and takes the open tip away with it", () => {
    const { withTip, plain } = controls();
    fireEvent.focusIn(withTip);
    expect(tip()).not.toBeNull();

    fireEvent.focusIn(plain);
    expect(tip()).toBeNull();
  });
});

describe("the accessible name", () => {
  // A tip describes; it never becomes the name. So the control points at the
  // tip while it is up, and stops pointing at anything when it is gone.
  it("is described by the tip only while the tip is up", () => {
    const { withTip } = controls();
    expect(withTip.hasAttribute("aria-describedby")).toBe(false);

    fireEvent.focusIn(withTip);
    expect(withTip.getAttribute("aria-describedby")).toBe("dx-control-tooltip");
    expect(document.getElementById("dx-control-tooltip")).not.toBeNull();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(withTip.hasAttribute("aria-describedby")).toBe(false);
  });

  it("moves with focus rather than accumulating", () => {
    const first = document.createElement("button");
    first.dataset.tooltip = "Presentation (.pptx) · Open editor";
    const second = document.createElement("button");
    second.dataset.tooltip = TIP;
    host.append(first, second);

    fireEvent.focusIn(first);
    fireEvent.focusIn(second);

    expect(first.hasAttribute("aria-describedby")).toBe(false);
    expect(second.getAttribute("aria-describedby")).toBe("dx-control-tooltip");
    expect(host.querySelectorAll("#dx-control-tooltip")).toHaveLength(1);
  });
});

describe("scrolling", () => {
  it("withdraws the tip, wherever the scroll happens", () => {
    const { withTip } = controls();
    const scroller = document.createElement("div");
    host.append(scroller);

    fireEvent.focusIn(withTip);
    fireEvent.scroll(scroller);

    expect(tip()).toBeNull();
  });
});

describe("cleanup", () => {
  it("takes the open tip down and stops listening", () => {
    const { withTip } = controls();
    fireEvent.focusIn(withTip);
    expect(tip()).not.toBeNull();

    dispose();
    expect(tip()).toBeNull();
    expect(withTip.hasAttribute("aria-describedby")).toBe(false);

    fireEvent.focusIn(withTip);
    expect(tip()).toBeNull();

    // The afterEach hook disposes again; that has to be harmless.
    dispose = () => undefined;
  });
});
