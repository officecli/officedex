import type { Artifact, BridgeEvent, DesktopTask, GenerationMode, ImageRatio, ProviderSnapshot, StageState, TaskPlan, TaskQuestion, TaskQuestionAnswer, TaskRuntimeSnapshot, TaskUserInput, VibeOp, VibeProjectTreeNode, VibeTreeAction, VibeTreeConfirmation, VibeTreeSnapshot, VibeTreeStage, VibeVisualAsset } from "../shared/types";
import type { PptistSlide } from "../shared/pptxWire";

export interface TaskState {
  tasks: Record<string, DesktopTask>;
  taskOrder: string[];
  artifacts: Artifact[];
}

export interface TaskContextPatch {
  createdAt?: string;
  conversationId?: string;
  parentTaskId?: string;
  workspaceId?: string;
  workspacePath?: string;
}

export function createInitialTaskState(): TaskState {
  return { tasks: {}, taskOrder: [], artifacts: [] };
}

export function deleteTask(state: TaskState, taskID: string): TaskState {
  const { [taskID]: _, ...tasks } = state.tasks;
  const taskOrder = state.taskOrder.filter((id) => id !== taskID);
  const artifacts = state.artifacts.filter((a) => a.taskId !== taskID);
  return { tasks, taskOrder, artifacts };
}

export function attachUserInput(
  state: TaskState,
  taskID: string,
  input: TaskUserInput,
  parentTaskId?: string,
  context?: TaskContextPatch,
): TaskState {
  const parentTask = parentTaskId ? state.tasks[parentTaskId] : undefined;
  const previous = state.tasks[taskID];
  const conversationId = context?.conversationId || (parentTask ? parentTask.conversationId : previous?.conversationId || taskID);
  const workspaceId = context?.workspaceId || parentTask?.workspaceId || previous?.workspaceId;
  const workspacePath = context?.workspacePath || parentTask?.workspacePath || previous?.workspacePath;
  const existing = previous || {
    id: taskID,
    conversationId,
    workspaceId,
    workspacePath,
    status: "starting" as const,
    events: [],
  };
  const tasks = {
    ...state.tasks,
    [taskID]: {
      ...existing,
      createdAt: context?.createdAt || existing.createdAt,
      conversationId,
      workspaceId,
      workspacePath,
      parentTaskId: parentTaskId || context?.parentTaskId || previous?.parentTaskId,
      userInput: input,
    },
  };
  const taskOrder = state.taskOrder.includes(taskID) ? state.taskOrder : [taskID, ...state.taskOrder];
  return { ...state, tasks, taskOrder };
}

export function attachTaskContext(state: TaskState, taskID: string, context: TaskContextPatch): TaskState {
  const previous = state.tasks[taskID];
  if (!previous) return state;
  const tasks = {
    ...state.tasks,
    [taskID]: {
      ...previous,
      createdAt: context.createdAt || previous.createdAt,
      conversationId: context.conversationId || previous.conversationId,
      parentTaskId: context.parentTaskId || previous.parentTaskId,
      workspaceId: context.workspaceId || previous.workspaceId,
      workspacePath: context.workspacePath || previous.workspacePath,
    },
  };
  return { ...state, tasks };
}

/** Group runs by their internal lineage key and return them oldest-first. */
export function getRunLineage(state: TaskState, lineageId: string): DesktopTask[] {
  return state.taskOrder
    .map((id) => state.tasks[id])
    .filter((task): task is DesktopTask => Boolean(task) && task.conversationId === lineageId)
    .reverse(); // taskOrder is newest-first.
}

function vibeOpsFromPayload(payload: Record<string, any>): VibeOp[] {
  const raw = payload.ops ?? payload.vibe_ops ?? payload.primitives;
  if (!Array.isArray(raw)) return [];
  return raw.filter((value): value is VibeOp => (
    value && typeof value === "object" && typeof value.op === "string" && Number.isSafeInteger(value.seq)
  ));
}

export function applyTaskEvent(state: TaskState, event: BridgeEvent): TaskState {
  if (!event.task_id) return state;
  const taskID = event.task_id;
  const previous = state.tasks[taskID] || {
    id: taskID,
    conversationId: taskID,
    status: "starting",
    events: [],
  };
  if (event.event_id && previous.events.some((existing) => existing.event_id === event.event_id)) {
    return state;
  }
  const events = [...previous.events, event];
  const { stages, activeStageId } = reduceStages(events);
  const nextTask: DesktopTask = {
    ...previous,
    createdAt: previous.createdAt || event.ts,
    status: statusFromEvent(event.type, previous.status),
    workspaceId: stringPayload(event, "workspace_id") || previous.workspaceId,
    workspacePath: stringPayload(event, "workspace_path") || previous.workspacePath,
    conversationId: stringPayload(event, "conversation_id") || previous.conversationId,
    parentTaskId: stringPayload(event, "parent_task_id") || previous.parentTaskId,
    documentType: stringPayload(event, "document_type") || previous.documentType,
    topic: stringPayload(event, "topic") || previous.topic,
    events,
    stages,
    activeStageId,
  };
  // A recovered native runtime can emit fresh started/progress events after
  // the previous desktop process recorded BRIDGE_PROCESS_GONE. Once durable
  // progress resumes, that interruption error is historical and must not stay
  // attached to the live task UI.
  if (event.type === "task.started" || event.type === "task.progress" || event.type === "task.question" || event.type === "task.plan") {
    nextTask.error = undefined;
  }
  if (event.type === "task.progress" && (previous.status === "plan_review" || previous.status === "question")) {
    const step = stringPayload(event, "step");
    const progressStatus = stringPayload(event, "status");
    if (progressStatus === "waiting_input" || step === "plan_confirm" || step === "question") {
      nextTask.status = previous.status;
    }
  }
  if (event.type === "task.progress" && stringPayload(event, "status") === "waiting_input" && stringPayload(event, "step") === "plan_confirm") {
    nextTask.status = "plan_review";
  }
  if (event.type === "task.progress") {
    nextTask.lastProgressAt = Date.now();
    nextTask.stalledSince = undefined;
    const step = stringPayload(event, "step");
    const content = stringPayload(event, "content");
    if (step === "assemble" && content) {
      nextTask.assembleProgress = { step, status: stringPayload(event, "status") || "running", content };
    }
  }
  if (event.type === "task.started") {
    const mode = stringPayload(event, "runtime_mode");
    if (mode === "custom" || mode === "hosted") {
      const snapshot = runtimeSnapshotFromPayload(mode, event.payload);
      if (snapshot) {
        nextTask.runtimeSnapshot = snapshot;
      }
    }
  }
  if (event.type === "task.user_input") {
    nextTask.userInput = userInputFromPayload(event.payload);
  }
  if (event.type === "task.question") {
    nextTask.question = questionFromPayload(event.payload);
    nextTask.status = "question";
  }
  if (event.type === "task.answers" && nextTask.question) {
    nextTask.question = {
      ...nextTask.question,
      answers: answersFromPayload(event.payload),
    };
  }
  if (event.type === "task.plan") {
    nextTask.plan = planFromPayload(event.payload);
    // Keep the pending question envelope alongside the plan. Some bridge
    // versions emit task.question immediately before task.plan and require
    // that question id for the approval response; clearing it here made the
    // UI send a plan id that the runtime did not recognize.
    nextTask.question = previous.question;
    nextTask.status = "plan_review";
  }
  if (event.type === "task.vibe_tree") {
    nextTask.vibeTree = vibeTreeFromPayload(event.payload) ?? previous.vibeTree;
  }
  if (event.type === "task.vibe_outline") {
    const outline = event.payload?.outline ?? event.payload?.vibe_outline ?? event.payload;
    if (outline && typeof outline === "object") {
      nextTask.vibeOutline = outline as DesktopTask["vibeOutline"];
    }
  }
  if (event.type === "task.vibe_ops" || event.type === "task.vibe_op" || event.type === "task.vibe_primitives") {
    const incoming = vibeOpsFromPayload(event.payload ?? {});
    if (incoming.length > 0) {
      const bySeq = new Map<number, VibeOp>((previous.vibeOps ?? []).map((op) => [op.seq, op]));
      for (const op of incoming) bySeq.set(op.seq, op);
      nextTask.vibeOps = [...bySeq.values()].sort((a, b) => a.seq - b.seq);
    }
  }
  if (event.type === "task.vibe_slide") {
    const parsed = vibeSlideFromPayload(event.payload);
    if (parsed) {
      const slides = [...(previous.vibeSlides ?? [])];
      slides[parsed.index] = parsed.slide;
      nextTask.vibeSlides = slides;
    }
  }
  if (event.type === "task.completed") {
    const artifact = artifactFromPayload(taskID, event.payload);
    if (artifact) {
      nextTask.artifact = artifact;
    }
    nextTask.imageWatermark = imageWatermarkFromPayload(event.payload);
    nextTask.stalledSince = undefined;
    nextTask.assembleProgress = undefined;
    applyCreditPayload(nextTask, event.payload);
  }
  if (event.type === "task.failed") {
    nextTask.error = stringPayload(event, "message") || stringPayload(event, "error") || "Task failed";
    nextTask.stalledSince = undefined;
    applyCreditPayload(nextTask, event.payload);
  }
  if (event.type === "task.cancelled") {
    nextTask.stalledSince = undefined;
  }
  if (previous.interactiveResponsePending && (event.type === "task.question" || event.type === "task.plan")) {
    // Stale-task recovery recreates historical input gates while it fast-
    // forwards the replacement run. Do not expose those replay-only gates.
    nextTask.status = "running";
    nextTask.interactiveResponsePending = true;
    nextTask.interactiveResponseAccepted = previous.interactiveResponseAccepted;
  }
  if (previous.interactiveResponsePending && previous.interactiveResponseAccepted && advancesPastInteractiveGate(event)) {
    nextTask.interactiveResponsePending = undefined;
    nextTask.interactiveResponseAccepted = undefined;
  }
  if (event.type === "task.completed" || event.type === "task.failed" || event.type === "task.cancelled") {
    nextTask.interactiveResponsePending = undefined;
    nextTask.interactiveResponseAccepted = undefined;
  }

  const tasks = { ...state.tasks, [taskID]: nextTask };
  const taskOrder = state.taskOrder.includes(taskID) ? state.taskOrder : [taskID, ...state.taskOrder];
  const artifact = nextTask.artifact;
  const artifacts = artifact && !state.artifacts.some((item) => item.filePath === artifact.filePath) ? [artifact, ...state.artifacts] : state.artifacts;
  return { tasks, taskOrder, artifacts };
}

/** Move an accepted interactive response out of its stale visible gate while
 * durable bridge events are still in flight. */
export function markTaskContinuing(state: TaskState, taskID: string): TaskState {
  const task = state.tasks[taskID];
  if (!task || (task.status !== "question" && task.status !== "plan_review")) return state;
  return {
    ...state,
    tasks: {
      ...state.tasks,
      [taskID]: {
        ...task,
        status: "running",
        interactiveResponsePending: true,
        interactiveResponseAccepted: false,
        lastProgressAt: Date.now(),
        stalledSince: undefined,
      },
    },
  };
}

/** Mark the RPC accepted, but keep replay-only gates hidden until the bridge
 * emits a durable event that advances beyond the submitted gate. */
export function finishTaskContinuing(state: TaskState, taskID: string): TaskState {
  const task = state.tasks[taskID];
  if (!task?.interactiveResponsePending) return state;
  return {
    ...state,
    tasks: {
      ...state.tasks,
      [taskID]: { ...task, interactiveResponseAccepted: true },
    },
  };
}

/** Restore the user's gate if Respond fails before accepting the response. */
export function restoreTaskInteractiveGate(state: TaskState, taskID: string, status: "question" | "plan_review"): TaskState {
  const task = state.tasks[taskID];
  if (!task?.interactiveResponsePending) return state;
  return {
    ...state,
    tasks: {
      ...state.tasks,
      [taskID]: { ...task, status, interactiveResponsePending: undefined, interactiveResponseAccepted: undefined },
    },
  };
}

function advancesPastInteractiveGate(event: BridgeEvent): boolean {
  if (event.type === "task.vibe_tree" || event.type === "task.output" || event.type === "task.completed" || event.type === "task.failed" || event.type === "task.cancelled") {
    return true;
  }
  if (event.type !== "task.progress") return false;
  const step = stringPayload(event, "step");
  const status = stringPayload(event, "status");
  if ((step === "question" || step === "plan_confirm") && status !== "completed") return false;
  return status === "running" || status === "completed";
}

function vibeSlideFromPayload(payload: BridgeEvent["payload"]): { index: number; slide: PptistSlide } | undefined {
  if (!payload) return undefined;
  const index = typeof payload.index === "number" ? payload.index : -1;
  const slide = payload.slide;
  if (index < 0 || !slide || typeof slide !== "object") return undefined;
  const record = slide as Record<string, unknown>;
  if (typeof record.id !== "string" || !Array.isArray(record.elements)) return undefined;
  return { index, slide: slide as PptistSlide };
}

function vibeTreeFromPayload(payload: BridgeEvent["payload"]): VibeTreeSnapshot | undefined {
  if (!payload) return undefined;
  const stage = normalizeVibeTreeStage(payload.stage);
  const rawTree = payload.tree;
  if (!stage || !rawTree || typeof rawTree !== "object") return undefined;
  const treeRecord = rawTree as Record<string, unknown>;
  const nodes = Array.isArray(treeRecord.nodes)
    ? treeRecord.nodes.map(vibeNodeFromUnknown).filter((node): node is VibeProjectTreeNode => node !== null)
    : [];
  const id = stringValue(treeRecord.id);
  const rootId = stringValue(treeRecord.rootId) || stringValue(treeRecord.root_id);
  const title = stringValue(treeRecord.title);
  if (!id || !rootId || !title) return undefined;
  const actions = Array.isArray(payload.actions)
    ? payload.actions.map(vibeActionFromUnknown).filter((action): action is VibeTreeAction => action !== null)
    : [];
  return {
    stage,
    tree: {
      id,
      rootId,
      title,
      direction: stringValue(treeRecord.direction) || undefined,
      nodes,
    },
    actions,
    confirmation: vibeConfirmationFromUnknown(payload.confirmation),
  };
}

function normalizeVibeTreeStage(value: unknown): VibeTreeStage | undefined {
  return value === "story_ready" || value === "outline_ready" || value === "refined_ready" || value === "slides_ready" || value === "rendering" || value === "completed"
    ? value
    : undefined;
}

function vibeConfirmationFromUnknown(raw: unknown): VibeTreeConfirmation | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const record = raw as Record<string, unknown>;
  const nodeIds = stringArrayValue(record.nodeIds ?? record.node_ids);
  return nodeIds && nodeIds.length > 0 ? { nodeIds } : undefined;
}

function vibeNodeFromUnknown(raw: unknown): VibeProjectTreeNode | null {
  if (!raw || typeof raw !== "object") return null;
  const node = raw as Record<string, unknown>;
  const id = stringValue(node.id);
  const kind = stringValue(node.kind);
  const title = stringValue(node.title);
  if (!id || !kind || !title) return null;
  const slideNumber = numberValue(node.slideNumber ?? node.slide_number);
  return {
    id,
    parentId: stringValue(node.parentId) || stringValue(node.parent_id) || undefined,
    kind,
    title,
    summary: stringValue(node.summary) || undefined,
    status: stringValue(node.status) || undefined,
    intent: stringValue(node.intent) || undefined,
    materials: stringArrayValue(node.materials),
    slideRange: stringValue(node.slideRange) || stringValue(node.slide_range) || undefined,
    slideNumber,
    outline: stringArrayValue(node.outline),
    visualAssets: visualAssetsFromUnknown(node.visualAssets ?? node.visual_assets),
    trace: stringArrayValue(node.trace),
  };
}

function vibeActionFromUnknown(raw: unknown): VibeTreeAction | null {
  if (!raw || typeof raw !== "object") return null;
  const action = raw as Record<string, unknown>;
  const id = stringValue(action.id);
  const label = stringValue(action.label);
  if (!id || !label) return null;
  return {
    id,
    label,
    description: stringValue(action.description) || undefined,
  };
}

function visualAssetsFromUnknown(raw: unknown): VibeVisualAsset[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const assets = raw
    .map((item): VibeVisualAsset | null => {
      if (!item || typeof item !== "object") return null;
      const record = item as Record<string, unknown>;
      const kind = stringValue(record.kind);
      const description = stringValue(record.description);
      return kind && description ? { kind, description } : null;
    })
    .filter((item): item is VibeVisualAsset => item !== null);
  return assets.length > 0 ? assets : undefined;
}

function statusFromEvent(type: string, fallback: DesktopTask["status"]): DesktopTask["status"] {
  switch (type) {
    case "task.started":
    case "task.progress":
    case "task.output":
      return "running";
    case "task.question":
      return "question";
    case "task.plan":
      return "plan_review";
    case "task.completed":
      return "completed";
    case "task.failed":
      return "failed";
    case "task.cancelled":
      return "cancelled";
    default:
      return fallback;
  }
}

function answersFromPayload(payload: BridgeEvent["payload"]): TaskQuestionAnswer[] {
  const rawAnswers = Array.isArray(payload?.answers) ? payload.answers : [];
  return rawAnswers
    .map((raw): TaskQuestionAnswer | null => {
      if (!raw || typeof raw !== "object") return null;
      const item = raw as Record<string, unknown>;
      const questionId = String(item.questionId || item.question_id || "");
      const answer = String(item.answer || "");
      if (!questionId || !answer) return null;
      const out: TaskQuestionAnswer = { questionId, answer };
      const questionGroupId = String(item.questionGroupId || item.question_group_id || "");
      if (questionGroupId) out.questionGroupId = questionGroupId;
      const optionId = String(item.optionId || item.option_id || "");
      if (optionId) out.optionId = optionId;
      const questionIndex = item.questionIndex ?? item.question_index;
      if (typeof questionIndex === "number" && Number.isFinite(questionIndex)) {
        out.questionIndex = questionIndex;
      }
      return out;
    })
    .filter((item): item is TaskQuestionAnswer => item !== null);
}

function planFromPayload(payload: BridgeEvent["payload"]) {
  const id = String(payload?.id || payload?.plan_id || "");
  const revision = Number(payload?.revision);
  const result: TaskPlan = {
    id,
    markdown: String(payload?.markdown || payload?.plan_markdown || ""),
    revision: Number.isFinite(revision) ? revision : 0,
  };
  const ep = payload?.execution_prompt || payload?.executionPrompt;
  if (typeof ep === "string" && ep) {
    result.executionPrompt = ep;
  }
  return result;
}

function questionFromPayload(payload: BridgeEvent["payload"]): TaskQuestion | undefined {
  if (!payload) {
    return undefined;
  }

  function parseOption(value: unknown): { id: string; label: string; description?: string; recommended?: boolean } | null {
    if (!value || typeof value !== "object") return null;
    const opt = value as Record<string, unknown>;
    const id = String(opt.id || opt.label || "");
    const label = String(opt.label || opt.id || "");
    if (!id || !label) return null;
    const result: { id: string; label: string; description?: string; recommended?: boolean } = { id, label };
    const desc = opt.description;
    if (typeof desc === "string" && desc) result.description = desc;
    const rec = opt.recommended;
    if (rec === true || rec === "true") result.recommended = true;
    return result;
  }

  const options = Array.isArray(payload.options)
    ? payload.options.map(parseOption).filter((o): o is NonNullable<typeof o> => o !== null)
    : [];

  const question: TaskQuestion = {
    id: String(payload.id || ""),
    question: String(payload.question || ""),
    options,
    allowFreeform: payload.allow_freeform === true || payload.allowFreeform === true,
  };

  const rawQuestions = payload.questions as Array<unknown> | undefined;
  if (Array.isArray(rawQuestions) && rawQuestions.length > 0) {
    question.questions = rawQuestions
      .map((rawQ) => {
        if (!rawQ || typeof rawQ !== "object") return null;
        const q = rawQ as Record<string, unknown>;
        const qOptions = Array.isArray(q.options)
          ? q.options.map(parseOption).filter((o): o is NonNullable<typeof o> => o !== null)
          : [];
        return {
          id: String(q.id || ""),
          question: String(q.question || ""),
          options: qOptions,
          allowFreeform: q.allow_freeform === true || q.allowFreeform === true,
        };
      })
      .filter((q): q is NonNullable<typeof q> => q !== null && !!q.id);

    const ci = payload.current_index ?? payload.currentIndex;
    question.currentIndex = typeof ci === "number" ? ci : 0;
  }

  return question;
}

function artifactFromPayload(taskID: string, payload: BridgeEvent["payload"]): Artifact | undefined {
  const result = payload?.result && typeof payload.result === "object" ? (payload.result as Record<string, unknown>) : payload;
  if (!result) {
    return undefined;
  }
  const filePath = stringValue(result.file_path) || stringValue(result.filePath);
  if (!filePath) {
    return undefined;
  }
  const fileName = stringValue(result.file_name) || stringValue(result.fileName) || filePath.split(/[\\/]/).pop() || filePath;
  return {
    taskId: taskID,
    fileID: stringValue(result.file_id) || stringValue(result.fileID) || undefined,
    filePath,
    fileName,
    documentType: stringValue(result.document_type) || stringValue(result.documentType) || "",
    previewUrl: stringValue(result.access_url) || stringValue(result.preview_url) || undefined,
  };
}

function stringPayload(event: BridgeEvent, key: string): string {
  return event.payload ? stringValue(event.payload[key]) : "";
}

function applyCreditPayload(task: DesktopTask, payload: BridgeEvent["payload"]): void {
  if (!payload) return;
  const charged = payload.credits_charged;
  if (typeof charged !== "number") return;
  task.creditCharged = charged;
  task.creditMode = typeof payload.credit_mode === "string" ? payload.credit_mode : "";
}

function imageWatermarkFromPayload(payload: BridgeEvent["payload"]): DesktopTask["imageWatermark"] {
  if (!payload) return undefined;
  const raw = payload.image_watermark ?? payload.imageWatermark;
  if (!raw || typeof raw !== "object") return undefined;
  const record = raw as Record<string, unknown>;
  return {
    applied: record.applied === true,
    paidEntitlement: record.paidEntitlement === true,
    canDisable: record.canDisable === true,
  };
}

function userInputFromPayload(payload: BridgeEvent["payload"]): TaskUserInput | undefined {
  if (!payload) return undefined;
  const prompt = stringValue(payload.prompt);
  if (!prompt) return undefined;
  const sourceFile = stringValue(payload.source_file) || undefined;
  const raw = payload.reference_images;
  const referenceImages = Array.isArray(raw) ? raw.filter((v): v is string => typeof v === "string") : undefined;
  const imageRatio = normalizeImageRatio(payload.image_ratio) ?? normalizeImageRatio(payload.imageRatio);
  const fps = normalizeGIFFPS(payload.fps);
  const generationMode = normalizeGenerationMode(payload.generation_mode) ?? normalizeGenerationMode(payload.generationMode);
  return { prompt, generationMode, sourceFile, referenceImages, imageRatio, fps };
}

function normalizeGenerationMode(value: unknown): GenerationMode | undefined {
  return value === "fast" || value === "plan" ? "plan" : undefined;
}

function normalizeImageRatio(value: unknown): ImageRatio | undefined {
  return value === "square" || value === "landscape" || value === "portrait" ? value : undefined;
}

function normalizeGIFFPS(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return value >= 4 && value <= 24 ? Math.round(value) : undefined;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function stringArrayValue(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
  return items.length > 0 ? items : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function runtimeSnapshotFromPayload(
  mode: "custom" | "hosted",
  payload: BridgeEvent["payload"],
): TaskRuntimeSnapshot | undefined {
  const snapshot: TaskRuntimeSnapshot = { mode };
  if (!payload) return snapshot;
  const provider = providerSnapshotFromUnknown(payload.runtime_provider);
  if (provider) snapshot.provider = provider;
  const appliedAt = stringValue(payload.runtime_applied_at);
  if (appliedAt) snapshot.appliedAt = appliedAt;
  return snapshot;
}

function providerSnapshotFromUnknown(raw: unknown): ProviderSnapshot | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const obj = raw as Record<string, unknown>;
  const t = obj.type;
  if (t !== "openai" && t !== "anthropic" && t !== "azure" && t !== "custom") return undefined;
  return {
    type: t,
    baseUrlHost: stringValue(obj.base_url_host),
    model: stringValue(obj.model),
    apiKeyMasked: stringValue(obj.api_key_masked),
    apiKeyLength: typeof obj.api_key_length === "number" ? obj.api_key_length : 0,
  };
}

const DEFAULT_STAGE_DEFS: ReadonlyArray<{ id: string; label: string }> = [
  { id: "analyze", label: "Analyzing request" },
  { id: "outline", label: "Drafting outline" },
  { id: "writing", label: "Writing content" },
  { id: "format", label: "Formatting & export" },
];

function semanticStageForProgress(payload: Record<string, unknown>): { id: string; label: string } | undefined {
  const step = stringValue(payload.step).trim();
  if (!step) return undefined;
  switch (step) {
    case "license":
      return { id: "access", label: "Checking access" };
    case "plan_prepare":
      return { id: "plan", label: "Preparing execution plan" };
    case "question":
      return { id: "clarify", label: "Clarifying requirements" };
    case "plan_confirm":
      return { id: "plan-review", label: "Waiting for plan approval" };
    case "generate":
      return { id: "generate", label: "Generating document" };
    case "generate_llm":
      return { id: "generate-content", label: "Generating document content" };
    case "assemble":
      return { id: "assemble", label: "Assembling document" };
    case "write_file":
      return { id: "write", label: "Writing local file" };
    case "finalize":
      return { id: "finalize", label: "Finalizing document" };
    default:
      return { id: `step:${step}`, label: stringValue(payload.content).trim() || "Processing request" };
  }
}

function stageStatusForProgress(payload: Record<string, unknown>): StageState["status"] {
  const status = stringValue(payload.status);
  if (status === "completed") return "completed";
  if (status === "failed") return "failed";
  return "active";
}

export function reduceStages(events: BridgeEvent[]): { stages: StageState[]; activeStageId?: string } {
  const stageMap = new Map<string, StageState>();
  const order: string[] = [];
  let nativeMode = false;
  let semanticMode = false;
  let activeId: string | undefined;
  let derivedIndex = -1;

  function upsert(id: string, label: string, status: StageState["status"], ts?: string) {
    const existing = stageMap.get(id);
    if (!existing) {
      const stage: StageState = { id, label, status };
      if (status === "active" && ts) stage.startedAt = ts;
      if ((status === "completed" || status === "failed") && ts) {
        stage.startedAt = ts;
        stage.completedAt = ts;
      }
      stageMap.set(id, stage);
      order.push(id);
      return;
    }
    if (label && label !== existing.label) existing.label = label;
    if (status === "active") {
      existing.startedAt = existing.startedAt || ts;
    } else if (status === "completed" || status === "failed") {
      existing.startedAt = existing.startedAt || ts;
      existing.completedAt = ts || existing.completedAt;
    }
    existing.status = status;
  }

  function ensureDerivedDefaults() {
    for (const def of DEFAULT_STAGE_DEFS) {
      if (!stageMap.has(def.id)) {
        stageMap.set(def.id, { id: def.id, label: def.label, status: "pending" });
        order.push(def.id);
      }
    }
  }

  for (const event of events) {
    const payload = (event.payload || {}) as Record<string, unknown>;
    const stageId = stringValue(payload.stage_id);
    const stageLabel = stringValue(payload.stage_label) || stringValue(payload.stage);
    const ts = event.ts;

    if (stageId) {
      nativeMode = true;
      for (const id of order) {
        const stage = stageMap.get(id);
        if (stage && id !== stageId && stage.status === "active") {
          upsert(id, stage.label, "completed", ts);
        }
      }
      if (event.type === "task.failed") {
        upsert(stageId, stageLabel || stageId, "failed", ts);
        activeId = undefined;
      } else if (event.type === "task.completed") {
        upsert(stageId, stageLabel || stageId, "completed", ts);
        activeId = undefined;
      } else {
        upsert(stageId, stageLabel || stageId, "active", ts);
        activeId = stageId;
      }
      continue;
    }

    const semanticStage = event.type === "task.progress" ? semanticStageForProgress(payload) : undefined;
    if (!nativeMode && semanticStage) {
      semanticMode = true;
      const status = stageStatusForProgress(payload);
      for (const id of order) {
        const stage = stageMap.get(id);
        if (stage && id !== semanticStage.id && stage.status === "active") {
          upsert(id, stage.label, "completed", ts);
        }
      }
      upsert(semanticStage.id, semanticStage.label, status, ts);
      activeId = status === "active" ? semanticStage.id : undefined;
      continue;
    }

    if (nativeMode || semanticMode) {
      if (event.type === "task.completed") {
        for (const id of order) {
          const stage = stageMap.get(id);
          if (stage && stage.status !== "failed") {
            upsert(id, stage.label, "completed", ts);
          }
        }
        activeId = undefined;
      } else if (event.type === "task.failed" && activeId) {
        const cur = stageMap.get(activeId);
        if (cur) upsert(activeId, cur.label, "failed", ts);
        activeId = undefined;
      }
      continue;
    }

    switch (event.type) {
      case "task.started":
        break;
      case "task.progress": {
        ensureDerivedDefaults();
        derivedIndex = Math.min(derivedIndex + 1, DEFAULT_STAGE_DEFS.length - 1);
        for (let i = 0; i < derivedIndex; i++) {
          const def = DEFAULT_STAGE_DEFS[i];
          const stage = stageMap.get(def.id);
          if (stage && stage.status !== "completed") {
            upsert(def.id, stage.label, "completed", ts);
          }
        }
        const def = DEFAULT_STAGE_DEFS[derivedIndex];
        upsert(def.id, stageLabel || def.label, "active", ts);
        activeId = def.id;
        break;
      }
      case "task.completed": {
        ensureDerivedDefaults();
        for (const def of DEFAULT_STAGE_DEFS) {
          const stage = stageMap.get(def.id);
          if (stage && stage.status !== "failed") {
            upsert(def.id, stage.label, "completed", ts);
          }
        }
        activeId = undefined;
        break;
      }
      case "task.failed": {
        if (activeId) {
          const cur = stageMap.get(activeId);
          if (cur) upsert(activeId, cur.label, "failed", ts);
        } else {
          ensureDerivedDefaults();
          const def = DEFAULT_STAGE_DEFS[Math.max(derivedIndex, 0)];
          const stage = stageMap.get(def.id);
          if (stage) upsert(def.id, stage.label, "failed", ts);
        }
        activeId = undefined;
        break;
      }
    }
  }

  const stages = order.map((id) => stageMap.get(id)).filter((s): s is StageState => Boolean(s));
  return { stages, activeStageId: activeId };
}
