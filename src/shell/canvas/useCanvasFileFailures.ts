import { useEffect, useRef } from "react";

import type { CanvasAdapter } from "../editor/canvasContract";
import type { FileFailure } from "../../shared/fileFailure";
import type { FileMeta } from "../../shared/uiPort";
import { usePort } from "../port/PortContext";
import { clearFileFailureReport, reportFileFailure } from "../port/reportPortFailure";
import { useShell } from "../state/ShellContext";

/**
 * Carries the editor's own failures into the shell.
 *
 * Sibling of `useCanvasDirty`, for the other fact only the editor knows: that
 * its file could not be opened, or that a save it ran by itself — Writer's
 * idle autosave, the save control inside its frame — did not reach the disk.
 * The shell's own save path sees its failure as a rejected promise and needs
 * no wire; this is for the saves it never asked for, which until now failed
 * where nothing could see them while the status line went on saying "Saved".
 *
 * The record goes on the file (`FileMeta.failure`, through the port) so every
 * place that shows a status shows this one; the toast is the part that asks
 * for action. A recovery (`null`) with nothing on record is dropped without a
 * reload — Writer reports "loaded" on every open.
 */
export function useCanvasFileFailures(
  canvas: CanvasAdapter | null,
  retry: (file: FileMeta) => Promise<unknown>,
): void {
  const port = usePort();
  const { files, reload } = useShell();
  const filesRef = useRef(files);
  const retryRef = useRef(retry);
  filesRef.current = files;
  retryRef.current = retry;

  useEffect(() => {
    if (!canvas?.onFileFailure) return;
    return canvas.onFileFailure((fileId: string, failure: FileFailure | null) => {
      const file = filesRef.current.find((entry) => entry.id === fileId);
      if (!failure && !file?.failure) return;
      void (async () => {
        await port.files.setFailure?.(fileId, failure);
        await reload();
        if (!failure) {
          clearFileFailureReport(fileId);
          return;
        }
        const named = file ?? { id: fileId, name: fileId };
        reportFileFailure(named, failure, () => {
          const current = filesRef.current.find((entry) => entry.id === fileId) ?? { ...named, failure };
          void retryRef.current(current as FileMeta);
        });
      })();
    });
  }, [canvas, port, reload]);
}
