import { describe, expect, it } from "vitest";

import { closeTabShortcutLabel, isCloseTabShortcut, isMacHost } from "./closeTabShortcut";

const MAC = "MacIntel Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)";
const WINDOWS = "Win32 Mozilla/5.0 (Windows NT 10.0; Win64; x64)";

const press = (init: KeyboardEventInit) => new KeyboardEvent("keydown", { code: "KeyW", key: "w", ...init });

describe("close-tab shortcut", () => {
  it("is ⌘W on macOS and Ctrl+W elsewhere", () => {
    expect(isMacHost(MAC)).toBe(true);
    expect(isMacHost(WINDOWS)).toBe(false);
    expect(closeTabShortcutLabel(MAC)).toBe("⌘W");
    expect(closeTabShortcutLabel(WINDOWS)).toBe("Ctrl+W");

    expect(isCloseTabShortcut(press({ metaKey: true }), MAC)).toBe(true);
    expect(isCloseTabShortcut(press({ ctrlKey: true }), WINDOWS)).toBe(true);
  });

  it("does not answer to the other platform's modifier", () => {
    expect(isCloseTabShortcut(press({ ctrlKey: true }), MAC)).toBe(false);
    expect(isCloseTabShortcut(press({ metaKey: true }), WINDOWS)).toBe(false);
    expect(isCloseTabShortcut(press({}), MAC)).toBe(false);
  });

  // ⇧⌘W and ⌥⌘W close the window and every window; Ctrl+Shift+W is a window
  // close on Windows. Answering to them would take an action nobody asked for.
  it("leaves the neighbouring system chords alone", () => {
    expect(isCloseTabShortcut(press({ metaKey: true, shiftKey: true }), MAC)).toBe(false);
    expect(isCloseTabShortcut(press({ metaKey: true, altKey: true }), MAC)).toBe(false);
    expect(isCloseTabShortcut(press({ ctrlKey: true, shiftKey: true }), WINDOWS)).toBe(false);
  });

  it("ignores auto-repeat so holding it does not walk through the open files", () => {
    expect(isCloseTabShortcut(press({ metaKey: true, repeat: true }), MAC)).toBe(false);
  });

  // A Cyrillic or Greek layout reports a different `key` for the same physical
  // key; `code` is what makes the chord survive the layout.
  it("matches the physical key on a non-Latin layout", () => {
    const cyrillic = new KeyboardEvent("keydown", { code: "KeyW", key: "ц", metaKey: true });
    expect(isCloseTabShortcut(cyrillic, MAC)).toBe(true);
  });
});
