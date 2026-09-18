import type { UiPort } from "../../shared/uiPort";
import { createDesktopUiPort } from "../../services/createDesktopUiPort";
import { createDesktopAPI, readBridgeEnvironment } from "../../renderer/bridge/select";
import { createFakePort } from "./fake/createFakePort";
import { createWailsWindowControls, isDesktopHost } from "./wailsWindow";

/**
 * Picks the `UiPort` implementation for this page.
 *
 * Inside the desktop app the shell talks to the real services; anywhere else —
 * a plain browser, a design review, a screenshot — it runs on the in-memory
 * fake. The shell itself never knows which: `main.tsx` is the only caller, and
 * every component reaches the port through `usePort`.
 *
 * The bridge factory still lives under `src/renderer/` because that is where it
 * was when the old UI owned it. It is transport, not renderer, and moves out
 * when the old entry point is retired.
 */
export function createShellPort(): UiPort {
  if (!isDesktopHost()) return createFakePort();
  return createDesktopUiPort({
    api: createDesktopAPI(readBridgeEnvironment()),
    window: createWailsWindowControls(),
  });
}
