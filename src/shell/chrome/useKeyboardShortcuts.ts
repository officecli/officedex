import { useEffect } from "react";
import { EventsOn } from "../../renderer/generated/wailsjs/runtime";
import { listenToShortcutDocuments } from "./shortcutDocuments";

import { useLibraryActions } from "../nav/useLibraryActions";
import { useShell } from "../state/ShellContext";
import { useFileActions } from "./useFileActions";

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
export function useKeyboardShortcuts({ onNew, enabled = true }: { onNew: () => void; enabled?: boolean }) {
  const library = useLibraryActions();
  const { dispatch, activeFile } = useShell();
  const { save } = useFileActions();

  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.repeat || !(event.metaKey || event.ctrlKey) || event.altKey) return;
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
        // The shell owns persistence; prevent a second editor-local save.
        event.stopPropagation();
        // The same path as the Save button, so a refused write is recorded
        // against the file and shown with a Retry rather than lost; quiet,
        // because ⌘S has never announced itself.
        void save(activeFile, { quiet: true });
      }
    };
    const disposeKeys = listenToShortcutDocuments(window, onKeyDown);
    const disposeNative = (window as unknown as { runtime?: { EventsOnMultiple?: unknown } }).runtime?.EventsOnMultiple
      ? EventsOn("officedex:save", () => { if (activeFile) void save(activeFile, { quiet: true }); })
      : undefined;
    return () => { disposeKeys(); disposeNative?.(); };
  }, [library, dispatch, activeFile, save, onNew, enabled]);
}
