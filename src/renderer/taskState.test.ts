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
});
