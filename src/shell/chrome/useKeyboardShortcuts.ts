import { useEffect } from "react";

import { useCanvas } from "../canvas/CanvasContext";
import { useLibraryActions } from "../nav/useLibraryActions";
import { usePort } from "../port/PortContext";
import { attempt } from "../port/reportPortFailure";
import { useShell } from "../state/ShellContext";

/**
 * Application shortcuts — OD-UI-1.2 §13.
 *
 *   ⌘O  open a file        ⌘N  New         ⌘S  save the document on screen
 *   ⌘,  Settings           ⌘W  close the document (see `DocumentTabs`)
 *
 * ⌘S belongs to the document: it is handled here only while one is on screen,
 * and it saves through the editor first, so the conversation can never take it.
 * Shortcuts that belong to an editor — and ⌘F, which searches whatever has
 * focus — are left to whatever has focus.
 */
export function useKeyboardShortcuts({ onNew }: { onNew: () => void }) {
  const port = usePort();
  const canvas = useCanvas();
  const library = useLibraryActions();
  const { dispatch, activeFile, reload } = useShell();

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing || !(event.metaKey || event.ctrlKey) || event.altKey) return;
      const key = event.key.toLowerCase();
      if (key === "o") {
        event.preventDefault();
        void library.openFromDisk();
      } else if (key === "n" && !event.shiftKey) {
        event.preventDefault();
        onNew();
      } else if (key === ",") {
        event.preventDefault();
        dispatch({ type: "go", page: "settings" });
      } else if (key === "s" && !event.shiftKey && activeFile) {
        event.preventDefault();
        void (async () => {
          await attempt(async () => {
            await canvas?.save();
            await port.files.save(activeFile.id);
          });
          await reload();
        })();
      }
    };
    // Capture: the chord has to work while focus is inside a mounted editor.
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [port, canvas, library, dispatch, activeFile, reload, onNew]);
}
