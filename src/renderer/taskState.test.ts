import { describe, expect, it } from "vitest";
import { applyTaskEvent, createInitialTaskState } from "./taskState";

describe("taskState", () => {
  it("records task lifecycle events and stores completed artifacts", () => {
    const state = createInitialTaskState();
    const started = applyTaskEvent(state, {
      event_id: "event-1",
      task_id: "task-1",
      type: "task.started",
      payload: { document_type: "pptx", topic: "Q3 Review" },
    });
    const completed = applyTaskEvent(started, {
      event_id: "event-2",
      task_id: "task-1",
      type: "task.completed",
      payload: {
        result: {
          file_path: "/tmp/Q3 Review.pptx",
          file_name: "Q3 Review.pptx",
          document_type: "pptx",
        },
      },
    });

    expect(completed.tasks["task-1"].status).toBe("completed");
    expect(completed.tasks["task-1"].events).toHaveLength(2);
    expect(completed.artifacts).toEqual([
      {
        taskId: "task-1",
        filePath: "/tmp/Q3 Review.pptx",
        fileName: "Q3 Review.pptx",
        documentType: "pptx",
      },
    ]);
  });

  it("tracks active questions for interactive bridge tasks", () => {
    const state = applyTaskEvent(createInitialTaskState(), {
      event_id: "event-1",
      task_id: "task-1",
      type: "task.question",
      payload: {
        id: "question-1",
        question: "Who is the audience?",
        options: [{ id: "leadership", label: "Leadership" }],
        allow_freeform: true,
      },
    });

    expect(state.tasks["task-1"].question).toEqual({
      id: "question-1",
      question: "Who is the audience?",
      options: [{ id: "leadership", label: "Leadership" }],
      allowFreeform: true,
    });
  });

  it("captures credits_charged and credit_mode from task.completed payload", () => {
    const state = applyTaskEvent(createInitialTaskState(), {
      event_id: "event-1",
      task_id: "task-1",
      type: "task.completed",
      payload: {
        credits_charged: 5,
        credit_mode: "hosted",
      },
    });
    expect(state.tasks["task-1"].creditCharged).toBe(5);
    expect(state.tasks["task-1"].creditMode).toBe("hosted");
  });

  it("captures credits on task.failed payload (zero allowed)", () => {
    const state = applyTaskEvent(createInitialTaskState(), {
      event_id: "event-1",
      task_id: "task-1",
      type: "task.failed",
      payload: {
        credits_charged: 0,
        credit_mode: "anonymous",
      },
    });
    expect(state.tasks["task-1"].creditCharged).toBe(0);
    expect(state.tasks["task-1"].creditMode).toBe("anonymous");
  });

  it("leaves credit fields undefined when payload lacks credits_charged (legacy binary)", () => {
    const state = applyTaskEvent(createInitialTaskState(), {
      event_id: "event-1",
      task_id: "task-1",
      type: "task.completed",
      payload: {
        result: { file_path: "/tmp/x.pptx", file_name: "x.pptx", document_type: "pptx" },
      },
    });
    expect(state.tasks["task-1"].creditCharged).toBeUndefined();
    expect(state.tasks["task-1"].creditMode).toBeUndefined();
  });

  it("ignores non-numeric credits_charged values", () => {
    const state = applyTaskEvent(createInitialTaskState(), {
      event_id: "event-1",
      task_id: "task-1",
      type: "task.completed",
      payload: {
        credits_charged: "5",
        credit_mode: "hosted",
      },
    });
    expect(state.tasks["task-1"].creditCharged).toBeUndefined();
    expect(state.tasks["task-1"].creditMode).toBeUndefined();
  });
});
