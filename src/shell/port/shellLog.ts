import type { DesktopAPI } from "../../shared/types";
import { createDesktopAPI, hasDesktopBackend, readBridgeEnvironment } from "../../renderer/bridge/select";

/**
 * The shell's line to the app log.
 *
 * Until this existed the shell wrote nothing at all, anywhere. That is fine
 * right up to the first report of "it opens blank and there is no error" — at
 * which point a packaged build offers no console, no devtools and no log, and
 * the only way forward is to rebuild the whole thing in a browser and hope the
 * failure reproduces there. It did not.
 *
 * Deliberately thin: this is not telemetry and not a debug channel that has to
 * be switched on. It records what already went wrong, next to everything else
 * the app records, so the next unreproducible report starts from a file rather
 * than from a reconstruction.
 *
 * Never throws and never awaits into a caller. A failure to log is not worth
 * turning into a second failure, and nothing the user does should wait on it.
 */

let api: DesktopAPI | null | undefined;

function desktop(): DesktopAPI | null {
  // Resolved on first use rather than at import: the bridge is not installed
  // while the module graph is still loading.
  if (api === undefined) api = hasDesktopBackend() ? createDesktopAPI(readBridgeEnvironment()) : null;
  return api;
}

export function logShellEvent(event: string, details?: Record<string, unknown>): void {
  const target = desktop();
  if (!target?.recordRendererLog) return;
  void target
    .recordRendererLog({ source: "shell", event, ...(details ? { details } : {}) })
    .catch(() => {});
}

/** Test seam: drops the resolved api so the next call re-reads the environment. */
export function resetShellLogForTests(): void {
  api = undefined;
}
