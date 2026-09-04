import { describe, expect, it, vi } from "vitest";
import type { DesktopTask, WorkspaceSummary } from "../../shared/types";
import { createInitialTaskState, type TaskState } from "../taskState";
import { resolveFollowUpTarget, runFollowUpTask, type FollowUpDeps, type PendingGenerate } from "./followUpTask";

const ws = (id: string): WorkspaceSummary => ({ id, path: `/ws/${id}`, name: id } as WorkspaceSummary);
const task = (id: string, workspaceId?: string): DesktopTask => ({ id, conversationId: id, status: "completed", documentType: "pptx", topic: id, events: [], workspaceId } as DesktopTask);

describe("resolveFollowUpTarget", () => {
  it("inherits the parent's workspace", () => {
    const target = resolveFollowUpTarget(task("p", "b"), [ws("a"), ws("b")], ws("a"), "conv");
    expect(target).toEqual({ parentTaskId: "p", targetWorkspace: ws("b"), noProject: false, context: { conversationId: "conv", parentTaskId: "p", workspaceId: "b", workspacePath: "/ws/b" } });
  });

  it("stays outside any project when the parent ran without one", () => {
    const target = resolveFollowUpTarget(task("p"), [ws("a")], ws("a"), "conv");
    expect(target.targetWorkspace).toBeUndefined();
    expect(target.noProject).toBe(true);
    expect(target.context).toEqual({ conversationId: "conv", parentTaskId: "p" });
  });

  it("uses the active workspace only when there is no parent", () => {
    const target = resolveFollowUpTarget(undefined, [ws("a")], ws("a"), undefined);
    expect(target.targetWorkspace).toEqual(ws("a"));
    expect(target.noProject).toBe(false);
    expect(target.parentTaskId).toBeUndefined();
  });
});

function harness() {
  let state: TaskState = createInitialTaskState();
  const shown: string[] = [];
  const deps: FollowUpDeps = {
    pending: new Map<string, PendingGenerate>(),
    setState: (update) => { state = update(state); },
    showTask: (id) => shown.push(id),
    setBusy: vi.fn(),
    recordError: vi.fn(),
    refreshProjectLists: vi.fn(),
    onSettled: vi.fn(),
  };
  return { deps, shown, state: () => state };
}

const plan = {
  localTaskId: "local-1",
  documentType: "pptx",
  topic: "Deck",
  input: { prompt: "Make a deck" },
  target: { parentTaskId: "parent", noProject: false, context: { conversationId: "conv", parentTaskId: "parent" } },
};

describe("runFollowUpTask", () => {
  it("shows the task under its local id and promotes it to the bridge id", async () => {
    const h = harness();
    let seenWhileInFlight: string[] = [];
    await runFollowUpTask(h.deps, plan, async () => {
      seenWhileInFlight = Object.keys(h.state().tasks);
      return { taskId: "task-9" };
    });
    expect(seenWhileInFlight).toEqual(["local-1"]);
    expect(Object.keys(h.state().tasks)).toEqual(["task-9"]);
    // Topic and type arrive with the bridge's own task.started; the promoted
    // entry carries what the user typed and where it belongs.
    expect(h.state().tasks["task-9"]).toMatchObject({ userInput: { prompt: "Make a deck" }, parentTaskId: "parent", conversationId: "conv" });
    expect(h.shown).toEqual(["local-1", "task-9"]);
    expect(h.deps.pending.size).toBe(0);
    expect(h.deps.refreshProjectLists).toHaveBeenCalledTimes(1);
    expect(h.deps.onSettled).toHaveBeenCalledTimes(1);
    expect(h.deps.recordError).not.toHaveBeenCalled();
  });

  it("discards the local task and classifies the failure when the bridge rejects", async () => {
    const h = harness();
    await runFollowUpTask(h.deps, plan, async () => { throw new Error("[kind:auth] login required"); });
    expect(Object.keys(h.state().tasks)).toEqual([]);
    expect(h.deps.recordError).toHaveBeenCalledWith(expect.stringContaining("login required"), "auth", undefined);
    expect(h.deps.onSettled).toHaveBeenCalledTimes(1);
  });

  it("leaves a task alone that was cancelled while the request was in flight", async () => {
    const h = harness();
    await runFollowUpTask(h.deps, plan, async () => {
      h.deps.pending.delete("local-1");
      return { taskId: "task-9" };
    });
    expect(Object.keys(h.state().tasks)).toEqual(["local-1"]);
    expect(h.shown).toEqual(["local-1"]);
    expect(h.deps.refreshProjectLists).not.toHaveBeenCalled();

    const h2 = harness();
    await runFollowUpTask(h2.deps, plan, async () => {
      h2.deps.pending.delete("local-1");
      throw new Error("late failure");
    });
    expect(h2.deps.recordError).not.toHaveBeenCalled();
    expect(h2.deps.onSettled).toHaveBeenCalledTimes(1);
  });
});
