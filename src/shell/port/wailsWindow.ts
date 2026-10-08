import type { WindowControls } from "../../services/window";

/**
 * Window controls backed by the Wails runtime.
 *
 * Kept here rather than in `src/services` because it is the one piece of the
 * port that depends on the desktop host being present. The service layer takes
 * these as an injected capability so it never imports the runtime itself.
 *
 * The runtime is loaded lazily and by name: the generated bindings are not in
 * version control (CI runs `wails generate module`), and a browser session has
 * no runtime at all. Every control degrades to a no-op rather than throwing —
 * a window button that quietly does nothing outside the desktop is better than
 * one that breaks the page.
 */

type WailsRuntime = {
  Quit?: () => void;
  WindowMinimise?: () => void;
  WindowIsFullscreen?: () => Promise<boolean>;
  WindowFullscreen?: () => void;
  WindowUnfullscreen?: () => void;
};

function runtime(): WailsRuntime | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as unknown as { runtime?: WailsRuntime }).runtime;
}

export function isDesktopHost(): boolean {
  if (typeof window === "undefined") return false;
  const go = (window as unknown as { go?: { main?: { App?: unknown } } }).go;
  return Boolean(go?.main?.App);
}

export function createWailsWindowControls(): WindowControls {
  const listeners = new Set<(fullscreen: boolean) => void>();
  // Wails has no fullscreen-change event, so the last known state is tracked
  // here and listeners are told when a toggle we performed changes it.
  let fullscreen = false;

  void runtime()?.WindowIsFullscreen?.().then((value) => {
    fullscreen = value;
  }).catch(() => {});

  const announce = (next: boolean) => {
    if (next === fullscreen) return;
    fullscreen = next;
    for (const listener of listeners) listener(next);
  };

  return {
    close() {
      runtime()?.Quit?.();
    },
    minimize() {
      runtime()?.WindowMinimise?.();
    },
    toggleFullscreen() {
      const api = runtime();
      if (!api) return;
      if (fullscreen) api.WindowUnfullscreen?.();
      else api.WindowFullscreen?.();
      announce(!fullscreen);
    },
    isFullscreen: () => fullscreen,
    onFullscreenChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
