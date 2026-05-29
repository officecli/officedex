import { describe, expect, it } from "vitest";
import { applyTaskEvent, attachUserInput, createInitialTaskState, deleteConversation, getConversationList } from "./taskState";

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

  it("stores completed artifacts from OfficeCLI top-level result payloads", () => {
    const state = applyTaskEvent(createInitialTaskState(), {
      event_id: "event-1",
      task_id: "task-1",
      type: "task.completed",
      payload: {
        file_path: "/tmp/Request_123_Business_Brief.docx",
        document_name: "Request_123_Business_Brief.docx",
        document_type: "docx",
        status: "success",
      },
    });

    expect(state.tasks["task-1"].artifact).toEqual({
      taskId: "task-1",
      filePath: "/tmp/Request_123_Business_Brief.docx",
      fileName: "Request_123_Business_Brief.docx",
      documentType: "docx",
    });
    expect(state.artifacts).toEqual([
      {
        taskId: "task-1",
        filePath: "/tmp/Request_123_Business_Brief.docx",
        fileName: "Request_123_Business_Brief.docx",
        documentType: "docx",
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

  it("captures runtimeSnapshot from task.started payload", () => {
    const state = applyTaskEvent(createInitialTaskState(), {
      event_id: "ev-e1",
      task_id: "task-ext",
      type: "task.started",
      payload: { runtime_mode: "custom", topic: "demo" },
    });
    expect(state.tasks["task-ext"].runtimeSnapshot).toBeDefined();
    expect(state.tasks["task-ext"].runtimeSnapshot!.mode).toBe("custom");

    const hostedState = applyTaskEvent(createInitialTaskState(), {
      event_id: "ev-h1",
      task_id: "task-hos",
      type: "task.started",
      payload: { runtime_mode: "hosted" },
    });
    expect(hostedState.tasks["task-hos"].runtimeSnapshot).toBeDefined();
    expect(hostedState.tasks["task-hos"].runtimeSnapshot!.mode).toBe("hosted");

    const noMode = applyTaskEvent(createInitialTaskState(), {
      event_id: "ev-x1",
      task_id: "task-x",
      type: "task.started",
      payload: { topic: "no mode" },
    });
    expect(noMode.tasks["task-x"].runtimeSnapshot).toBeUndefined();
  });

  it("builds runtimeSnapshot with provider details from task.started payload", () => {
    const state = applyTaskEvent(createInitialTaskState(), {
      event_id: "ev-snap",
      task_id: "task-snap",
      type: "task.started",
      payload: {
        runtime_mode: "custom",
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
    expect(task.runtimeSnapshot!.mode).toBe("custom");
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

  it("groups multiple tasks in one conversation into one conversation list item", () => {
    let state = createInitialTaskState();
    state = applyTaskEvent(state, {
      event_id: "ev-1",
      task_id: "task-1",
      type: "task.completed",
      payload: {
        result: { file_path: "/tmp/original.png", file_name: "original.png", document_type: "img" },
      },
    });
    state = attachUserInput(state, "task-2", { prompt: "Make it brighter" }, "task-1");
    state = applyTaskEvent(state, {
      event_id: "ev-2",
      task_id: "task-2",
      type: "task.started",
      payload: { document_type: "img", topic: "Make it brighter" },
    });

    expect(getConversationList(state)).toEqual([
      {
        conversationId: "task-1",
        firstTaskId: "task-1",
        latestTaskId: "task-2",
        title: "original.png",
        status: "running",
        documentType: "img",
      },
    ]);
  });

  it("deletes all tasks and artifacts in a conversation", () => {
    let state = createInitialTaskState();
    state = applyTaskEvent(state, {
      event_id: "ev-1",
      task_id: "task-1",
      type: "task.completed",
      payload: {
        result: { file_path: "/tmp/original.png", file_name: "original.png", document_type: "img" },
      },
    });
    state = attachUserInput(state, "task-2", { prompt: "Make it brighter" }, "task-1");
    state = applyTaskEvent(state, {
      event_id: "ev-2",
      task_id: "task-2",
      type: "task.completed",
      payload: {
        result: { file_path: "/tmp/brighter.png", file_name: "brighter.png", document_type: "img" },
      },
    });
    state = applyTaskEvent(state, {
      event_id: "ev-3",
      task_id: "task-other",
      type: "task.completed",
      payload: {
        result: { file_path: "/tmp/other.pptx", file_name: "other.pptx", document_type: "pptx" },
      },
    });

    const next = deleteConversation(state, "task-1");

    expect(Object.keys(next.tasks)).toEqual(["task-other"]);
    expect(next.taskOrder).toEqual(["task-other"]);
    expect(next.artifacts).toEqual([
      {
        taskId: "task-other",
        filePath: "/tmp/other.pptx",
        fileName: "other.pptx",
        documentType: "pptx",
      },
    ]);
  });

  it("overrides a bridge-created conversation id when continuation parent is attached after task.started", () => {
    let state = createInitialTaskState();
    state = applyTaskEvent(state, {
      event_id: "ev-1",
      task_id: "task-1",
      type: "task.completed",
      payload: {
        result: { file_path: "/tmp/original.png", file_name: "original.png", document_type: "img" },
      },
    });
    state = applyTaskEvent(state, {
      event_id: "ev-2",
      task_id: "task-2",
      type: "task.started",
      payload: { document_type: "img", topic: "Make it brighter" },
    });

    state = attachUserInput(state, "task-2", { prompt: "Make it brighter" }, "task-1");

    expect(state.tasks["task-2"].conversationId).toBe("task-1");
    expect(getConversationList(state)).toHaveLength(1);
  });
});
