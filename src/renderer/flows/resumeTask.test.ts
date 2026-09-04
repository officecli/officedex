import { describe, expect, it, vi } from "vitest";
import type { DesktopTask, TaskHistoryEntry } from "../../shared/types";
import { applyTaskEvent, createInitialTaskState, type TaskState } from "../taskState";
import { isGateAlreadyConsumed, latestQuestionEventId, planApprovalAnswer, resumeInteractiveTask } from "./resumeTask";

function stateWith(task: DesktopTask): { get: () => TaskState; setState: (u: (s: TaskState) => TaskState) => void } {
  let state: TaskState = { ...createInitialTaskState(), tasks: { [task.id]: task }, taskOrder: [task.id] };
  return { get: () => state, setState: (update) => { state = update(state); } };
}

const planTask: DesktopTask = {
  id: "task-plan", conversationId: "task-plan", status: "plan_review", documentType: "pptx", topic: "Deck",
  events: [], plan: { id: "plan-1", markdown: "# Plan", revision: 1 },
};
const questionTask: DesktopTask = {
  id: "task-q", conversationId: "task-q", status: "question", documentType: "docx", topic: "Doc",
  events: [
    { event_id: "e1", task_id: "task-q", type: "task.question", ts: "", payload: { id: "question-old" } },
    { event_id: "e2", task_id: "task-q", type: "task.question", ts: "", payload: { id: "question-new" } },
  ],
  question: { id: "question-new" } as never,
};

describe("planApprovalAnswer", () => {
  it("is empty when the plan is approved as proposed", () => {
    expect(planApprovalAnswer(undefined)).toBe("");
    expect(planApprovalAnswer([])).toBe("");
  });

  it("numbers slides from the outline order unless a section carries its own", () => {
    const answer = JSON.parse(planApprovalAnswer([
      { id: "a", title: "Intro", detail: "why" },
      { id: "b", title: "Body", estimatedSlides: 3, slide: 7 },
    ]));
    expect(answer).toEqual({ sections: [
      { id: "a", slide: 1, title: "Intro", purpose: "why" },
      { id: "b", slide: 7, title: "Body", estimatedSlides: 3 },
    ] });
  });
});

describe("isGateAlreadyConsumed", () => {
  it("decides by the bridge's code, never by the sentence", () => {
    expect(isGateAlreadyConsumed("[code:no_pending_input] task t-1: has no pending input")).toBe(true);
    expect(isGateAlreadyConsumed("[kind:task] [code:no_pending_input] anything")).toBe(true);
    expect(isGateAlreadyConsumed("task has no pending input")).toBe(false);
    expect(isGateAlreadyConsumed("[code:task_not_found] task not found")).toBe(false);
  });
});

describe("latestQuestionEventId", () => {
  it("reads the newest task.question event", () => {
    expect(latestQuestionEventId(questionTask)).toBe("question-new");
    expect(latestQuestionEventId(planTask)).toBeUndefined();
  });
});

describe("resumeInteractiveTask", () => {
  it("approves a plan through the typed option and then follows the history", async () => {
    const respond = vi.fn(async () => ({}));
    const getTaskHistory = vi.fn(async (): Promise<TaskHistoryEntry[]> => []);
    const poll = vi.fn(async () => true);
    const store = stateWith(planTask);
    await resumeInteractiveTask({ task: planTask, outline: [{ id: "a", title: "Intro" }] }, { api: { respond, getTaskHistory }, setState: store.setState, poll });
    expect(respond).toHaveBeenCalledWith({ taskId: "task-plan", questionId: "plan-1", optionId: "approve", answer: planApprovalAnswer([{ id: "a", title: "Intro" }]) });
    // The RPC was accepted; the gate stays hidden until a durable event moves past it.
    expect(store.get().tasks["task-plan"]).toMatchObject({ status: "running", interactiveResponsePending: true, interactiveResponseAccepted: true });
    expect(poll).toHaveBeenCalledWith("task-plan", expect.any(Function), expect.any(Function), { intervalMs: 1_000, maxAttempts: 30 });
  });

  it("sends an explicit answer against the newest question id when the answer names none", async () => {
    const respond = vi.fn(async () => ({}));
    const store = stateWith(questionTask);
    await resumeInteractiveTask(
      { task: questionTask, questionAnswer: { questionId: "", answer: "B", optionId: "opt-b" } },
      { api: { respond, getTaskHistory: vi.fn(async () => []) }, setState: store.setState, poll: vi.fn(async () => true) },
    );
    expect(respond).toHaveBeenCalledWith({ taskId: "task-q", questionId: "question-new", answer: "B", optionId: "opt-b" });
  });

  it("treats a consumed gate as success and pulls the durable history once", async () => {
    const respond = vi.fn(async () => { throw new Error("[code:no_pending_input] task task-q: has no pending input"); });
    const completed = { event_id: "e9", task_id: "task-q", type: "task.completed", ts: "", payload: {} };
    const getTaskHistory = vi.fn(async (): Promise<TaskHistoryEntry[]> => [{ taskId: "task-q", events: [completed] } as TaskHistoryEntry]);
    const poll = vi.fn(async () => true);
    const store = stateWith(questionTask);
    await resumeInteractiveTask({ task: questionTask }, { api: { respond, getTaskHistory }, setState: store.setState, poll });
    expect(poll).not.toHaveBeenCalled();
    expect(getTaskHistory).toHaveBeenCalledTimes(1);
    expect(store.get().tasks["task-q"].status).toBe(applyTaskEvent(store.get(), completed).tasks["task-q"].status);
    expect(store.get().tasks["task-q"].status).toBe("completed");
  });

  it("restores the gate and rethrows any other failure", async () => {
    const respond = vi.fn(async () => { throw new Error("bridge is gone"); });
    const store = stateWith(planTask);
    await expect(resumeInteractiveTask({ task: planTask }, { api: { respond, getTaskHistory: vi.fn(async () => []) }, setState: store.setState, poll: vi.fn(async () => true) }))
      .rejects.toThrow("bridge is gone");
    const task = store.get().tasks["task-plan"];
    expect(task.status).toBe("plan_review");
    expect(task.interactiveResponsePending).toBeFalsy();
  });
});
