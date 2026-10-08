import { useCallback, useEffect, useRef, useState, type CSSProperties, type DragEvent } from "react";

import type { FileDropPoint } from "../../shared/uiPort";
import { usePort } from "../port/PortContext";

/** A drag from Finder or Explorer carries "Files"; a row dragged to a folder does not. */
const carriesDiskFiles = (event: DragEvent) => [...event.dataTransfer.types].includes("Files");

/** Set on every element `useDiskDrop` manages; the innermost one under a drop owns it. */
const ZONE_ATTRIBUTE = "data-disk-drop-zone";

/**
 * Whether a native drop at `point` was meant for `zone`.
 *
 * Every zone hears every drop — the port has one subscription list, not one
 * per zone — so each asks which zone is innermost under the point. The agent
 * composer can sit inside a page that also takes drops, and a file let go over
 * the composer is an attachment, not a file to open.
 *
 * A runtime that reports no point (the E2E bridge), or a DOM with no hit
 * testing (jsdom), leaves nothing to decide with; the drop goes to every zone,
 * which is what happened before there was more than one.
 */
export function dropLandedIn(zone: Element | null, point?: FileDropPoint): boolean {
  if (!zone) return false;
  if (!point || typeof document.elementFromPoint !== "function") return true;
  return document.elementFromPoint(point.x, point.y)?.closest(`[${ZONE_ATTRIBUTE}]`) === zone;
}

/**
 * Files dragged in from the desktop — Editor Home's drop zone, and the agent
 * composer's.
 *
 * Two halves that arrive by different routes. Whether something is being
 * dragged over the page is DOM `dragenter`/`dragleave`, which is all the
 * overlay needs. The paths come from the port's `onDropFromDisk`, because a
 * webview never hands a page the real path of a dropped file — on the desktop
 * Wails reports them from the native side, and only for drops that land on an
 * element carrying `--wails-drop-target: drop`. That is why the zone sets the
 * property on itself rather than relying on the window: a drop anywhere else
 * (an open document, the sidebar) is swallowed, not opened.
 *
 * `onDrop` runs for the latest render's handler; the port subscription is made
 * once, because Wails keeps a single file-drop listener and every resubscribe
 * tears down the window listeners that stop the webview navigating to a file.
 */
export function useDiskDrop(onDrop: (paths: string[]) => void) {
  const port = usePort();
  const latest = useRef(onDrop);
  latest.current = onDrop;
  const zone = useRef<HTMLDivElement | null>(null);

  /** Fixed-position bounds of the zone while a drag is over it; null otherwise. */
  const [overlay, setOverlay] = useState<CSSProperties | null>(null);
  /** `dragenter` and `dragleave` fire per child, so being "over" is a count. */
  const depth = useRef(0);

  const reset = useCallback(() => {
    depth.current = 0;
    setOverlay(null);
  }, []);

  useEffect(
    () =>
      port.files.onDropFromDisk((paths, point) => {
        // Any native drop ends the drag, wherever it landed. On the desktop
        // this is the only end a zone hears: Wails keeps the drop from the
        // webview, so no DOM `drop` or `dragleave` ever arrives.
        reset();
        if (paths.length > 0 && dropLandedIn(zone.current, point)) latest.current(paths);
      }),
    [port, reset],
  );

  // A drag that ends outside the window never sends this element a dragleave.
  // `mousemove` is the backstop: no mouse events reach the page during a drag,
  // so the first one means the drag is over however it ended — the overlay
  // must never outlive it, since it covers what it sits on.
  useEffect(() => {
    if (!overlay) return;
    window.addEventListener("dragend", reset);
    window.addEventListener("drop", reset);
    window.addEventListener("mousemove", reset);
    return () => {
      window.removeEventListener("dragend", reset);
      window.removeEventListener("drop", reset);
      window.removeEventListener("mousemove", reset);
    };
  }, [overlay, reset]);

  const onDragEnter = useCallback((event: DragEvent<HTMLElement>) => {
    if (!carriesDiskFiles(event)) return;
    depth.current += 1;
    if (depth.current !== 1) return;
    // The zone scrolls, so the overlay is pinned to where it sits on screen
    // rather than to its content box.
    const bounds = event.currentTarget.getBoundingClientRect();
    setOverlay({ top: bounds.top, left: bounds.left, width: bounds.width, height: bounds.height });
  }, []);

  const onDragOver = useCallback((event: DragEvent<HTMLElement>) => {
    if (!carriesDiskFiles(event)) return;
    // Without this the browser refuses the drop; Wails does it too, on window.
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  }, []);

  const onDragLeave = useCallback((event: DragEvent<HTMLElement>) => {
    if (!carriesDiskFiles(event)) return;
    depth.current = Math.max(0, depth.current - 1);
    if (depth.current === 0) setOverlay(null);
  }, []);

  const onDropEvent = useCallback(
    (event: DragEvent<HTMLElement>) => {
      if (!carriesDiskFiles(event)) return;
      // Stops a browser navigating to the file; the paths arrive via the port.
      event.preventDefault();
      reset();
    },
    [reset],
  );

  return {
    overlay,
    zoneHandlers: { ref: zone, [ZONE_ATTRIBUTE]: "", onDragEnter, onDragOver, onDragLeave, onDrop: onDropEvent },
  };
}
