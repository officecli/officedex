import type { DesktopTask } from "../shared/types";

/**
 * What the runtime says about the workbook it is writing.
 *
 * A deck reports `slide_state` per page and the canvas draws it. A workbook now
 * reports `sheet_state` the same way: the blueprint names every sheet before a
 * cell of it exists, and each one flips to `written` as its fill request comes
 * back. Before that field existed the same facts travelled only inside English
 * sentences ("Wrote sheet Costs (2/3)"), so nothing could show them without
 * parsing prose — which is why the canvas showed nothing at all.
 *
 * There is no `writing` state on purpose: the runtime fills sheets
 * concurrently, so once writing starts *every* pending sheet is in flight and
 * singling one out would be a lie about which is nearly done.
 */
export interface SheetProgress {
  name: string;
  /** 1-based position in the workbook. */
  index: number;
  total: number;
  state: "pending" | "written";
}

function toSheet(value: unknown): SheetProgress | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  if (!name) return null;
  const state = raw.state === "written" ? "written" : "pending";
  const index = Number.isInteger(raw.index) && Number(raw.index) > 0 ? Number(raw.index) : 0;
  const total = Number.isInteger(raw.total) && Number(raw.total) > 0 ? Number(raw.total) : 0;
  return { name, index, total, state };
}

/**
 * The latest sheet list the run reported, or an empty list.
 *
 * The newest event wins outright rather than being merged with older ones: each
 * `sheet_state` is a complete snapshot taken under the lock that counts
 * finished sheets, so it already knows everything the earlier ones did. Merging
 * would only create a chance for the two to disagree.
 *
 * Empty means "nothing to draw" for every reason at once — a run that has not
 * reached its blueprint yet, a document that is not a workbook, and an older
 * CLI that does not send the field. A caller cannot usefully tell those apart
 * and none of them has a sheet list.
 */
export function xlsxSheetProgress(task: DesktopTask): SheetProgress[] {
  for (let index = task.events.length - 1; index >= 0; index -= 1) {
    const raw = task.events[index]?.payload?.sheet_state;
    if (!Array.isArray(raw)) continue;
    const sheets = raw.map(toSheet).filter((sheet): sheet is SheetProgress => sheet !== null);
    if (sheets.length > 0) return sheets;
  }
  return [];
}

/** Statuses where a run still owns the canvas — the same set decks use. */
const LIVE_STATUSES = ["starting", "running", "question", "plan_review"];

/**
 * The workbook run the canvas should be showing, if any.
 *
 * Mirrors `liveDeckTask`, and for the same reason: while a run is going there
 * is no file to route by — the workbook does not exist until the last step
 * writes it — so the task is what puts something on screen. When the run ends
 * the artifact becomes an ordinary file and the canvas falls back to its
 * editor.
 *
 * Both a fresh generation and an edit of an open workbook qualify. An edit has
 * a file on disk, but the bytes being rewritten are not the bytes the mounted
 * editor is holding, so what the user would otherwise watch is a stale sheet
 * presented as the live one.
 */
export function liveWorkbookTask(
  tasks: Record<string, DesktopTask>,
  order: readonly string[],
): DesktopTask | null {
  for (const id of order) {
    const task = tasks[id];
    if (!task || task.documentType !== "xlsx") continue;
    if (LIVE_STATUSES.includes(task.status)) return task;
  }
  return null;
}
