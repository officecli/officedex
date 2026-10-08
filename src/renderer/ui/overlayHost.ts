/**
 * Where this library's portalled overlays mount.
 *
 * All four of them — `Modal`, the imperative `dialog`, `Popover` and the toast
 * host — are `position: fixed`, so the host element does not decide where they
 * land on screen. It decides which element's *inherited custom properties* they
 * read, and that is the whole reason this module exists.
 *
 * The new shell re-points the `--od-*` tokens on `#shell`
 * (`src/shell/tokens.css`), because the old renderer shares this library and
 * must stay byte-for-byte unaffected. An overlay portalled to `document.body`
 * sits outside that subtree, so every bridged token silently falls back to the
 * library default: a pure-black primary button next to the shell's #41464b
 * one, 8px dialog corners against 10px, 32px controls against 36px, and a
 * `--od-guidance` blue that exists nowhere else in the shell. The bridge never
 * applied from the day it landed.
 *
 * Resolution order, first hit wins:
 *   1. a host passed to `setOverlayHost()` — explicit, and the path a host
 *      should prefer;
 *   2. `[data-od-overlay-host]` — a marker for a host that cannot run code
 *      before the first overlay opens;
 *   3. `#shell` — the app's own token scope. This keeps the bridge honest
 *      without the shell having to wire anything, and it is inert for the old
 *      renderer, which has no such element.
 *   4. `document.body`.
 *
 * For (1)–(3) the overlays go into a `display: contents` layer appended to the
 * host, so the host's own children keep their box layout and its React tree
 * never has to reconcile around foreign nodes mid-list. For (4) they go
 * straight onto `<body>`, exactly as before.
 */

const LAYER_CLASS = "od-overlay-layer";
const SCOPE_SELECTOR = "[data-od-overlay-host]";
const SHELL_SCOPE_ID = "shell";

let explicitHost: HTMLElement | null = null;

/** Points the overlays at `host`'s token scope; `null` restores `<body>`. */
export function setOverlayHost(host: HTMLElement | null): void {
  explicitHost = host;
}

function scopedHost(): HTMLElement | null {
  if (typeof document === "undefined") return null;
  if (explicitHost?.isConnected) return explicitHost;
  return document.querySelector<HTMLElement>(SCOPE_SELECTOR) ?? document.getElementById(SHELL_SCOPE_ID);
}

function layerIn(host: HTMLElement): HTMLElement {
  for (const child of Array.from(host.children)) {
    if (child instanceof HTMLElement && child.classList.contains(LAYER_CLASS)) return child;
  }
  const layer = document.createElement("div");
  layer.className = LAYER_CLASS;
  host.append(layer);
  return layer;
}

/** The container every portalled overlay in this library should mount into. */
export function overlayHost(): HTMLElement {
  const scoped = scopedHost();
  return scoped ? layerIn(scoped) : document.body;
}
