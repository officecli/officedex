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

  it("captures runtime_mode from task.started payload", () => {
    const externalStart = applyTaskEvent(createInitialTaskState(), {
      event_id: "ev-e1",
      task_id: "task-ext",
      type: "task.started",
      payload: { runtime_mode: "external", topic: "demo" },
    });
    expect(externalStart.tasks["task-ext"].runtimeMode).toBe("external");

    const hostedStart = applyTaskEvent(createInitialTaskState(), {
      event_id: "ev-h1",
      task_id: "task-hos",
      type: "task.started",
      payload: { runtime_mode: "hosted" },
    });
    expect(hostedStart.tasks["task-hos"].runtimeMode).toBe("hosted");

    const noMode = applyTaskEvent(createInitialTaskState(), {
      event_id: "ev-x1",
      task_id: "task-x",
      type: "task.started",
      payload: { topic: "no mode" },
    });
    expect(noMode.tasks["task-x"].runtimeMode).toBeUndefined();
  });

  it("builds runtimeSnapshot with provider from task.started payload", () => {
    const state = applyTaskEvent(createInitialTaskState(), {
      event_id: "ev-snap",
      task_id: "task-snap",
      type: "task.started",
      payload: {
        runtime_mode: "external",
        runtime_provider: {
          type: "openai",
          base_url_host: "https://api.openai.com",
          model: "gpt-4o-mini",
          api_key_masked: "sk-ab••••wxyz",
          api_key_length: 43,
        },
        runtime_applied_at: "2026-05-25T10:00:00Z",
      },
    });
    const task = state.tasks["task-snap"];
    expect(task.runtimeSnapshot).toBeDefined();
    expect(task.runtimeSnapshot!.mode).toBe("external");
    expect(task.runtimeSnapshot!.appliedAt).toBe("2026-05-25T10:00:00Z");
    expect(task.runtimeSnapshot!.provider).toEqual({
      type: "openai",
      baseUrlHost: "https://api.openai.com",
      model: "gpt-4o-mini",
      apiKeyMasked: "sk-ab••••wxyz",
      apiKeyLength: 43,
    });
  });

  it("builds hosted runtimeSnapshot without provider", () => {
    const state = applyTaskEvent(createInitialTaskState(), {
      event_id: "ev-hosted",
      task_id: "task-hosted",
      type: "task.started",
      payload: { runtime_mode: "hosted" },
    });
    const task = state.tasks["task-hosted"];
    expect(task.runtimeSnapshot).toBeDefined();
    expect(task.runtimeSnapshot!.mode).toBe("hosted");
    expect(task.runtimeSnapshot!.provider).toBeUndefined();
  });
});
