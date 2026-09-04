import { describe, expect, it } from "vitest";
import type { DesktopTask } from "../shared/types";
import { STALL_THRESHOLD_MS, lastActivityAt, markStalledTasks } from "./stallDetector";
import type { TaskState } from "./taskState";

const NOW = 1_700_000_000_000;

function task(id: string, extra: Partial<DesktopTask> = {}): DesktopTask {
  return {
    id,
    status: "running",
    events: [],
    ...extra,
  } as DesktopTask;
}

function stateOf(...tasks: DesktopTask[]): TaskState {
  return {
    tasks: Object.fromEntries(tasks.map((t) => [t.id, t])),
    taskOrder: tasks.map((t) => t.id),
    artifacts: [],
  };
}

describe("markStalledTasks", () => {
  it("marks a running task whose last progress is older than the threshold", () => {
    const state = stateOf(task("a", { lastProgressAt: NOW - STALL_THRESHOLD_MS - 1 }));
    const next = markStalledTasks(state, NOW);
    expect(next).not.toBe(state);
    expect(next.tasks.a.stalledSince).toBe(NOW);
  });

  it("leaves a task alone while it is still inside the threshold", () => {
    const state = stateOf(task("a", { lastProgressAt: NOW - STALL_THRESHOLD_MS }));
    expect(markStalledTasks(state, NOW)).toBe(state);
  });

  it("falls back to the first event timestamp before any progress arrived", () => {
    const started = new Date(NOW - STALL_THRESHOLD_MS - 5_000).toISOString();
    const state = stateOf(task("a", { events: [{ type: "task.started", ts: started } as DesktopTask["events"][number]] }));
    expect(markStalledTasks(state, NOW).tasks.a.stalledSince).toBe(NOW);
  });

  it("ignores tasks that are not running and tasks with no activity signal", () => {
    const state = stateOf(
      task("done", { status: "completed", lastProgressAt: NOW - 10 * STALL_THRESHOLD_MS }),
      task("silent"),
    );
    expect(markStalledTasks(state, NOW)).toBe(state);
  });

  it("keeps the original stalledSince once a task is marked", () => {
    const state = stateOf(task("a", { lastProgressAt: NOW - 2 * STALL_THRESHOLD_MS, stalledSince: NOW - 1000 }));
    expect(markStalledTasks(state, NOW)).toBe(state);
    expect(state.tasks.a.stalledSince).toBe(NOW - 1000);
  });

  it("does not mutate the input state", () => {
    const original = task("a", { lastProgressAt: NOW - 2 * STALL_THRESHOLD_MS });
    const state = stateOf(original);
    markStalledTasks(state, NOW);
    expect(original.stalledSince).toBeUndefined();
    expect(state.tasks.a).toBe(original);
  });
});

describe("lastActivityAt", () => {
  it("prefers lastProgressAt over the first event", () => {
    expect(lastActivityAt(task("a", { lastProgressAt: 42, events: [{ ts: "2020-01-01T00:00:00Z" } as DesktopTask["events"][number]] }))).toBe(42);
  });

  it("returns undefined for an unparseable first event timestamp", () => {
    expect(lastActivityAt(task("a", { events: [{ ts: "not a date" } as DesktopTask["events"][number]] }))).toBeUndefined();
  });
});
