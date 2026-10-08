// On macOS the desktop window hides its title bar (mac.TitleBarHiddenInset in
// main.go), so the traffic lights float over the top-left of the page and the
// sidebar has to reserve room for them. Nothing else does: the browser preview
// has no window controls to dodge, and Windows keeps its native frame.

const CHROME_ATTRIBUTE = "data-window-chrome";

export interface WindowChromeEnvironment {
  /** True when the Go app is bound to the page, i.e. this is the desktop shell. */
  wailsAvailable: boolean;
  /** navigator.platform / userAgent — anything that names the host OS. */
  platform: string;
}

export function readWindowChromeEnvironment(): WindowChromeEnvironment {
  if (typeof window === "undefined") return { wailsAvailable: false, platform: "" };
  const go = (window as unknown as { go?: { main?: { App?: unknown } } }).go;
  const nav = window.navigator;
  return {
    wailsAvailable: Boolean(go?.main?.App),
    platform: `${nav?.platform ?? ""} ${nav?.userAgent ?? ""}`,
  };
}

/** Whether the page must inset itself around window controls it does not own. */
export function shouldOverlayWindowChrome(env: WindowChromeEnvironment): boolean {
  return env.wailsAvailable && /mac|iphone|ipad/i.test(env.platform);
}

/** Stamps the root element so the stylesheets can size the traffic-light band. */
export function applyWindowChrome(root: HTMLElement, env: WindowChromeEnvironment): void {
  if (shouldOverlayWindowChrome(env)) {
    root.setAttribute(CHROME_ATTRIBUTE, "overlay");
    return;
  }
  root.removeAttribute(CHROME_ATTRIBUTE);
}

/**
 * Whether the system is already drawing window controls over this page.
 *
 * Reads the attribute `applyWindowChrome` stamped, so a component asks the same
 * question the stylesheets do and gets the same answer. A component that draws
 * its own controls has to ask: on macOS the real traffic lights float over the
 * top-left corner whatever the page puts there, and two overlapping sets is
 * what you get if it does not (see `chrome/WindowBar.tsx`).
 */
export function hasOverlayWindowChrome(root?: HTMLElement): boolean {
  const element = root ?? (typeof document === "undefined" ? null : document.documentElement);
  return element?.getAttribute(CHROME_ATTRIBUTE) === "overlay";
}

export function mountWindowChrome(): void {
  if (typeof document === "undefined") return;
  applyWindowChrome(document.documentElement, readWindowChromeEnvironment());
  mountDragRegionGuard(document);
}

/** The property Wails reads to decide whether a press drags the window. */
const DRAG_PROPERTY = "--wails-draggable";
const DRAG_VALUE = "drag";

/** True for presses Wails will turn into a window drag — the same test its own
 *  runtime makes, so this cannot disagree with it about where the bands are. */
function pressStartsWindowDrag(event: MouseEvent): boolean {
  if (event.button !== 0) return false;
  const target = event.target;
  if (!(target instanceof Element)) return false;
  const value = getComputedStyle(target).getPropertyValue(DRAG_PROPERTY).trim();
  return value === DRAG_VALUE;
}

/** Stops a window drag from painting the page blue on its way.
 *
 *  Wails defers the drag to the first mousemove and never cancels the press's
 *  default action, so WebKit anchors a text selection at the same time and the
 *  whole page stays highlighted until the button comes up. `user-select: none`
 *  on the band is not enough: the band has no text of its own, so WebKit
 *  anchors at the nearest selectable position instead and selects everything
 *  the drag sweeps over. Cancelling the press (and the selection it would
 *  start) is what actually stops it. Wails' own listener never looks at
 *  defaultPrevented, so the drag still happens. */
export function mountDragRegionGuard(root: Document): void {
  let dragging = false;
  root.addEventListener("mousedown", (event) => {
    dragging = pressStartsWindowDrag(event);
    if (dragging) event.preventDefault();
  });
  root.addEventListener("selectstart", (event) => {
    if (dragging) event.preventDefault();
  });
  root.addEventListener("mouseup", () => { dragging = false; });
}
