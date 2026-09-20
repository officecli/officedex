/*
 * The canvas while a workbook is being written.
 *
 * A workbook is the case a deck is not: there is no live draft to render. The
 * runtime hands back one XLSX at the end, so until then nothing exists to open
 * in an editor — and what the canvas did about that was render nothing. A
 * generation is a minute of blank white next to a panel that says work is
 * happening, which reads as broken rather than as pending.
 *
 * So this draws what is actually known: the sheets the blueprint named, and
 * which of them are written. The sheet tabs sit where the mounted editor puts
 * its own, so when the file lands and the real workbook takes over, the one
 * thing the eye was tracking does not jump.
 *
 * Deliberately not a preview: no invented rows, no fake numbers in the grid
 * behind it. The skeleton is the shell's own — the same one the host draws for
 * a workbook it cannot mount — and it says "a grid is coming", which is exactly
 * as much as anyone here knows.
 */

import type { DesktopTask } from "../shared/types";
import { xlsxSheetProgress, type SheetProgress } from "./sheetRuntimeProgress";
import "./sheetStage.css";

export interface SheetStageProps {
  task: DesktopTask;
}

/**
 * The line under the title.
 *
 * Counting written sheets rather than echoing the runtime's own sentence: the
 * sentence is written for a log ("Wrote sheet Quarterly Budget (1/1)") and
 * names whichever sheet happened to finish last, which is not what someone
 * watching a workbook take shape wants to know.
 *
 * Before the sheet list arrives — and for a whole run when the request is an
 * edit, which never produces one — the run's own active stage is what there is
 * to say. It is the same sentence the task panel shows, which is the point: a
 * guess like "Planning the sheets" was wrong for every edit, and stating a
 * phase the run is not in is worse than repeating one it is.
 */
function statusLine(task: DesktopTask, sheets: SheetProgress[]): string {
  if (sheets.length === 0) {
    const active = (task.stages ?? []).find((stage) => stage.id === task.activeStageId);
    return active?.label.trim() || "Getting started";
  }
  const written = sheets.filter((sheet) => sheet.state === "written").length;
  if (written === 0) return sheets.length === 1 ? "Writing 1 sheet" : `Writing ${sheets.length} sheets`;
  if (written < sheets.length) return `${written} of ${sheets.length} sheets written`;
  return "Assembling the workbook";
}

export function SheetStage({ task }: SheetStageProps) {
  const sheets = xlsxSheetProgress(task);

  return (
    <div className="shell-sheet-stage" data-sheets={sheets.length}>
      {/*
        Ruled ground, drawn rather than built.
        The shell's own `CanvasPlaceholder type="sheet"` was the obvious thing
        to put here and it is a fixed 18 rows of real cells: on a full-height
        canvas the grid stopped halfway down and the rest was white, which
        reads as a half-loaded document rather than as paper. Two gradients
        fill whatever height they are given, and cost nothing to repeat.
      */}
      <div className="shell-sheet-stage-grid" aria-hidden="true">
        <span className="shell-sheet-stage-gutter" />
        <span className="shell-sheet-stage-header" />
      </div>

      {/* One live region for the whole stage: a screen reader should hear the
          workbook's progress, not each tab's state read out in turn. */}
      <div className="shell-sheet-stage-status" role="status">
        <span className="shell-sheet-stage-title">Writing the workbook</span>
        <span className="shell-sheet-stage-phase">{statusLine(task, sheets)}</span>
      </div>

      {sheets.length > 0 ? (
        <div className="shell-sheet-stage-tabs" aria-hidden="true">
          {sheets.map((sheet) => (
            <span
              key={`${sheet.index}:${sheet.name}`}
              className="shell-sheet-stage-tab"
              data-state={sheet.state}
            >
              {/* The same symbol language the step list uses: a tick is done,
                  a ring is not yet. Learning a second one inside the same
                  window would be this component's invention alone. */}
              <span className="shell-sheet-stage-mark" />
              <span className="shell-sheet-stage-name">{sheet.name}</span>
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
