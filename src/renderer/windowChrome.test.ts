import { afterEach, describe, expect, it } from "vitest";
import { applyWindowChrome, mountDragRegionGuard, shouldOverlayWindowChrome } from "./windowChrome";

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

describe("mountDragRegionGuard", () => {
  afterEach(() => { document.body.innerHTML = ""; });

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
});
