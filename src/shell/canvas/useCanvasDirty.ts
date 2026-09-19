import { useEffect, useRef } from "react";

import type { CanvasAdapter } from "../editor/canvasContract";
import { usePort } from "../port/PortContext";
import { useShell } from "../state/ShellContext";

/**
 * Carries the editor's unsaved state into the shell.
 *
 * The tab dot, the status bar and the save button all read `FileMeta.dirty`,
 * and the only thing that knows a document has unsaved changes is the editor
 * holding it. This is the wire between them.
 *
 * Two guards, both about how often this can fire. A document being edited emits
 * dirty continuously, and every reload re-reads the whole file list:
 *
 *   - Only a *change* in the flag is acted on, not every report.
 *   - The file the flag belongs to is captured when the event arrives, not read
 *     later: a save that completes just after the user switched tabs must not
 *     clear the flag on whatever they switched to.
 */
export function useCanvasDirty(canvas: CanvasAdapter | null, activeFileId: string | null): void {
  const port = usePort();
  const { reload } = useShell();
  const fileRef = useRef(activeFileId);
  const lastRef = useRef<boolean | null>(null);

  fileRef.current = activeFileId;

  useEffect(() => {
    if (!canvas) return;
    return canvas.onDirtyChange((dirty) => {
      const fileId = fileRef.current;
      if (!fileId || lastRef.current === dirty) return;
      lastRef.current = dirty;
      void (async () => {
        await port.files.setDirty(fileId, dirty);
        await reload();
      })();
    });
  }, [canvas, port, reload]);

  // A different document starts with an unknown flag rather than the previous
  // one's, or the first report after a tab switch is swallowed as a duplicate.
  useEffect(() => {
    lastRef.current = null;
  }, [activeFileId]);
}
