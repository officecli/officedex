import { describe, expect, it } from "vitest";
import { applyWindowChrome, shouldOverlayWindowChrome } from "./windowChrome";

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
