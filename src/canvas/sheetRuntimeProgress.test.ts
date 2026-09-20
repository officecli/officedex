import { describe, expect, it } from "vitest";

import type { BridgeEvent, DesktopTask } from "../shared/types";
import { liveWorkbookTask, xlsxSheetProgress } from "./sheetRuntimeProgress";

/**
 * Reading the workbook's progress off the run.
 *
 * The facts are the runtime's: which sheets the blueprint named, and which of
 * them have been written. What is under test is that the shell reads the
 * structured field rather than the sentence beside it — the sentence is written
 * for a log and changes wording with the runtime.
 */

function event(payload: Record<string, unknown>): BridgeEvent {
  return {
    event_id: `e${Math.random()}`,
    task_id: "task-1",
    type: "task.progress",
    ts: "2026-09-20T00:00:00Z",
    payload,
  };
}

function task(events: BridgeEvent[], overrides: Partial<DesktopTask> = {}): DesktopTask {
  return {
    id: "task-1",
    status: "running",
    documentType: "xlsx",
    events,
    ...overrides,
  } as DesktopTask;
}

const planned = event({
  content: "XLSX structure planned: 2 sheets (Summary, Costs)",
  sheet_state: [
    { name: "Summary", index: 1, total: 2, state: "pending" },
    { name: "Costs", index: 2, total: 2, state: "pending" },
  ],
});

const firstWritten = event({
  content: "Wrote sheet Summary (1/2)",
  sheet_state: [
    { name: "Summary", index: 1, total: 2, state: "written" },
    { name: "Costs", index: 2, total: 2, state: "pending" },
  ],
});

describe("xlsxSheetProgress", () => {
  it("reads the sheets the run reported", () => {
    expect(xlsxSheetProgress(task([planned]))).toEqual([
      { name: "Summary", index: 1, total: 2, state: "pending" },
      { name: "Costs", index: 2, total: 2, state: "pending" },
    ]);
  });

  /*
   * Each report is a complete snapshot taken under the lock that counts
   * finished sheets, so the newest one already knows everything the earlier
   * ones did. Merging them would only create a way for the two to disagree —
   * and would keep a sheet marked pending after it was written.
   */
  it("takes the newest report whole", () => {
    const sheets = xlsxSheetProgress(task([planned, firstWritten]));
    expect(sheets.map((sheet) => sheet.state)).toEqual(["written", "pending"]);
  });

  // An older CLI does not send the field, and a run that has not reached its
  // blueprint has not decided the sheets yet. Neither has a list to draw.
  it("is empty when the run has not said", () => {
    expect(xlsxSheetProgress(task([event({ content: "Planning the XLSX structure" })]))).toEqual([]);
    expect(xlsxSheetProgress(task([]))).toEqual([]);
  });

  // A payload from a runtime that spells the field differently must not become
  // a tab with no name on it.
  it("drops entries with no name", () => {
    const malformed = event({ sheet_state: [{ index: 1 }, { name: "  ", state: "written" }, { name: "Real" }] });
    expect(xlsxSheetProgress(task([malformed]))).toEqual([
      { name: "Real", index: 0, total: 0, state: "pending" },
    ]);
  });

  // Anything that is not one of the two known states is pending: a tab claiming
  // a sheet is finished is the one error worth avoiding here.
  it("treats an unknown state as pending", () => {
    const odd = event({ sheet_state: [{ name: "Summary", index: 1, total: 1, state: "repairing" }] });
    expect(xlsxSheetProgress(task([odd]))[0].state).toBe("pending");
  });
});

describe("liveWorkbookTask", () => {
  const order = ["task-1"];

  it("picks a workbook run that is still going", () => {
    const tasks = { "task-1": task([planned]) };
    expect(liveWorkbookTask(tasks, order)?.id).toBe("task-1");
  });

  // A finished workbook is a file, and the file is what the user edits.
  it("gives the canvas back when the run ends", () => {
    const tasks = { "task-1": task([planned], { status: "completed" }) };
    expect(liveWorkbookTask(tasks, order)).toBeNull();
  });

  it("ignores runs of other types", () => {
    const tasks = { "task-1": task([], { documentType: "pptx" }) };
    expect(liveWorkbookTask(tasks, order)).toBeNull();
  });

  // A run blocked on a question still owns the canvas: it has not produced the
  // file yet, so falling back to the previous tab would show the wrong
  // document while the run waits.
  it("keeps the canvas while a run is waiting on the user", () => {
    const tasks = { "task-1": task([planned], { status: "question" }) };
    expect(liveWorkbookTask(tasks, order)?.id).toBe("task-1");
  });
});
