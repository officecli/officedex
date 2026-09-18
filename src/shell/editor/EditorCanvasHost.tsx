import { useEffect, useRef } from "react";

import type { FileMeta } from "../../shared/uiPort";
import { CanvasPlaceholder } from "./CanvasPlaceholder";
import type { CanvasAdapter, CanvasSelection } from "./canvasContract";

export interface EditorCanvasHostProps {
  file: FileMeta | null;
  /** False while Home is showing. The host stays mounted either way. */
  visible: boolean;
  adapter?: CanvasAdapter | null;
  onSelectionChange?: (selection: CanvasSelection | null) => void;
}

/**
 * Decision 4 in one component: this element mounts once and is never unmounted
 * for a layout reason.
 *
 * The prototype had to fake continuity across a mode switch — snapshot the DOM,
 * slice it, hinge it in 3D — precisely because its `setMode` rebuilt the
 * editor from scratch and the document visibly jumped. Keeping the host node
 * stable makes the continuity real instead of simulated, costs nothing, and
 * avoids a technique that would not survive contact with an actual document
 * renderer (snapshotting one reliably at 60fps is not a given).
 *
 * The invariant is guarded by EditorCanvasHost.test.tsx, which asserts node
 * identity across a mode change, a Home round trip and a tab switch.
 */
export function EditorCanvasHost({ file, visible, adapter, onSelectionChange }: EditorCanvasHostProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const mountedAdapter = useRef<CanvasAdapter | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !adapter || mountedAdapter.current === adapter) return;
    mountedAdapter.current?.unmount();
    mountedAdapter.current = adapter;
    void adapter.mount(host);
    return () => {
      // Only a real teardown (the shell itself unmounting) reaches this.
      adapter.unmount();
      if (mountedAdapter.current === adapter) mountedAdapter.current = null;
    };
  }, [adapter]);

  useEffect(() => {
    if (!adapter || !onSelectionChange) return;
    return adapter.onSelection(onSelectionChange);
  }, [adapter, onSelectionChange]);

  useEffect(() => {
    const active = mountedAdapter.current;
    if (!active) return;
    if (visible && file) active.show(file);
    else active.hide();
  }, [file, visible]);

  return (
    <div
      ref={hostRef}
      className="shell-canvas"
      data-canvas-host="true"
      data-file-type={file?.type ?? "doc"}
      role="document"
      aria-label={file ? file.name : "Document canvas"}
    >
      {adapter ? null : <CanvasPlaceholder type={file?.type ?? "doc"} />}
    </div>
  );
}
