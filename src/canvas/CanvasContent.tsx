import { useEffect } from "react";

import type { DesktopAPI } from "../shared/types";
import type { FileMeta } from "../shared/uiPort";
import type { CanvasSelection } from "../shell/editor/canvasContract";
import type { WriterAgentEditor } from "../renderer/word/WriterEditorFrame";
import type { PresentationEditorController } from "../renderer/presentation/PresentationEditorFrame";
import { useTaskStore } from "../renderer/store/taskStore";
import { PresentationCanvas } from "./PresentationCanvas";
import { DocxCanvas } from "./DocxCanvas";
import { SheetCanvas } from "./SheetCanvas";
import { PresentationStage, liveDeckTask } from "./PresentationStage";

/**
 * What fills the canvas box.
 *
 * One decision, in one place: **a run in progress outranks the open file.**
 * While a deck is being drawn there is nothing on disk to edit yet — the draft
 * is scratch that never enters the file library — and what the user needs to
 * see is the outline gate and the pages appearing. When the run ends the deck
 * becomes an ordinary document and this falls back to whatever tab is active,
 * which by then is usually that document.
 *
 * The alternative, routing purely on the active file, cannot express a drawing
 * deck at all: it has no file to be active.
 *
 * Each leaf reports the handle the shell saves through in its own shape —
 * a controller for slides, a Writer editor for documents, an already-prepared
 * function for workbooks — and this turns all three into the one thing the
 * adapter wants, which is something to call.
 */

export interface CanvasContentProps {
  api: DesktopAPI;
  file: FileMeta | null;
  onDirtyChange: (dirty: boolean) => void;
  /** The user's selection changed, as a label — see `CanvasSelection.text`. */
  onSelectionChange: (selection: CanvasSelection | null) => void;
  /** How to read the selection's text, or null when the editor cannot. */
  onResolveSelection: (resolve: (() => Promise<CanvasSelection | null>) | null) => void;
  /** The handle the shell saves through, or null when nothing is editable. */
  onSave: (save: (() => Promise<unknown>) | null) => void;
  onUnavailable: (reason: string) => void;
}

export function CanvasContent({
  api,
  file,
  onDirtyChange,
  onSelectionChange,
  onResolveSelection,
  onSave,
  onUnavailable,
}: CanvasContentProps) {
  const { state } = useTaskStore();
  const live = liveDeckTask(state.tasks, state.taskOrder);
  const open = live ? null : file;

  // Nothing editable on screen means nothing for the shell to save through.
  // Done in an effect rather than during render: an editor that is mounted
  // reports its own handle, and clearing inline would race that report on the
  // renders where both happen.
  useEffect(() => {
    if (!open) {
      onSave(null);
      onResolveSelection(null);
      onSelectionChange(null);
    }
  }, [open, onSave, onResolveSelection, onSelectionChange]);

  if (live) {
    // The stage owns its own editor session and saves through the runtime: there
    // is no finished file for the shell's save button to write yet.
    return <PresentationStage api={api} task={live} onError={onUnavailable} />;
  }

  if (!open) return null;

  if (open.type === "slides") {
    return (
      <PresentationCanvas
        api={api}
        file={open}
        onDirtyChange={onDirtyChange}
        onSelectionChange={onSelectionChange}
        onResolveSelection={onResolveSelection}
        onController={(controller: PresentationEditorController | null) =>
          onSave(controller ? () => controller.save() : null)
        }
        onUnavailable={onUnavailable}
      />
    );
  }

  if (open.type === "sheet") {
    return (
      <SheetCanvas
        api={api}
        file={open}
        onDirtyChange={onDirtyChange}
        onSelectionChange={onSelectionChange}
        onResolveSelection={onResolveSelection}
        onSave={onSave}
        onUnavailable={onUnavailable}
      />
    );
  }

  return (
    <DocxCanvas
      api={api}
      file={open}
      onDirtyChange={onDirtyChange}
      onSelectionChange={onSelectionChange}
      onResolveSelection={onResolveSelection}
      onEditor={(editor: WriterAgentEditor | null) => onSave(editor ? () => editor.save() : null)}
      onUnavailable={onUnavailable}
    />
  );
}
