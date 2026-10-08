import type { UiPort } from "../../shared/uiPort";
import { createDesktopUiPort } from "../../services/createDesktopUiPort";
import { createDesktopAPI, readBridgeEnvironment } from "../../renderer/bridge/select";
import { createWailsWindowControls } from "./wailsWindow";

/**
 * Picks the `UiPort` implementation for this page.
 *
 * Wherever a real Go backend is reachable the shell talks to the real services.
 * A plain browser gets the bridge's explicit preview implementation, which is
 * an empty read-only workspace; test fixtures opt into the in-memory fake
 * directly. The shell itself never knows which: `main.tsx` is the only caller,
 * and every component reaches the port through `usePort`.
 *
 * "Reachable" is `hasDesktopBackend`, not `window.go`. The narrower test was
 * true only inside the desktop app, which meant the browser E2E harness — a
 * real bridge over HTTP, the thing `npm run test:e2e` exists to drive — got the
 * fake port instead, and no end-to-end test of this shell could have tested
 * anything real.
 *
 * The bridge factory still lives under `src/renderer/` because that is where it
 * was when the old UI owned it. It is transport, not renderer, and moves out
 * when the old entry point is retired.
 */
export function createShellPort(): UiPort {
  // `createDesktopAPI` selects the browser preview API when no bridge exists.
  // It deliberately exposes no documents, folders, models or generation
  // runtime, so the standalone prototype can never masquerade as user data.
  return createDesktopUiPort({
    api: createDesktopAPI(readBridgeEnvironment()),
    // No-ops outside the desktop app, which is what a browser should get:
    // there is no window to close from a tab.
    window: createWailsWindowControls(),
  });
}
