import { useCallback, useState, type DragEvent } from "react";

const MIME = "application/x-officedex-file";

/** How close to an edge the pointer has to get before the list scrolls. */
const SCROLL_EDGE = 36;
/** Pixels per `dragover`. The event repeats while the pointer is held still. */
const SCROLL_STEP = 14;

/**
 * The nearest ancestor that actually scrolls, or null.
 *
 * Both callers hand their own container to `onDragOver`, and in the sidebar
 * that container is *inside* the scroller (`.shell-sidebar-body`), so the walk
 * has to go up rather than assume.
 */
function scrollerFor(node: HTMLElement | null): HTMLElement | null {
  for (let element = node; element; element = element.parentElement) {
    const overflowY = getComputedStyle(element).overflowY;
    if ((overflowY === "auto" || overflowY === "scroll") && element.scrollHeight > element.clientHeight) {
      return element;
    }
  }
  return null;
}

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

    /*
     * Auto-scroll first, and whether or not the pointer is over a target.
     *
     * The sidebar list is 159px taller than its scroll port in the default
     * fixture, and HTML drag-and-drop does not scroll a container for you: the
     * three folders below the fold simply could not be reached while holding a
     * file (S8-018). Driving it off `dragover` is enough because the event
     * keeps firing while the pointer is held near the edge.
     */
    const scroller = scrollerFor(event.currentTarget);
    if (scroller) {
      const bounds = scroller.getBoundingClientRect();
      if (event.clientY > bounds.bottom - SCROLL_EDGE) scroller.scrollTop += SCROLL_STEP;
      else if (event.clientY < bounds.top + SCROLL_EDGE) scroller.scrollTop -= SCROLL_STEP;
    }

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
