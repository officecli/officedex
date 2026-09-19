import type { CanvasAdapter } from "../editor/canvasContract";
import { createDesktopCanvas } from "../../canvas/createDesktopCanvas";
import { createDesktopAPI, hasDesktopBackend, readBridgeEnvironment } from "../../renderer/bridge/select";
import { reportPortFailure } from "./reportPortFailure";
import { NotImplementedError } from "../../shared/notImplemented";

/**
 * Picks the canvas adapter for this page, the same way `createShellPort` picks
 * the port — and by the same test, so the two cannot disagree about whether
 * this page has a backend.
 *
 * Null when there is none: the host keeps drawing its skeleton, which is the
 * normal state for a design review or a screenshot, not a degraded one. The
 * embedded editors are served by the Go side, so where there is no backend
 * there is nothing to mount.
 *
 * A missing editor runtime is reported as a gap rather than an error.
 * `public/writer/` and `public/presentation/` are staged build artifacts — a
 * source checkout that has not run the staging step has no editor to load, and
 * the honest thing to say is that it is not there, not that something broke.
 */
export function createShellCanvas(): CanvasAdapter | null {
  if (!hasDesktopBackend()) return null;
  return createDesktopCanvas({
    api: createDesktopAPI(readBridgeEnvironment()),
    // Each leaf already says which editor it is and what went wrong — Writer,
    // the workbook SDK and the presentation runtime fail for different reasons
    // and are staged by different build steps. Naming one of them here produced
    // "The presentation editor could not start: The Word editor could not
    // start…" for a document.
    onUnavailable: (reason) => reportPortFailure(new NotImplementedError("editor-runtime", reason)),
  });
}
