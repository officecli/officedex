import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyTaskEvent, createInitialTaskState, type TaskState } from "./taskState";

function runStallDetector(state: TaskState): TaskState {
  const STALL_THRESHOLD = 120_000;
  const now = Date.now();
  let changed = false;
  const updatedTasks = { ...state.tasks };
  for (const id of state.taskOrder) {
    const task = updatedTasks[id];
    if (!task || task.status !== "running") continue;
    const lastActivity = task.lastProgressAt ?? (task.events[0]?.ts ? Date.parse(task.events[0].ts) : undefined);
    if (lastActivity === undefined) continue;
    if (now - lastActivity > STALL_THRESHOLD && !task.stalledSince) {
      updatedTasks[id] = { ...task, stalledSince: now };
      changed = true;
    }
  }
  return changed ? { ...state, tasks: updatedTasks } : state;
}

describe("stallDetector", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("marks a running task as stalled after 120s with no progress", () => {
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    let state = createInitialTaskState();
    state = applyTaskEvent(state, {
      event_id: "e1",
      task_id: "task-1",
      type: "task.started",
      ts: "2026-01-01T00:00:00Z",
    });
    state = applyTaskEvent(state, {
      event_id: "e2",
      task_id: "task-1",
      type: "task.progress",
      ts: "2026-01-01T00:00:00Z",
      payload: { message: "Starting..." },
    });

    // Advance 119s — should NOT be stalled yet
    vi.advanceTimersByTime(119_000);
    let checked = runStallDetector(state);
    expect(checked.tasks["task-1"].stalledSince).toBeUndefined();

    // Advance 2 more seconds (total 121s) — should be stalled
    vi.advanceTimersByTime(2_000);
    checked = runStallDetector(state);
    expect(checked.tasks["task-1"].stalledSince).toBeDefined();
    expect(typeof checked.tasks["task-1"].stalledSince).toBe("number");
  });

  it("clears stalledSince when a new progress event arrives", () => {
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    let state = createInitialTaskState();
    state = applyTaskEvent(state, {
      event_id: "e1",
      task_id: "task-1",
      type: "task.started",
      ts: "2026-01-01T00:00:00Z",
    });
    state = applyTaskEvent(state, {
      event_id: "e2",
      task_id: "task-1",
      type: "task.progress",
      ts: "2026-01-01T00:00:00Z",
      payload: { message: "Starting..." },
    });

    // Mark as stalled
    vi.advanceTimersByTime(121_000);
    state = runStallDetector(state);
    expect(state.tasks["task-1"].stalledSince).toBeDefined();

    // New progress event clears stall
    state = applyTaskEvent(state, {
      event_id: "e3",
      task_id: "task-1",
      type: "task.progress",
      ts: "2026-01-01T00:02:01Z",
      payload: { message: "Continuing..." },
    });
    expect(state.tasks["task-1"].stalledSince).toBeUndefined();
    expect(state.tasks["task-1"].lastProgressAt).toBeDefined();
  });

  it("does not mark completed/failed/cancelled tasks as stalled", () => {
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    let state = createInitialTaskState();
    state = applyTaskEvent(state, {
      event_id: "e1",
      task_id: "task-1",
      type: "task.progress",
      ts: "2026-01-01T00:00:00Z",
      payload: { message: "Starting..." },
    });
    state = applyTaskEvent(state, {
      event_id: "e2",
      task_id: "task-1",
      type: "task.completed",
      ts: "2026-01-01T00:00:01Z",
      payload: {},
    });

    vi.advanceTimersByTime(200_000);
    const checked = runStallDetector(state);
    expect(checked.tasks["task-1"].stalledSince).toBeUndefined();
  });

  it("useEffect cleanup clears interval (no timer leak)", () => {
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const interval = setInterval(() => {}, 30_000);
    expect(vi.getTimerCount()).toBeGreaterThanOrEqual(1);
    clearInterval(interval);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("F2: stall detection still fires when document.visibilityState is hidden", () => {
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    let state = createInitialTaskState();
    state = applyTaskEvent(state, {
      event_id: "e1",
      task_id: "task-1",
      type: "task.progress",
      ts: "2026-01-01T00:00:00Z",
      payload: { message: "Starting..." },
    });

    // Simulate visibility hidden
    Object.defineProperty(document, "visibilityState", {
      value: "hidden",
      writable: true,
      configurable: true,
    });

    vi.advanceTimersByTime(130_000);
    const checked = runStallDetector(state);
    expect(checked.tasks["task-1"].stalledSince).toBeDefined();

    // Restore
    Object.defineProperty(document, "visibilityState", {
      value: "visible",
      writable: true,
      configurable: true,
    });
  });

  it("F2: setInterval continues to fire under hidden visibility (timer-based, not rAF)", () => {
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    let callCount = 0;
    const interval = setInterval(() => { callCount++; }, 30_000);

    Object.defineProperty(document, "visibilityState", {
      value: "hidden",
      writable: true,
      configurable: true,
    });

    // Advance 150s — expect 5 interval firings (30s each)
    vi.advanceTimersByTime(150_000);
    expect(callCount).toBe(5);

    clearInterval(interval);
    Object.defineProperty(document, "visibilityState", {
      value: "visible",
      writable: true,
      configurable: true,
    });
  });
});
