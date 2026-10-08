/*
 * Close the current file tab from the keyboard: ⌘W on macOS, Ctrl+W everywhere
 * else. Same chord as every other tabbed app on each platform, which is the
 * whole point — it is the one shortcut users try without being told.
 *
 * The platform is read the same way `windowChrome.ts` reads it (platform plus
 * user agent, so neither a deprecated `navigator.platform` nor a spoofed UA
 * decides alone), because the two must never disagree about which OS the shell
 * is drawing for.
 */

const MAC = /mac|iphone|ipad/i;

export function readHostPlatform(): string {
  if (typeof navigator === "undefined") return "";
  return `${navigator.platform ?? ""} ${navigator.userAgent ?? ""}`;
}

export function isMacHost(platform: string = readHostPlatform()): boolean {
  return MAC.test(platform);
}

/**
 * Whether this key press is the close-tab chord.
 *
 * Deliberately exact about the modifiers. ⌥⌘W and ⇧⌘W are *different* system
 * shortcuts on macOS (close all windows / close window), and Ctrl+Shift+W is
 * one on Windows; swallowing those as "close a tab" would take an action the
 * user did not ask for. `code` is checked before `key` so a non-Latin keyboard
 * layout, where the W key reports something else entirely, still works.
 *
 * `repeat` is dropped: holding the chord down must not walk through every open
 * file, one auto-repeat at a time.
 */
export function isCloseTabShortcut(event: KeyboardEvent, platform: string = readHostPlatform()): boolean {
  if (event.repeat || event.altKey || event.shiftKey) return false;
  if (event.code !== "KeyW" && event.key.toLowerCase() !== "w") return false;
  return isMacHost(platform) ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
}

/** The chord as it is written on each platform, for tooltips. */
export function closeTabShortcutLabel(platform: string = readHostPlatform()): string {
  return isMacHost(platform) ? "⌘W" : "Ctrl+W";
}
