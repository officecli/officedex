import type { DesktopTask } from "../shared/types";
import "./docxStage.css";

/**
 * A Word document while it is being written.
 *
 * The counterpart of `PresentationStage`, and deliberately a much smaller
 * thing, because the runtime gives it much less to work with. A deck is drawn
 * page by page into a live draft file that an editor can mount, so that stage
 * can show the deck itself appearing. A document is one call: the model is
 * asked for the whole thing, returns it as JSON, and `BuildDOCXFromJSON`
 * assembles the file (officecli `internal/runtime/service.go`, `generateDOCX`).
 * There is no intermediate document, so there is nothing to render.
 *
 * What this replaces is worse than a placeholder, though. Without it the canvas
 * during a document run showed *the previously open file* — ask for a new memo
 * while last week's report is in a tab and the report sits there, unchanged,
 * for the length of the run, as if it were the thing being written. The
 * dispatcher had no way to express "a document is coming": a run that has
 * produced no file has no file to be active.
 *
 * So: the shape of a document, and the runtime's own words for what it is
 * doing. Nothing here is invented — no headings, no page count, no title read
 * off the user's prompt. The page is a placeholder and reads as one.
 */

/** Statuses where a run still owns the canvas. Mirrors `PresentationStage`. */
const LIVE_STATUSES = ["starting", "running", "question", "plan_review"];

/**
 * The document run the canvas should be showing, if any.
 *
 * Only while the run is going: a finished document is a file, and the file is
 * what the user edits. Among several, the most recent — `taskOrder` is
 * newest-first.
 *
 * There is deliberately no "…unless the artifact already exists" clause. It
 * looks like it should be needed — the stage must not stand in front of a
 * document that has been written — but `taskState.ts` attaches `artifact` only
 * on `task.completed`, which is the same event that takes the status out of
 * this list. A second guard for it would be a line that can never run, next to
 * a comment explaining the case it handles.
 */
export function liveDocTask(
  tasks: Record<string, DesktopTask>,
  order: readonly string[],
): DesktopTask | null {
  for (const id of order) {
    const task = tasks[id];
    if (!task || task.documentType !== "docx") continue;
    if (LIVE_STATUSES.includes(task.status)) return task;
  }
  return null;
}

/**
 * The line under the title.
 *
 * The active stage's label, which `taskState.ts` has already mapped from the
 * runtime's raw step to something a reader can act on — that mapping exists
 * because the raw steps otherwise put evidence paths and palette hex values on
 * screen. Falls back to a plain statement rather than to an empty string: a
 * stage with no caption at all reads as a hang.
 */
function caption(task: DesktopTask): string {
  const active = (task.stages ?? []).find((stage) => stage.id === task.activeStageId);
  if (active?.label) return active.label;
  if (task.status === "question") return "Waiting for your answer";
  if (task.status === "plan_review") return "Waiting for your review";
  return "Working on your document";
}

/**
 * The body of the page: paragraph-shaped rules under two headings.
 *
 * Fixed rather than random. A layout that reshuffles on every render is a
 * second, worse animation — and this component re-renders on every progress
 * event a run emits, which is often.
 */
const BLOCKS: ReadonlyArray<readonly number[]> = [
  [96, 100, 88, 62],
  [100, 93, 97, 58],
  [92, 100, 71],
];

export interface DocxStageProps {
  task: DesktopTask;
}

export function DocxStage({ task }: DocxStageProps) {
  return (
    <div className="shell-doc-stage">
      <div className="shell-doc-stage-paper" aria-hidden="true">
        <span className="shell-doc-stage-line shell-doc-stage-line--title" />
        {BLOCKS.map((widths, block) => (
          <div key={block} className="shell-doc-stage-block">
            {block > 0 ? <span className="shell-doc-stage-line shell-doc-stage-line--heading" /> : null}
            {widths.map((width, line) => (
              <span
                key={line}
                className="shell-doc-stage-line"
                style={{ width: `${width}%` }}
              />
            ))}
          </div>
        ))}
      </div>

      <div className="shell-doc-stage-status">
        <strong className="shell-doc-stage-title">Writing a document</strong>
        <span className="shell-doc-stage-phase" role="status">
          {caption(task)}
        </span>
      </div>
    </div>
  );
}
