import { useEffect } from "react";

import type { DesktopAPI } from "../shared/types";
import type { FileMeta } from "../shared/uiPort";
import type { CanvasSelection } from "../shell/editor/canvasContract";
import type { WriterAgentEditor } from "../renderer/word/WriterEditorFrame";
import type { PresentationEditorController } from "../renderer/presentation/PresentationEditorFrame";
import { useTaskStore } from "../renderer/store/taskStore";
import { PresentationCanvas } from "./PresentationCanvas";
import { DocxCanvas, type DocumentEditRunner } from "./DocxCanvas";
import { SheetCanvas } from "./SheetCanvas";
import { ImageCanvas } from "./ImageCanvas";
import { SheetStage } from "./SheetStage";
import { liveWorkbookTask } from "./sheetRuntimeProgress";
import { PresentationStage, liveDeckTask } from "./PresentationStage";
import { DocxStage, liveDocTask } from "./DocxStage";

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
  /**
   * How to rewrite part of the open document in place, or null when whatever
   * is on screen cannot be edited that way — which is everything except Word.
   */
  onEditRunner: (edit: DocumentEditRunner | null) => void;
  onUnavailable: (reason: string) => void;
}

export function CanvasContent({
  api,
  file,
  onDirtyChange,
  onSelectionChange,
  onResolveSelection,
  onSave,
  onEditRunner,
  onUnavailable,
}: CanvasContentProps) {
  const { state } = useTaskStore();
  const liveDeck = liveDeckTask(state.tasks, state.taskOrder);
  /*
   * A document being written takes the canvas the same way a deck does, and for
   * the same reason: there is no file yet, so routing on the active file shows
   * the *last* document the user had open while a different one is being
   * written — for the length of the run, with nothing saying so.
   *
   * A deck wins a tie. Two runs of different types at once is rare, and when it
   * happens the deck has the more informative stage: it shows the real pages
   * appearing, while this one can only show that something is coming.
   */
  const liveDoc = liveDeck ? null : liveDocTask(state.tasks, state.taskOrder);
  /*
   * A workbook being written is the third of these, and the plainest case for
   * it: the runtime hands back one XLSX at the end, so there is nothing to
   * render until the run is over and the canvas showed a blank rectangle for
   * the whole minute it took.
   *
   * Last of the three for the same reason the document is second — the deck's
   * stage shows real pages, the workbook's can only show which sheets are
   * planned and which are written.
   */
  const liveSheet = liveDeck || liveDoc ? null : liveWorkbookTask(state.tasks, state.taskOrder);
  const open = liveDeck || liveDoc || liveSheet ? null : file;

  // Nothing editable on screen means nothing for the shell to save through.
  // Done in an effect rather than during render: an editor that is mounted
  // reports its own handle, and clearing inline would race that report on the
  // renders where both happen.
  useEffect(() => {
    // A picture is on screen but nothing in it is saved, selected or edited.
    if (!open || open.type === "image") {
      onSave(null);
      onResolveSelection(null);
      onSelectionChange(null);
      onEditRunner(null);
    }
  }, [open, onSave, onResolveSelection, onSelectionChange, onEditRunner]);

  /*
   * In-place editing belongs to Word alone, so every other branch withdraws it.
   *
   * Reported here rather than left to the adapter's own file-change reset,
   * because switching from a document to a *deck* never passes through the
   * null branch above: the runner would still be the document's, and an
   * instruction typed beside a slide would silently rewrite the Word file
   * behind it.
   */
  useEffect(() => {
    if (open && open.type !== "doc") onEditRunner(null);
  }, [open, onEditRunner]);

  if (liveDeck) {
    // The stage owns its own editor session and saves through the runtime: there
    // is no finished file for the shell's save button to write yet.
    return <PresentationStage api={api} task={liveDeck} onError={onUnavailable} />;
  }

  // No editor session and nothing to save: a document under construction is not
  // a file yet, and this stage mounts no editor to become one.
  if (liveDoc) return <DocxStage task={liveDoc} />;

  /*
   * Same for a workbook — and here the remount on the way out is doing work.
   *
   * An edit rewrites the file the mounted editor is holding, and the editor
   * keeps showing the bytes it loaded: it has no reason to know the disk moved
   * under it. Routing the run through the stage tears that session down, so
   * when the artifact opens the workbook is read fresh, which is the only
   * reading of it that is true.
   */
  if (liveSheet) return <SheetStage task={liveSheet} />;

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

  if (open.type === "image") {
    return <ImageCanvas api={api} file={open} onUnavailable={onUnavailable} />;
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
      onEditRunner={onEditRunner}
      onUnavailable={onUnavailable}
    />
  );
}
