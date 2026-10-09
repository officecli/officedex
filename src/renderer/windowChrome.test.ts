import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applyWindowChrome,
  hasOverlayWindowChrome,
  mountDragRegionGuard,
  shouldOverlayWindowChrome,
} from "./windowChrome";

const MAC = "MacIntel Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)";
const WIN = "Win32 Mozilla/5.0 (Windows NT 10.0; Win64; x64)";

describe("shouldOverlayWindowChrome", () => {
  it("insets only the macOS desktop window", () => {
    expect(shouldOverlayWindowChrome({ wailsAvailable: true, platform: MAC })).toBe(true);
  });

  it("leaves the native Windows frame alone", () => {
    expect(shouldOverlayWindowChrome({ wailsAvailable: true, platform: WIN })).toBe(false);
  });

  it("leaves the browser preview alone even on a Mac", () => {
    expect(shouldOverlayWindowChrome({ wailsAvailable: false, platform: MAC })).toBe(false);
  });
});

describe("applyWindowChrome", () => {
  it("stamps and clears the root attribute", () => {
    const root = document.createElement("html");

    applyWindowChrome(root, { wailsAvailable: true, platform: MAC });
    expect(root.getAttribute("data-window-chrome")).toBe("overlay");

    applyWindowChrome(root, { wailsAvailable: false, platform: MAC });
    expect(root.hasAttribute("data-window-chrome")).toBe(false);
  });
});

describe("hasOverlayWindowChrome", () => {
  afterEach(() => { document.documentElement.removeAttribute("data-window-chrome"); });

  // What a component asks before drawing window controls of its own.
  it("reads back what applyWindowChrome stamped", () => {
    const root = document.createElement("html");
    expect(hasOverlayWindowChrome(root)).toBe(false);

    applyWindowChrome(root, { wailsAvailable: true, platform: MAC });
    expect(hasOverlayWindowChrome(root)).toBe(true);
  });

  it("defaults to the live document root", () => {
    expect(hasOverlayWindowChrome()).toBe(false);
    applyWindowChrome(document.documentElement, { wailsAvailable: true, platform: MAC });
    expect(hasOverlayWindowChrome()).toBe(true);
  });
});

describe("mountDragRegionGuard", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    Reflect.deleteProperty(window, "runtime");
  });

  const press = (target: Element) => {
    const event = new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 });
    target.dispatchEvent(event);
    return event;
  };

  it("cancels the press that drags the window, and the selection it would start", () => {
    mountDragRegionGuard(document);
    const band = document.createElement("div");
    band.style.setProperty("--wails-draggable", "drag");
    document.body.append(band);

    // Wails starts the drag on the following mousemove either way; what this
    // stops is WebKit anchoring a selection and painting the page blue.
    expect(press(band).defaultPrevented).toBe(true);
    const selection = new Event("selectstart", { bubbles: true, cancelable: true });
    band.dispatchEvent(selection);
    expect(selection.defaultPrevented).toBe(true);
  });

  it("leaves presses outside a drag region alone", () => {
    mountDragRegionGuard(document);
    const content = document.createElement("p");
    content.textContent = "selectable";
    document.body.append(content);

    expect(press(content).defaultPrevented).toBe(false);
    const selection = new Event("selectstart", { bubbles: true, cancelable: true });
    content.dispatchEvent(selection);
    expect(selection.defaultPrevented).toBe(false);
  });

  it("stops guarding once the button comes up", () => {
    mountDragRegionGuard(document);
    const band = document.createElement("div");
    band.style.setProperty("--wails-draggable", "drag");
    document.body.append(band);

    press(band);
    document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));

    const selection = new Event("selectstart", { bubbles: true, cancelable: true });
    document.body.dispatchEvent(selection);
    expect(selection.defaultPrevented).toBe(false);
  });

  it("toggles maximize once per double click even if mounted twice", () => {
    const toggle = vi.fn();
    Object.assign(window, { runtime: { WindowToggleMaximise: toggle } });
    mountDragRegionGuard(document);
    mountDragRegionGuard(document);
    const band = document.createElement("div");
    band.style.setProperty("--wails-draggable", "drag");
    document.body.append(band);

    for (let clicks = 1; clicks <= 2; clicks++) {
      band.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, button: 0 }));
      expect(toggle).toHaveBeenCalledTimes(clicks);
    }
  });

  it("does not maximize from controls, floating headers, content or secondary clicks", () => {
    const toggle = vi.fn();
    Object.assign(window, { runtime: { WindowToggleMaximise: toggle } });
    mountDragRegionGuard(document);
    const band = document.createElement("div");
    band.style.setProperty("--wails-draggable", "drag");
    const button = document.createElement("button");
    button.style.setProperty("--wails-draggable", "no-drag");
    band.append(button);
    const floating = document.createElement("div");
    floating.style.setProperty("--wails-draggable", "no-drag");
    document.body.append(band, floating);
    for (const target of [button, floating, document.body]) {
      target.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, button: 0 }));
    }
    band.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, button: 2 }));
    expect(toggle).not.toHaveBeenCalled();
  });

  it("leaves browser double clicks alone when the desktop runtime is absent", () => {
    mountDragRegionGuard(document);
    const band = document.createElement("div");
    band.style.setProperty("--wails-draggable", "drag");
    document.body.append(band);
    const event = new MouseEvent("dblclick", { bubbles: true, cancelable: true });
    band.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });
});
