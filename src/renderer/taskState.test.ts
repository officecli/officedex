import { describe, expect, it } from "vitest";
import { applyTaskEvent, attachUserInput, createInitialTaskState, finishTaskContinuing, markTaskContinuing, restoreTaskInteractiveGate } from "./taskState";

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

  it("clears a stranded bridge error when recovered task progress resumes", () => {
    const failed = applyTaskEvent(createInitialTaskState(), {
      event_id: "event-failed",
      task_id: "task-recovered",
      type: "task.failed",
      payload: { code: "BRIDGE_PROCESS_GONE", message: "OfficeCLI agent-bridge was stopped before this task finished." },
    });
    const resumed = applyTaskEvent(failed, {
      event_id: "event-progress",
      task_id: "task-recovered",
      type: "task.progress",
      payload: { step: "generate", status: "running", content: "Generating document content" },
    });

    expect(resumed.tasks["task-recovered"].status).toBe("running");
    expect(resumed.tasks["task-recovered"].error).toBeUndefined();
  });

  it("accumulates ordered PPTX drawing ops from streamed bridge events", () => {
    const state = applyTaskEvent(createInitialTaskState(), {
      event_id: "event-ops-1",
      task_id: "task-ops",
      type: "task.vibe_ops",
      payload: { ops: [{ seq: 2, op: "shape.add", slide: 1 }, { seq: 1, op: "slide.begin", slide: 1 }] },
    });
    const next = applyTaskEvent(state, {
      event_id: "event-ops-2",
      task_id: "task-ops",
      type: "task.vibe_ops",
      payload: { ops: [{ seq: 3, op: "slide.end", slide: 1 }, { seq: 2, op: "shape.add", slide: 1, shape: { kind: "text" } }] },
    });

    expect(next.tasks["task-ops"].vibeOps?.map((op) => op.seq)).toEqual([1, 2, 3]);
    expect(next.tasks["task-ops"].vibeOps?.[1].shape).toEqual({ kind: "text" });
  });

  it("hydrates persisted plan question answers from history replay", () => {
    const withQuestion = applyTaskEvent(createInitialTaskState(), {
      event_id: "event-question",
      task_id: "task-answers",
      type: "task.question",
      payload: {
        id: "question-group",
        question: "Who is the audience?",
        currentIndex: 1,
        questions: [
          {
            id: "q-audience",
            question: "Who is the audience?",
            options: [{ id: "leadership", label: "Leadership" }],
            allowFreeform: false,
          },
          {
            id: "q-context",
            question: "What context should be included?",
            options: [],
            allowFreeform: true,
          },
        ],
      },
    });

    const withAnswers = applyTaskEvent(withQuestion, {
      event_id: "event-answers",
      task_id: "task-answers",
      type: "task.answers",
      payload: {
        answers: [
          { questionId: "q-audience", optionId: "leadership", answer: "Leadership", questionIndex: 0 },
          { questionId: "q-context", answer: "Mention the 2026 launch plan.", questionIndex: 1 },
        ],
      },
    });

    expect(withAnswers.tasks["task-answers"].question?.answers).toEqual([
      { questionId: "q-audience", optionId: "leadership", answer: "Leadership", questionIndex: 0 },
      { questionId: "q-context", answer: "Mention the 2026 launch plan.", questionIndex: 1 },
    ]);
  });

  it("accepts renderer-facing camelCase question payload fields", () => {
    const state = applyTaskEvent(createInitialTaskState(), {
      event_id: "event-1",
      task_id: "task-1",
      type: "task.question",
      payload: {
        id: "question-1",
        question: "Who is this deck for?",
        options: [],
        allowFreeform: true,
      },
    });

    expect(state.tasks["task-1"].question?.allowFreeform).toBe(true);
  });

  it("tracks plan review events before generation continues", () => {
    const state = applyTaskEvent(createInitialTaskState(), {
      event_id: "event-plan",
      task_id: "task-1",
      type: "task.plan",
      payload: {
        id: "plan-1",
        plan_id: "plan-1",
        markdown: "# Proposed Plan\n\n- Confirm before generating.",
        revision: 2,
      },
    });

    expect(state.tasks["task-1"].status).toBe("plan_review");
    expect(state.tasks["task-1"].plan).toEqual({
      id: "plan-1",
      markdown: "# Proposed Plan\n\n- Confirm before generating.",
      revision: 2,
    });
  });

  it("maps native runtime steps by meaning instead of progress event count", () => {
    let state = createInitialTaskState();
    const taskId = "xlsx-semantic-stages";
    const progress = [
      { event_id: "license-running", task_id: taskId, type: "task.progress", payload: { step: "license", status: "running" } },
      { event_id: "license-completed", task_id: taskId, type: "task.progress", payload: { step: "license", status: "completed" } },
      { event_id: "plan-running", task_id: taskId, type: "task.progress", payload: { step: "plan_prepare", status: "running" } },
      { event_id: "plan-completed", task_id: taskId, type: "task.progress", payload: { step: "plan_prepare", status: "completed" } },
      { event_id: "confirm-paused", task_id: taskId, type: "task.progress", payload: { step: "plan_confirm", status: "paused" } },
    ] as const;
    for (const event of progress) state = applyTaskEvent(state, event);

    expect(state.tasks[taskId].stages).toEqual([
      expect.objectContaining({ id: "access", label: "Checking access", status: "completed" }),
      expect.objectContaining({ id: "plan", label: "Preparing execution plan", status: "completed" }),
      expect.objectContaining({ id: "plan-review", label: "Waiting for plan approval", status: "active" }),
    ]);
    expect(state.tasks[taskId].activeStageId).toBe("plan-review");
    expect(state.tasks[taskId].stages?.some((stage) => stage.label === "Formatting & export")).toBe(false);
  });

  it("moves an accepted plan response into running state before bridge events arrive", () => {
    const waiting = applyTaskEvent(createInitialTaskState(), {
      event_id: "event-plan",
      task_id: "task-1",
      type: "task.plan",
      payload: { id: "plan-1", plan_id: "plan-1", markdown: "# Plan", revision: 1 },
    });

    const continuing = markTaskContinuing(waiting, "task-1");

    expect(continuing.tasks["task-1"].status).toBe("running");
    expect(continuing.tasks["task-1"].plan?.id).toBe("plan-1");
    expect(continuing.tasks["task-1"].interactiveResponsePending).toBe(true);
  });

  it("hides recovery replay gates until the interactive response finishes", () => {
    let state = applyTaskEvent(createInitialTaskState(), {
      event_id: "event-plan-1",
      task_id: "task-1",
      type: "task.plan",
      payload: { id: "plan-1", plan_id: "plan-1", markdown: "# Plan", revision: 1 },
    });
    state = markTaskContinuing(state, "task-1");
    state = applyTaskEvent(state, {
      event_id: "event-replayed-plan",
      task_id: "task-1",
      type: "task.plan",
      payload: { id: "plan-2", plan_id: "plan-2", markdown: "# Replayed plan", revision: 1 },
    });

    expect(state.tasks["task-1"].status).toBe("running");
    expect(state.tasks["task-1"].plan?.id).toBe("plan-2");
    expect(state.tasks["task-1"].interactiveResponsePending).toBe(true);

    state = finishTaskContinuing(state, "task-1");
    expect(state.tasks["task-1"].status).toBe("running");
    expect(state.tasks["task-1"].interactiveResponsePending).toBe(true);
    expect(state.tasks["task-1"].interactiveResponseAccepted).toBe(true);

    state = applyTaskEvent(state, {
      event_id: "event-replayed-plan-after-accept",
      task_id: "task-1",
      type: "task.plan",
      payload: { id: "plan-3", plan_id: "plan-3", markdown: "# Final replayed plan", revision: 1 },
    });
    expect(state.tasks["task-1"].status).toBe("running");
    expect(state.tasks["task-1"].interactiveResponsePending).toBe(true);

    state = applyTaskEvent(state, {
      event_id: "event-generate",
      task_id: "task-1",
      type: "task.progress",
      payload: { step: "generate", status: "running" },
    });
    expect(state.tasks["task-1"].status).toBe("running");
    expect(state.tasks["task-1"].interactiveResponsePending).toBeUndefined();
    expect(state.tasks["task-1"].interactiveResponseAccepted).toBeUndefined();
  });

  it("restores the original gate when responding fails", () => {
    let state = applyTaskEvent(createInitialTaskState(), {
      event_id: "event-plan",
      task_id: "task-1",
      type: "task.plan",
      payload: { id: "plan-1", plan_id: "plan-1", markdown: "# Plan", revision: 1 },
    });
    state = markTaskContinuing(state, "task-1");
    state = restoreTaskInteractiveGate(state, "task-1", "plan_review");

    expect(state.tasks["task-1"].status).toBe("plan_review");
    expect(state.tasks["task-1"].interactiveResponsePending).toBeUndefined();
    expect(state.tasks["task-1"].interactiveResponseAccepted).toBeUndefined();
  });

  it("preserves execution_prompt when restoring plan review events", () => {
    const state = applyTaskEvent(createInitialTaskState(), {
      event_id: "event-plan",
      task_id: "task-1",
      type: "task.plan",
      payload: {
        id: "plan-1",
        plan_id: "plan-1",
        plan_markdown: "# Proposed Plan\n\n- Confirm before generating.",
        execution_prompt: "Generate the PPT only after the restored plan is approved.",
        revision: 2,
      },
    });

    expect(state.tasks["task-1"].status).toBe("plan_review");
    expect(state.tasks["task-1"].plan).toEqual({
      id: "plan-1",
      markdown: "# Proposed Plan\n\n- Confirm before generating.",
      revision: 2,
      executionPrompt: "Generate the PPT only after the restored plan is approved.",
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

  it("captures image watermark metadata from task.completed payload", () => {
    const state = applyTaskEvent(createInitialTaskState(), {
      event_id: "event-watermark",
      task_id: "task-img",
      type: "task.completed",
      payload: {
        result: { file_path: "/tmp/banner.png", file_name: "banner.png", document_type: "img" },
        image_watermark: {
          applied: true,
          paidEntitlement: false,
          canDisable: false,
        },
      },
    });
    expect(state.tasks["task-img"].imageWatermark).toEqual({
      applied: true,
      paidEntitlement: false,
      canDisable: false,
    });
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

  it("normalizes legacy fast generation mode from task.user_input to plan without treating it as runtime mode", () => {
    const state = applyTaskEvent(createInitialTaskState(), {
      event_id: "ev-user-input",
      task_id: "task-plan",
      type: "task.user_input",
      payload: {
        prompt: "Write a plan-mode memo",
        generation_mode: "fast",
        runtime_mode: "hosted",
      },
    });
    expect(state.tasks["task-plan"].userInput).toEqual({
      prompt: "Write a plan-mode memo",
      generationMode: "plan",
      sourceFile: undefined,
      referenceImages: undefined,
      imageRatio: undefined,
      fps: undefined,
    });
    expect(state.tasks["task-plan"].userInput).not.toHaveProperty("runtimeMode");
  });

  it("stores Vibe tree confirmation metadata from bridge events", () => {
    const state = applyTaskEvent(createInitialTaskState(), {
      event_id: "ev-vibe",
      task_id: "task-vibe",
      type: "task.vibe_tree",
      payload: {
        stage: "slides_ready",
        tree: {
          id: "tree-1",
          rootId: "root",
          title: "Confirmation Test",
          nodes: [
            { id: "root", kind: "root", title: "Confirmation Test" },
            { id: "slide-outline-01", parentId: "root", kind: "slide", title: "Slide 1" },
          ],
        },
        actions: [{ id: "export_pptx", label: "Generate PPTX" }],
        confirmation: { nodeIds: ["slide-outline-01"] },
      },
    });

    expect(state.tasks["task-vibe"].vibeTree).toMatchObject({
      stage: "slides_ready",
      confirmation: { nodeIds: ["slide-outline-01"] },
    });
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
  });

  it("replays demo staged PPTX events into a completed PPTist-reviewable task", () => {
    let state = createInitialTaskState();
    const taskId = "demo-task";
    const events = [
      { task_id: taskId, type: "task.started", payload: { document_type: "pptx", topic: "Launch strategy", stage_id: "idea", stage_label: "Idea" } },
      { task_id: taskId, type: "task.question", payload: { id: "demo-confirm-idea", question: "Confirm the idea", options: [{ id: "confirm", label: "Approve" }] } },
      { task_id: taskId, type: "task.vibe_tree", payload: { stage: "outline", tree: { id: "demo-tree", rootId: "root", title: "Launch Strategy", nodes: [{ id: "root", title: "Launch Strategy", summary: "Demo", kind: "idea" }] } } },
      { task_id: taskId, type: "task.vibe_slide", payload: { index: 5, slide: { id: "demo-slide-06", elements: [{ id: "title", type: "text", left: 0, top: 0, width: 100, height: 40, content: "<p>90-Day Launch Timeline</p>" }] } } },
      { task_id: taskId, type: "task.completed", payload: { result: { file_path: "/tmp/launch-strategy-demo.pptx", file_name: "launch-strategy-demo.pptx", document_type: "pptx" } } },
    ] as const;
    for (const event of events) state = applyTaskEvent(state, event);
    const task = state.tasks[taskId];
    expect(task.status).toBe("completed");
    expect(task.documentType).toBe("pptx");
    expect(task.artifact?.fileName).toBe("launch-strategy-demo.pptx");
    expect(task.vibeSlides?.[5]?.id).toBe("demo-slide-06");
  });

  it("stores a structured vibe outline event for chapter-first rendering", () => {
    const state = applyTaskEvent(createInitialTaskState(), {
      task_id: "outline-task",
      type: "task.vibe_outline",
      payload: { outline: { sections: [{ id: "s1", title: "背景与问题", purpose: "说明现状" }] } },
    });
    expect(state.tasks["outline-task"].vibeOutline).toEqual({
      sections: [{ id: "s1", title: "背景与问题", purpose: "说明现状" }],
    });
  });
});
