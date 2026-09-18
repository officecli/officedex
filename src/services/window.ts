import type { WindowPort } from "../shared/uiPort";

/**
 * What a host has to provide for the window controls to work.
 *
 * Narrower than `WindowPort` on purpose: this is the platform capability, not
 * the UI contract. The desktop's version comes from the Wails runtime, which
 * this directory does not import — the host wires it in, and a browser harness
 * can pass something else.
 */
export interface WindowControls {
  close(): void;
  minimize(): void;
  toggleFullscreen(): void;
  isFullscreen(): boolean;
  /** Returns unsubscribe. */
  onFullscreenChange(listener: (fullscreen: boolean) => void): () => void;
}

export function createWindowService(controls: WindowControls): WindowPort {
  return {
    close: () => controls.close(),
    minimize: () => controls.minimize(),
    toggleFullscreen: () => controls.toggleFullscreen(),
    isFullscreen: () => controls.isFullscreen(),
    onFullscreenChange: (listener) => controls.onFullscreenChange(listener),
  };
}
