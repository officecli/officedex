import { useEffect } from "react";

import type { DesktopAPI, DesktopTask } from "../shared/types";
import type { FileMeta } from "../shared/uiPort";
import type { CanvasSelection } from "../shell/editor/canvasContract";
import type { WriterAgentEditor } from "../renderer/word/WriterEditorFrame";
import type { PresentationEditorController } from "../renderer/presentation/PresentationEditorFrame";
import { NEXAEDGE_DEMO_ID } from "../renderer/presentation/bundledPptxDemo";
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
  /**
   * The recording was on the canvas and something newer took it.
   *
   * The shell owns the flag and the canvas decides precedence, so the loser has
   * to say so or the flag outlives its demo and comes back on the next reload.
   */
  onDemoSuperseded?: () => void;
  /**
   * Show the bundled NexaEdge recording instead of whatever is open.
   *
   * A dev entry (`?deckDemo=1`, see `readDevFixture`) rather than a product
   * surface: it is how the live-drawing path gets exercised on demand, without
   * a run, credits or a three-minute wait. The recording is a real one, so
   * everything downstream of it is the real path.
   */
  demo?: boolean;
  /**
   * When the recording was last asked for.
   *
   * Two jobs: it keys the stage so a second press replays, and it decides
   * whether the recording still holds the canvas — see the routing below.
   */
  demoStartedAt?: string | null;
}

/** Default for the demo prop: the recording is opt-in, everywhere. */
const NOT_DEMO = false;

/**
 * The stage's `DesktopTask` for the bundled recording.
 *
 * `PresentationStage` is typed around a task because a run is normally what
 * puts a deck there. A recording has no run, so it gets a stand-in carrying
 * only what the stage reads: the id it matches its session against, the
 * document type, and a status that keeps it a live deck. No `vibeOps` — the
 * demo feeds itself from the bundled recording, not from task events.
 */
function demoDeckTask(): DesktopTask {
  return {
    id: NEXAEDGE_DEMO_ID,
    conversationId: NEXAEDGE_DEMO_ID,
    documentType: "pptx",
    topic: "NexaEdge AI Fabric product launch (recorded generation)",
    status: "running",
    events: [],
  };
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
  onDemoSuperseded,
  demo = NOT_DEMO,
  demoStartedAt = null,
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
   * In-place editing is withdrawn from every branch that cannot offer it.
   *
   * Reported here rather than left to the adapter's own file-change reset,
   * because switching from a document to something else never passes through
   * the null branch above: the runner would still be the previous file's, and
   * an instruction typed beside it would silently rewrite that file.
   *
   * Word and decks both edit in place now — `office.docx.edit.v1` and
   * `office.pptx.plan_js` — so the test is "is this an editable type", not
   * "is this Word". It used to be `open.type !== "doc"`, which withdrew the
   * deck's runner the moment it registered it: `PresentationCanvas` reports its
   * controller from an effect, and this effect runs after it, so
   * `canEditDocument()` was false for an open deck and every instruction about
   * one went to the generation runtime instead. That is the routing bug, one
   * layer below the one that made it reachable: registering the runner was
   * necessary and not sufficient.
   */
  useEffect(() => {
    if (open && open.type !== "doc" && open.type !== "slides") onEditRunner(null);
  }, [open, onEditRunner]);

  /*
   * The recording holds the canvas only until something newer asks for it.
   *
   * `demo` alone is not enough to decide this. Only `open-file` clears it, and
   * a run has no file — so watching the recording and then asking for a real
   * deck left `demo` true with the finished recording on screen while the panel
   * beside it listed the new run's pages: two different decks in one window.
   *
   * Comparing the two timestamps says which was asked for more recently, which
   * is the rule the rest of this file already follows — what is happening now
   * outranks what was open before.
   */
  const demoIsNewerThanRun =
    demo &&
    (demoStartedAt === null ||
      Date.parse(demoStartedAt) >= Date.parse(liveDeck?.createdAt ?? "") ||
      Number.isNaN(Date.parse(liveDeck?.createdAt ?? "")));

  useEffect(() => {
    if (demo && !demoIsNewerThanRun) onDemoSuperseded?.();
  }, [demo, demoIsNewerThanRun, onDemoSuperseded]);

  if (demo && demoIsNewerThanRun) {
    return (
      <PresentationStage
        key={`deck-demo-${demoStartedAt ?? "initial"}`}
        api={api}
        task={demoDeckTask()}
        onError={onUnavailable}
        demo
      />
    );
  }

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
        onEditRunner={onEditRunner}
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
