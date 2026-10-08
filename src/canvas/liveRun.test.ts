import { describe, expect, it } from "vitest";

import type { DesktopTask } from "../shared/types";
import { liveRunOfType } from "./liveRun";

function task(id: string, status: DesktopTask["status"], documentType: DesktopTask["documentType"] = "pptx"): DesktopTask {
  return { id, documentType, status, events: [], createdAt: "2026-09-28T00:00:00Z" } as unknown as DesktopTask;
}

describe("liveRunOfType", () => {
  it("picks the newest run that is still going", () => {
    const tasks = { older: task("older", "running"), newer: task("newer", "starting") };
    expect(liveRunOfType(tasks, ["newer", "older"], "pptx")?.id).toBe("newer");
  });

  it("keeps the canvas while a run waits on the user", () => {
    const tasks = { one: task("one", "question") };
    expect(liveRunOfType(tasks, ["one"], "pptx")?.id).toBe("one");
  });

  it("gives the canvas back when the run ends", () => {
    const tasks = { one: task("one", "completed") };
    expect(liveRunOfType(tasks, ["one"], "pptx")).toBeNull();
  });

  /*
   * The case that hid a finished deck. An earlier conversation's run was still
   * blocked on a question; a newer run then generated a deck and opened it —
   * and the canvas stayed on the old run's outline stage instead of the editor.
   */
  it("lets a newer finished run outrank an older run still waiting", () => {
    const tasks = { blocked: task("blocked", "question"), done: task("done", "completed") };
    expect(liveRunOfType(tasks, ["done", "blocked"], "pptx")).toBeNull();
  });

  it("does not let a finished run of another type end the search", () => {
    const tasks = { blocked: task("blocked", "running"), doc: task("doc", "completed", "docx") };
    expect(liveRunOfType(tasks, ["doc", "blocked"], "pptx")?.id).toBe("blocked");
  });

  it("ignores runs of other types", () => {
    const tasks = { one: task("one", "running", "xlsx") };
    expect(liveRunOfType(tasks, ["one"], "pptx")).toBeNull();
  });
});
