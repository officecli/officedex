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

export function mountWindowChrome(): void {
  if (typeof document === "undefined") return;
  applyWindowChrome(document.documentElement, readWindowChromeEnvironment());
}
