import { describe, expect, it } from "vitest";
import type { DesktopTask } from "../shared/types";
import { computeTaskSignals, failedTaskIds, sidebarSignal, taskNotificationBody } from "./taskSignals";

function task(id: string, status: DesktopTask["status"], extra: Partial<DesktopTask> = {}): DesktopTask {
  return { id, conversationId: id, status, events: [], ...extra };
}

describe("task signals", () => {
  it("counts attention, running, and only unacknowledged failures", () => {
    const tasks = [
      task("a", "question"),
      task("b", "plan_review"),
      task("c", "running"),
      task("d", "starting"),
      task("e", "failed"),
      task("f", "failed"),
      task("g", "completed"),
    ];
    expect(computeTaskSignals(tasks, [])).toEqual({ attention: 2, running: 2, unseenFailures: 2 });
    expect(computeTaskSignals(tasks, ["e"])).toEqual({ attention: 2, running: 2, unseenFailures: 1 });
    expect(computeTaskSignals(tasks, ["e", "f"]).unseenFailures).toBe(0);
  });

  it("surfaces the most urgent signal only", () => {
    expect(sidebarSignal({ attention: 1, running: 3, unseenFailures: 5 })).toEqual({ kind: "attention", count: 1 });
    expect(sidebarSignal({ attention: 0, running: 3, unseenFailures: 5 })).toEqual({ kind: "running", count: 3 });
    expect(sidebarSignal({ attention: 0, running: 0, unseenFailures: 5 })).toEqual({ kind: "failed", count: 5 });
    expect(sidebarSignal({ attention: 0, running: 0, unseenFailures: 0 })).toBeUndefined();
  });

  it("acknowledges exactly the failures present at visit time", () => {
    expect(failedTaskIds([task("a", "failed"), task("b", "running"), task("c", "failed")])).toEqual(["a", "c"]);
  });


  it("keeps a failure unseen until it is actually acknowledged", () => {
    // Regression: acknowledgement used to fire on opening settings at all, so
    // changing an unrelated preference silently cleared the red dot.
    const tasks = [task("a", "failed"), task("b", "failed")];
    expect(sidebarSignal(computeTaskSignals(tasks, []))).toEqual({ kind: "failed", count: 2 });
    expect(sidebarSignal(computeTaskSignals(tasks, failedTaskIds(tasks)))).toBeUndefined();
    // A newly failed task lights the dot again even after an earlier ack.
    const withNew = [...tasks, task("c", "failed")];
    expect(sidebarSignal(computeTaskSignals(withNew, failedTaskIds(tasks)))).toEqual({ kind: "failed", count: 1 });
  });

  it("names the task in a notification body when it has one", () => {
    expect(taskNotificationBody(task("a", "completed", { topic: "Q3 review" }), "Generation finished")).toBe("Generation finished · Q3 review");
    expect(taskNotificationBody(
      task("a", "completed", { artifact: { filePath: "/tmp/deck.pptx", fileName: "deck.pptx", documentType: "pptx" } }),
      "Generation finished",
    )).toBe("Generation finished · deck.pptx");
    expect(taskNotificationBody(undefined, "Generation finished")).toBe("Generation finished");
  });
});
