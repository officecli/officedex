import { useCallback, useState, type DragEvent } from "react";

const MIME = "application/x-officedex-file";

/**
 * Drag-to-file, delegated from one container.
 *
 * Decision 3's guard lives in the selector: only elements carrying
 * `data-drop-folder` accept a drop, and `FileTree` only puts that attribute on
 * groups with a real `folderId`. A time bucket ("Previous 7 days") therefore
 * cannot be dropped into, because it is a view over the list rather than a
 * place a file can be. The prototype allowed a drop onto "Recent", which is
 * what made "Recent" ambiguous between a location and a view.
 */
export function useFolderDrop(onMove: (fileId: string, folderId: string) => void) {
  const [overFolderId, setOverFolderId] = useState<string | null>(null);

  const carriesFile = (event: DragEvent) => [...event.dataTransfer.types].includes(MIME);

  const onDragOver = useCallback((event: DragEvent<HTMLElement>) => {
    if (!carriesFile(event)) return;
    const target = (event.target as HTMLElement).closest<HTMLElement>("[data-drop-folder]");
    if (!target) {
      setOverFolderId(null);
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setOverFolderId(target.dataset.dropFolder ?? null);
  }, []);

  const onDragLeave = useCallback((event: DragEvent<HTMLElement>) => {
    if (event.currentTarget.contains(event.relatedTarget as Node)) return;
    setOverFolderId(null);
  }, []);

  const onDrop = useCallback(
    (event: DragEvent<HTMLElement>) => {
      setOverFolderId(null);
      if (!carriesFile(event)) return;
      const target = (event.target as HTMLElement).closest<HTMLElement>("[data-drop-folder]");
      const folderId = target?.dataset.dropFolder;
      const fileId = event.dataTransfer.getData(MIME);
      if (!folderId || !fileId) return;
      event.preventDefault();
      onMove(fileId, folderId);
    },
    [onMove],
  );

  return { overFolderId, dropHandlers: { onDragOver, onDragLeave, onDrop } };
}
