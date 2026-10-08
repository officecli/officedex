import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

import type { CanvasSelection } from "../editor/canvasContract";
import { useCanvas } from "./CanvasContext";

interface SelectionValue {
  selection: CanvasSelection | null;
  /** The user dismissed the reference, or it was sent. */
  clear: () => void;
}

const SelectionContext = createContext<SelectionValue>({ selection: null, clear: () => {} });

/**
 * What the user has selected in the document, carried to the composer.
 *
 * The contract has had `onSelection` since the canvas seam was drawn, and
 * `SendInput.reference` has had somewhere to put the result — but nothing was
 * subscribing, so selecting a paragraph and asking the agent about "this"
 * sent a message with no idea what "this" was. This is the missing wire.
 *
 * Deliberately *not* in `shellReducer`: a selection is not view state. It is
 * whatever the editor says is selected this instant, it must never be
 * persisted across a restart, and it is cleared by things the reducer has no
 * reason to know about (the file changing underneath it, the message going
 * out). Keeping it here also means no selection change re-renders the tree
 * through the shell reducer.
 *
 * The prototype tracked one more thing that is deliberately left out: it
 * re-resolved a stale selection by searching the document for the original
 * text, so a reference survived a re-render. That belongs to whoever owns the
 * document's coordinates — a shell that cannot see inside the editor cannot
 * re-find anything. The adapter is expected to push null instead.
 */
export function SelectionProvider({ children }: { children: ReactNode }) {
  const canvas = useCanvas();
  const [selection, setSelection] = useState<CanvasSelection | null>(null);

  useEffect(() => {
    if (!canvas) return;
    return canvas.onSelection(setSelection);
  }, [canvas]);

  return (
    <SelectionContext.Provider value={{ selection, clear: () => setSelection(null) }}>
      {children}
    </SelectionContext.Provider>
  );
}

export function useCanvasSelection(): SelectionValue {
  return useContext(SelectionContext);
}

/**
 * The selection, but only while it belongs to the file being looked at.
 *
 * An editor that pushes a selection and then goes quiet would otherwise leave
 * the composer quoting a document the user has since navigated away from —
 * a reference chip that names one file while the canvas shows another is worse
 * than no chip at all.
 */
export function selectionForFile(
  selection: CanvasSelection | null,
  activeFileId: string | null,
): CanvasSelection | null {
  if (!selection || !activeFileId) return null;
  return selection.fileId === activeFileId ? selection : null;
}
