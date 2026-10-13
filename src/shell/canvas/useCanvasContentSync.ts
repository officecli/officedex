import { useEffect } from "react";

import type { CanvasAdapter } from "../editor/canvasContract";
import { usePort } from "../port/PortContext";

/**
 * Tells the editor when the file it holds was rewritten on disk.
 *
 * Sibling of `useCanvasFileFailures`, for the opposite direction: there the
 * editor knows something the shell does not, here the agent does. Applying a
 * suggestion and taking it back both replace the source file's bytes, and an
 * editor that already loaded the file goes on showing what it loaded — through
 * a closed tab too, since the adapter keeps its editor (UX30-01).
 */
export function useCanvasContentSync(canvas: CanvasAdapter | null): void {
  const port = usePort();
  useEffect(() => {
    if (!canvas?.invalidate) return;
    return port.agent.subscribe((event) => {
      if (event.kind === "task" && event.fileChanged) canvas.invalidate?.(event.fileChanged);
    });
  }, [canvas, port]);
}
