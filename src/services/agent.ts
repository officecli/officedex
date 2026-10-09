import { readSuggestionChanges } from "./suggestionDiff";
import type { BridgeEvent, DesktopAPI, DesktopTask, DocumentRecord, GenerateInput, TaskHistoryEntry } from "../shared/types";
import { OUTLINE_GATE_KIND, type AgentEvent, type AgentImageRun, type AgentImageSeries, type AgentMessage, type AgentOutlinePage, type AgentPort, type AgentRecovery, type AgentStatus, type AgentStep, type AgentTask, type AgentTaskSummary, type ImageGenerationInput, type SendInput } from "../shared/uiPort";
import { imageDimensions, imageStyleText, isReferenceImagePath, ratioBucket } from "../shared/imageGeneration";
import { pptxPageStates } from "../renderer/presentation/pptxRuntimeActivity";
import { respondToPlanReview } from "../renderer/presentation/planReviewResponse";
import { planApprovalAnswer } from "../renderer/flows/resumeTask";
import { BRIDGE_ERROR_CODES, errorCode } from "../renderer/failureKind";
import { NotImplementedError } from "../shared/notImplemented";
import { applyTaskEvent, attachTaskContext, attachUserInput, createInitialTaskState, type TaskState } from "../renderer/taskState";
import { errorMessage } from "../renderer/utils/values";
import { taskTitle } from "../renderer/taskTitle";
import { inferHomeTaskRoute, outputFileStem, requestedFileName, requestsNewFile } from "../renderer/homeIntake";
import { planModeRequested } from "./planMode";
import { DEFAULT_FOLDER_ID } from "./files";
import { translate } from "../renderer/i18n";

/**
 * The agent surface over the desktop's task model.
 *
 * `taskState.ts`, `taskTitle.ts` and `homeIntake.ts` are reused rather than
 * reimplemented: they are pure functions with their own tests, and the rules
 * they encode (how events reduce to a task, how a run is named, which document
 * type an instruction implies) are the same rules whatever the UI looks like.
 * They live under src/renderer/ because that is where they were written; they
 * are not renderer code and move out when the old entry point is retired.
 *
 * Four places where the contract and the desktop do not line up. Each is
 * handled explicitly below rather than smoothed over:
 *
 *   1. A task is scoped to a folder here, to a conversation on the desktop. One
 *      folder can hold several conversations, so `current` picks one.
 *   2. `AgentStatus` has no failure state. A failed run reports `done` and the
 *      failure arrives separately as an error event.
 *   3. `pause`/`resume` exist for every type in the contract; the desktop only
 *      implements them for presentations.
 *   4. `SendInput` carries `mentions`, `attachments`, `reference`, `modelId`
 *      and `permission`, while the generate path only accepts some of these.
 *      Attachments are carried as native paths when the desktop picker is
 *      available; browser drag/drop attachments still have no path. The
 *      editor reference is carried by adding the selected passage to the
 *      existing prompt, which preserves its meaning without changing the
 *      runtime protocol.
 *
 * Full-access runs still have no suggestion. Review/custom runs that edit an
 * existing file retain the completed artifact as a real, file-level suggestion
 * and use the desktop snapshot bridge for Apply/Undo.
 */

/** Keep native/worker stack traces in Details, not conversation messages. */
export function agentErrorSummary(error: string): string {
  return /(?:\n\s*at\s|thread .+panicked|stack backtrace|Traceback|HideLastTransition must be bool|\.wasm:|RuntimeError:)/i.test(error) || error.length > 600
    ? translate("shell.agent.technicalFailure") : error;
}

export function requestsFormatChoice(text: string): boolean {
  return /(?:word|docx|文档)/i.test(text) && /(?:excel|xlsx|表格)/i.test(text)
    && /(?:powerpoint|pptx?|幻灯片)/i.test(text)
    && /(?:ask me|先[询问]|问我|询问我)/i.test(text)
    && /(?:wait|等待|等我|等.*回答)/i.test(text);
}

const ACTIVE_STATUSES = ["starting", "running", "question", "plan_review"];

/** How many history entries `current` looks back through. */
const HISTORY_PAGE = 50;

/**
 * How many rows `list` hands back when the caller does not say.
 *
 * "Recent" is bounded by a row count, not by a time window. `createdAt` is
 * optional on a history entry and the runtime does not stamp every event
 * either, so a cut like "the last seven days" would silently drop exactly the
 * runs whose age is unknown — the oldest records, which are the ones most
 * likely to be missing a timestamp. A row count drops a run only when there is
 * something newer to show in its place.
 *
 * Eight because Home's band is a way back into work, not a history view: past
 * that the list stops answering "what was I doing" and starts needing its own
 * screen, which this is not.
 */
const LIST_LIMIT = 8;

/**
 * The stages during which the agent is *producing* something, by id.
 *
 * `toStatus` used to answer this with `activeStageId?.includes("draw") ||
 * .includes("write")`, over a closed set of ids that `taskState.ts` assigns
 * itself — and the substrings missed almost all of it. Nothing in that set
 * contains "draw" at all, and "writing" (the default skeleton's third stage)
 * does not contain "write", so the only id the test ever matched was `write`,
 * the two-second step that copies the finished file to disk.
 *
 * The visible cost was on documents, which spend nearly their whole run in
 * `generate-content`: the panel said "Agent reading" for a minute while the
 * model wrote the document, and then flickered to "writing" as the bytes were
 * saved. Matching on the ids themselves is also what makes this readable —
 * the set is small, closed, and defined in one place.
 */
const WRITING_STAGES = new Set([
  "outline",
  "generate",
  "generate-content",
  "assemble",
  "write",
  "finalize",
  // The four-stage skeleton `taskState.ts` falls back to when the runtime
  // sends no semantic step.
  "writing",
  "format",
]);

function toStatus(task: DesktopTask): AgentStatus {
  switch (task.status) {
    case "starting":
      return "working";
    case "running":
      /*
       * The active stage says more than "running" does, and the contract has
       * two states for it.
       *
       * Reading is the fallback rather than `working`: a run that is under way
       * but has named no stage is doing *something*, and `working` in this
       * contract means "has not begun". An unrecognised stage is the same case
       * — better to say the quieter of the two true things than to invent a
       * third.
       */
      return task.activeStageId && WRITING_STAGES.has(task.activeStageId) ? "writing" : "reading";
    case "question":
    case "plan_review":
      return "awaiting-review";
    // No failure state in the contract: a failed run is over, and the failure
    // is delivered as an error event instead.
    case "completed":
    case "failed":
    case "cancelled":
      return "done";
    default:
      return "idle";
  }
}

function toSteps(task: DesktopTask): AgentStep[] {
  return (task.stages ?? []).map((stage) => ({
    id: stage.id,
    label: stage.label,
    state: stage.status === "completed" ? "done" : stage.status === "active" ? "active" : "pending",
  }));
}

function phaseOf(task: DesktopTask): string {
  const active = (task.stages ?? []).find((stage) => stage.id === task.activeStageId);
  if (active) return active.label;
  if (task.status === "question") return translate("shell.service.phase.question");
  if (task.status === "plan_review") return translate("shell.service.phase.review");
  if (task.status === "failed") return task.error?.trim() || translate("shell.service.phase.failed");
  if (task.status === "completed") return translate("shell.service.phase.done");
  return "";
}

/**
 * The conversation, as far as the desktop has one.
 *
 * The user's instruction is a message. What comes back is not chat: a run edits
 * a document rather than replying. So the agent's messages are the things it
 * genuinely said — a question it asked, a plan it proposed, an error it hit.
 * Completion produces no message because there is no text to show, and
 * inventing one would be putting words in the runtime's mouth.
 */
function toMessages(task: DesktopTask): AgentMessage[] {
  const messages: AgentMessage[] = [];
  const at = (value: string | undefined) => (value ? Date.parse(value) || 0 : 0);

  if (task.userInput?.prompt) {
    messages.push({
      id: `${task.id}:instruction`,
      role: "user",
      // What the user typed. The runtime also got the conversation so far,
      // appended by `send`; showing that here would echo the whole thread
      // back inside every follow-up.
      text: stripConversationContext(task.userInput.prompt),
      createdAt: at(task.createdAt),
    });
  }
  if (task.question?.question) {
    messages.push({
      id: `${task.id}:question:${task.question.id}`,
      role: "agent",
      text: task.question.question,
      createdAt: at(task.events.at(-1)?.ts),
    });
  }
  if (task.plan?.markdown) {
    messages.push({
      id: `${task.id}:plan`,
      role: "agent",
      text: task.plan.markdown,
      createdAt: at(task.events.at(-1)?.ts),
    });
  }
  if (task.status === "failed" && task.error) {
    messages.push({
      id: `${task.id}:error`,
      role: "agent",
      text: agentErrorSummary(task.error),
      createdAt: at(task.events.at(-1)?.ts),
    });
  }
  return messages.sort((left, right) => left.createdAt - right.createdAt);
}

/**
 * The question the run is blocked on, or null.
 *
 * `task.question` survives in the desktop task after it has been answered — the
 * reducer keeps the envelope because some bridge versions need its id for the
 * follow-up approval. So the status is what decides whether anyone is waiting,
 * not the presence of the envelope.
 */
function toQuestion(task: DesktopTask): AgentTask["question"] {
  if (task.status !== "question" && task.status !== "plan_review") return null;

  /*
   * The outline gate, as something the panel can actually show.
   *
   * It is the one blocking point in the product (the stage spec keeps it for
   * pptx alone), and it used to be answered on the canvas. Moving the canvas to
   * the editor left it with nowhere to be pressed — and it does not always
   * arrive as a question: the runtime blocks on `plan_review` with a plan and
   * frequently no question envelope at all, so `toQuestion` returned null and
   * the panel drew nothing while the run waited forever.
   *
   * The plan is what is being approved, so the plan's id is the question's id —
   * which is also the id `respondToPlanReview` sends back.
   */
  if (task.status === "plan_review" && task.plan?.id && !task.question?.id) {
    return {
      id: task.plan.id,
      text: translate("shell.service.outline.ready"),
      kind: OUTLINE_GATE_KIND,
      options: [{ id: "approve", label: translate("shell.service.outline.start"), recommended: true }],
      allowFreeform: false,
    };
  }

  const question = task.question;
  if (!question?.id) return null;
  const active = question.questions?.[question.currentIndex ?? 0];
  return {
    id: question.id,
    text: (active?.question || question.question || "").trim(),
    // The runtime's gate arrives as a question with `allow_freeform: true` —
    // that is its degradation path for clients with no gate UI. The kind is
    // what says it is the gate; the shape no longer does.
    ...(question.kind ? { kind: question.kind } : {}),
    options: (active?.options ?? question.options ?? []).map((option) => ({
      id: option.id,
      label: option.label,
      ...(option.description ? { description: option.description } : {}),
      ...(option.recommended ? { recommended: true } : {}),
    })),
    allowFreeform: active?.allowFreeform ?? question.allowFreeform ?? false,
  };
}

/**
 * The pages a run is writing, for the task panel's list.
 *
 * Two sources, joined on the slide number: the runtime's outline supplies the
 * titles, and `pptxPageStates` — the same reader the old stage used — supplies
 * how each page is doing. Reusing it keeps one definition of what "ready"
 * means; the states come off `slide_state` payloads, which the outline itself
 * knows nothing about.
 *
 * Only presentations have this. A document or a workbook has no page-level plan
 * to show, and an empty list is what tells the panel to render nothing.
 */
function toOutline(task: DesktopTask): AgentOutlinePage[] {
  const slides = task.vibeOutline?.slides;
  if (!Array.isArray(slides) || slides.length === 0) return [];
  const states = pptxPageStates(task);
  return slides.map((slide, index) => {
    const number = Number.isInteger(slide.slide) && Number(slide.slide) > 0 ? Number(slide.slide) : index + 1;
    return {
      slide: number,
      title: String(slide.headline ?? "").trim() || `Slide ${number}`,
      state: states.get(number) ?? null,
    };
  });
}

/**
 * Where a failed deck can be picked up from, or undefined.
 *
 * A drawing failure carries the checkpoint in its structured failure; a content
 * failure ("expansion is incomplete") only announces it on the event stream.
 * The old workbench read both, and so does this.
 */
function resumeCheckpointOf(task: DesktopTask): string | undefined {
  if (task.status !== "failed" || task.documentType !== "pptx") return undefined;
  if (task.failure && !task.failure.retryable) return undefined;
  if (task.failure?.resume_checkpoint) return task.failure.resume_checkpoint;
  for (let index = task.events.length - 1; index >= 0; index -= 1) {
    const checkpoint = task.events[index].payload?.resume_checkpoint;
    if (typeof checkpoint === "string" && checkpoint.trim()) return checkpoint.trim();
  }
  return undefined;
}

function toRecovery(task: DesktopTask, outline: AgentOutlinePage[]): AgentRecovery | undefined {
  if (!resumeCheckpointOf(task)) return undefined;
  const retained = task.failure?.retained;
  if (retained) {
    return { readyPages: retained.ready_pages, ...(retained.total_pages ? { totalPages: retained.total_pages } : {}) };
  }
  // A content failure has no retained facts; the page states it streamed are
  // the same facts, one page at a time.
  if (outline.length) {
    return { readyPages: outline.filter((page) => page.state === "ready").length, totalPages: outline.length };
  }
  return {};
}

function toAgentTask(task: DesktopTask): AgentTask {
  const documentType = task.documentType === "docx" || task.documentType === "xlsx" || task.documentType === "pptx" || task.documentType === "img"
    ? task.documentType
    : undefined;
  const outline = toOutline(task);
  const recovery = toRecovery(task, outline);
  return {
    id: task.id,
    title: taskTitle(task, translate("shell.service.untitledTask")),
    folderId: task.workspaceId?.trim() || DEFAULT_FOLDER_ID,
    documentType,
    status: toStatus(task),
    phase: phaseOf(task),
    steps: toSteps(task),
    messages: toMessages(task),
    outline,
    // No desktop model for proposed-then-applied changes; see the header.
    suggestion: null,
    question: toQuestion(task),
    ...outcomeOf(task, recovery),
    ...(recovery ? { recovery } : {}),
  };
}

/** How the run ended and when, for a task that is over; the clock, for one that is not. */
function outcomeOf(
  task: DesktopTask,
  recovery: AgentRecovery | undefined,
): Pick<AgentTask, "outcome" | "error" | "errorDetail" | "failureKind" | "startedAt" | "finishedAt"> {
  const parse = (value: string | undefined) => (value ? Date.parse(value) || undefined : undefined);
  const startedAt = parse(task.createdAt) ?? parse(task.events[0]?.ts);
  const clock = startedAt ? { startedAt } : {};
  if (task.status !== "completed" && task.status !== "failed" && task.status !== "cancelled") return clock;
  const finishedAt = parse(task.events.at(-1)?.ts);
  const ended = { ...clock, ...(finishedAt ? { finishedAt } : {}) };
  if (task.status === "completed") return { ...ended, outcome: "completed" };
  if (task.status === "cancelled") return { ...ended, outcome: "stopped" };
  const error = task.error?.trim();
  const text = `${task.failure?.reason ?? ""} ${error ?? ""}`.toLowerCase();
  // The backend names the stage; a transport failure is the connection's, not the model's.
  const network =
    task.failure?.stage === "transport" || /network|offline|econn|enotfound|timed? ?out|socket|dns|\beof\b|connection (?:lost|reset|refused)|fetch failed/.test(text);
  const model = /auth|api[ _-]?key|unauthori[sz]ed|quota|credit|rate[ _-]?limit|model|provider|401|403|429/.test(text);
  // Finished pages that can be kept make this a partial result, not a loss.
  const kept = (recovery?.readyPages ?? 0) > 0;
  return {
    ...ended,
    outcome: network ? "interrupted" : kept ? "partial" : "failed",
    ...(error ? { error: agentErrorSummary(error), errorDetail: error } : {}),
    failureKind: network ? "network" : model ? "model" : "other",
  };
}

interface ReviewArtifactState {
  rejected?: boolean;
  sourceFileId: string;
  sourceFile: string;
  artifactFile?: string;
  applied: boolean;
  undoable: boolean;
}

function toAgentTaskWithReview(task: DesktopTask, review?: ReviewArtifactState): AgentTask {
  const result = toAgentTask(task);
  if (!review || !review.artifactFile) return result;
  if (review.rejected) return { ...result, outcome: "stopped", suggestion: null };
  return {
    ...result,
    suggestion: {
      id: task.id,
      targetFileId: review.sourceFileId,
      summary: translate("shell.service.review.summary", { type: task.documentType?.toUpperCase() ?? translate("shell.service.review.document") }),
      applied: review.applied,
      undoable: review.undoable,
    },
  };
}

/** Replays a history page into task state, newest entries included. */
function hydrate(entries: TaskHistoryEntry[]): TaskState {
  let state = createInitialTaskState();
  for (const entry of entries) {
    for (const event of entry.events) state = applyTaskEvent(state, event);
    state = attachTaskContext(state, entry.taskId, {
      createdAt: entry.createdAt,
      conversationId: entry.conversationId,
      parentTaskId: entry.parentTaskId,
      workspaceId: entry.workspaceId,
      workspacePath: entry.workspacePath,
    });
  }
  return state;
}

function folderOf(task: DesktopTask): string {
  return task.workspaceId?.trim() || DEFAULT_FOLDER_ID;
}

/**
 * Epoch ms of the last thing that happened to a run.
 *
 * The runtime stamps events, not tasks, so "last touched" is the newest event
 * it recorded; `createdAt` covers a task that has an envelope but nothing in it
 * yet. Zero is the answer when neither is readable, which sorts the row to the
 * bottom — an unknown time must not be allowed to read as "just now" and take
 * the top of the list away from a run the user actually remembers.
 */
function updatedAtOf(task: DesktopTask): number {
  const last = task.events.at(-1)?.ts;
  // Date.parse yields NaN, which is falsy, so each fallback is reached only
  // when the one before it was absent or unparseable.
  return (last ? Date.parse(last) : NaN) || (task.createdAt ? Date.parse(task.createdAt) : NaN) || 0;
}

/**
 * A row, not a task.
 *
 * `AgentTaskSummary` is deliberately thinner than `AgentTask`: messages, steps
 * and the suggestion are the expensive parts, and Home renders a dozen of these
 * at once. Building the full record here and letting the caller ignore most of
 * it would mean replaying every event of every recent run to draw a list that
 * shows a title and a status.
 */
function toSummary(task: DesktopTask): AgentTaskSummary {
  const updatedAt = updatedAtOf(task);
  return {
    id: task.id,
    title: taskTitle(task, translate("shell.service.untitledTask")),
    folderId: folderOf(task),
    status: toStatus(task),
    phase: phaseOf(task),
    // Omitted rather than sent as 0: the field is optional precisely so a
    // consumer can tell "the runtime did not say" from a real timestamp.
    ...(updatedAt ? { updatedAt } : {}),
  };
}

/**
 * Live task state plus whatever history knows that it does not.
 *
 * History is authoritative for what happened and live events are ahead of it
 * for what is happening, so the two are merged rather than one replacing the
 * other. Replacing a live task with its recorded form would roll a running run
 * back to whichever event the writer had flushed when the page was fetched.
 */
function mergeHistory(live: TaskState, history: TaskState): TaskState {
  let next = live;
  for (const id of history.taskOrder) {
    const task = history.tasks[id];
    if (!task || next.tasks[id]) continue;
    next = { ...next, tasks: { ...next.tasks, [id]: task }, taskOrder: [...next.taskOrder, id] };
  }
  return next;
}

/**
 * The task a folder's presence shows.
 *
 * A folder can hold several conversations, and the contract has room for one.
 * An active run wins over a finished one — what is happening now matters more
 * than what happened — and among equals the most recent.
 */
function pickForFolder(state: TaskState, folderId: string): DesktopTask | undefined {
  const candidates = state.taskOrder
    .map((id) => state.tasks[id])
    .filter((task): task is DesktopTask => Boolean(task) && folderOf(task) === folderId);
  return candidates.find((task) => ACTIVE_STATUSES.includes(task.status)) ?? candidates[0];
}

export function createAgentService(api: DesktopAPI): AgentPort {
  let state = createInitialTaskState();
  /** What pause/resume/finish act on: those take no id in the contract. */
  let activeTaskId: string | undefined;
  const reviewKey = "officedex.agent.reviews.v1";
  const reviewArtifacts = new Map<string, ReviewArtifactState>();
  try {
    const saved = JSON.parse(localStorage.getItem(reviewKey) ?? "[]");
    if (Array.isArray(saved)) for (const [id, review] of saved) {
      if (typeof id === "string" && typeof review?.sourceFileId === "string" && typeof review?.sourceFile === "string") {
        // Backend Undo snapshots do not survive a process restart.
        reviewArtifacts.set(id, { ...review, undoable: false });
      }
    }
  } catch { /* Older or unavailable storage. */ }
  const persistReviews = () => {
    try { localStorage.setItem(reviewKey, JSON.stringify([...reviewArtifacts])); } catch { /* Keep session state. */ }
  };
  const listeners = new Set<(event: AgentEvent) => void>();

  const emit = (event: AgentEvent) => {
    if (event.kind === "task") persistPending();
    for (const listener of listeners) listener(event);
  };

  /**
   * What `send` knows about a run before the bridge does.
   *
   * `generate` returns a task id long before the first event creates the task,
   * and history is the only other place the conversation id is written. Without
   * this a follow-up — or a second version of a picture — would show up as a
   * separate conversation until the next reload, and the prompt shown for a run
   * would be whatever the runtime echoed back rather than what the user typed.
   */
  const sentRuns = new Map<string, SentRun>();

  /**
   * Messages waiting for the conversation's live run to end, by conversation.
   *
   * A second instruction typed while a run is under way used to start a second
   * run at once — and, with nothing open, the target heuristic below turned it
   * into a `modify` of whatever the first run had made, so "now write me a
   * spreadsheet" became an edit of the deck still being drawn. Holding it here
   * keeps the user's words and sends them, unchanged, once the run is over.
   */
  const queues = new Map<string, QueuedSend[]>();
  let queueSerial = 0;
  const heldQueues = new Set<string>();
  const retryInputs = new Map<string, SendInput>();
  type BatchItem = { fileId: string; name: string; input: SendInput; taskId?: string; error?: string; attempt?: number };
  const batches = new Map<string, BatchItem[]>();
  const batchInputs = new WeakMap<SendInput, BatchItem>();
  const draining = new Set<string>();
  const attempts = new Map<string, number>();
  const attemptRoots = new Map<string, { id: string; startedAt?: number }>();
  const formatGates = new Map<string, SendInput>();
  const pendingKey = "officedex.agent.pending.v1";
  const validInput = (value: unknown): value is SendInput => {
    const input = value as SendInput | null;
    return Boolean(input && typeof input.text === "string" && typeof input.folderId === "string" && Array.isArray(input.mentions) && Array.isArray(input.attachments));
  };
  const persistPending = () => {
    try {
      localStorage.setItem(pendingKey, JSON.stringify({
        formatGates: [...formatGates].map(([id, input]) => [id, input, state.tasks[id]]),
        queues: [...queues], held: [...heldQueues], batches: [...batches],
        retries: [...retryInputs].slice(-100), attempts: [...attempts].slice(-100), serial: queueSerial, roots: [...attemptRoots].slice(-100),
      }));
    } catch { /* An unavailable store must not interrupt a running task. */ }
  };
  try {
    const saved = JSON.parse(localStorage.getItem(pendingKey) ?? "null");
    if (saved) {
      for (const [id, input, task] of saved.formatGates ?? []) {
        if (typeof id === "string" && validInput(input) && task?.id === id && task.status === "question") {
          formatGates.set(id, input);
          state = { ...state, tasks: { ...state.tasks, [id]: task }, taskOrder: [id, ...state.taskOrder] };
        }
      }
      queueSerial = Number.isSafeInteger(saved.serial) ? saved.serial : 0;
      for (const [id, entries] of saved.batches ?? []) {
        if (typeof id !== "string" || !Array.isArray(entries)) continue;
        const items = entries.filter((item) => typeof item.fileId === "string" && typeof item.name === "string" && validInput(item.input)) as BatchItem[];
        batches.set(id, items);
        for (const item of items) batchInputs.set(item.input, item);
      }
      for (const [id, entries] of saved.queues ?? []) {
        if (typeof id !== "string" || !Array.isArray(entries)) continue;
        const waiting = entries.filter((entry) => typeof entry.id === "string" && validInput(entry.input)) as QueuedSend[];
        for (const entry of waiting) {
          entry.conversationId = id;
          const item = batches.get(id)?.find((item) => item.fileId === entry.input.activeFileId && item.input.text === entry.input.text);
          if (item) entry.input = item.input;
        }
        queues.set(id, waiting);
        // A restart never silently starts a queued paid run.
        heldQueues.add(id);
      }
      for (const [id, input] of saved.retries ?? []) if (typeof id === "string" && validInput(input)) retryInputs.set(id, input);
      for (const [id, root] of saved.roots ?? []) if (typeof id === "string" && root && typeof root.id === "string") attemptRoots.set(id, root);
      for (const [id, count] of saved.attempts ?? []) if (typeof id === "string" && Number.isSafeInteger(count)) attempts.set(id, count);
    }
  } catch { /* Invalid or absent recovery data does not prevent launch. */ }


  /**
   * Failures already announced, as `taskId + message`.
   *
   * A failed task is terminal in the reducer, so every later event the runtime
   * sends for it (a late progress line, a flushed log) leaves the task failed
   * with the same error — and each one used to be reported again. The toast
   * stacked three deep for one failure.
   */
  const reportedErrors = new Set<string>();

  // What `send` recorded wins: the reducer defaults a task's conversation to
  // its own id until history says otherwise, which would split a batch into
  // unrelated pictures for as long as the window stays open.
  const conversationOf = (task: DesktopTask): string =>
    sentRuns.get(task.id)?.conversationId || task.conversationId || task.id;

  /**
   * Which conversation each folder's panel shows.
   *
   * Pinned the first time a conversation is shown or continued, so a run
   * finishing somewhere else in the folder cannot pull the panel away from the
   * thread the user is typing into. `fresh` is "New conversation": nothing is
   * shown until the next message starts one.
   */
  const threads = new Map<string, { conversationId?: string; fresh: boolean }>();

  /**
   * In-place edits, which never reach the runtime, by conversation.
   *
   * An edit made while the folder has no conversation yet waits under
   * `orphanKey` and joins whichever conversation the next message starts.
   */
  const localTurns = new Map<string, LocalTurn[]>();
  const orphanKey = (folderId: string) => `orphan:${folderId}`;

  /** Every run of a conversation, oldest first. */
  const conversationTasks = (conversationId: string): DesktopTask[] =>
    state.taskOrder
      .map((id, index) => ({ task: state.tasks[id], index }))
      .filter((entry): entry is { task: DesktopTask; index: number } =>
        Boolean(entry.task) && conversationOf(entry.task!) === conversationId,
      )
      .sort((left, right) => {
        const a = Date.parse(left.task.createdAt ?? "");
        const b = Date.parse(right.task.createdAt ?? "");
        if (!Number.isNaN(a) && !Number.isNaN(b) && a !== b) return a - b;
        // `taskOrder` is newest first for live runs.
        return right.index - left.index;
      })
      .map((entry) => entry.task);

  /** The run that speaks for a conversation: a live one, else the newest. */
  const headOf = (conversationId: string): DesktopTask | undefined => {
    const runs = conversationTasks(conversationId);
    return [...runs].reverse().find((task) => ACTIVE_STATUSES.includes(task.status)) ?? runs.at(-1);
  };

  const focusedConversation = (folderId: string): string | undefined => {
    const thread = threads.get(folderId);
    if (thread?.conversationId) return thread.conversationId;
    if (thread?.fresh) return undefined;
    const task = pickForFolder(state, folderId);
    return task ? conversationOf(task) : undefined;
  };

  const isFocused = (task: DesktopTask): boolean => {
    const conversationId = conversationOf(task);
    return conversationId === focusedConversation(folderOf(task)) && headOf(conversationId)?.id === task.id;
  };

  /**
   * The conversation's messages, runs and in-place edits interleaved.
   *
   * Ordered by when each run started rather than by message timestamp: a run
   * whose record carries no time would otherwise sort to the top of the
   * thread. A run with no time of its own takes the one before it.
   */
  const conversationMessages = (conversationId: string): AgentMessage[] => {
    const groups: Array<{ at: number; messages: AgentMessage[] }> = [];
    let previous = 0;
    for (const run of conversationTasks(conversationId)) {
      const at = Date.parse(run.createdAt ?? "") || Date.parse(run.events[0]?.ts ?? "") || previous;
      previous = at;
      const sent = sentRuns.get(run.id);
      const known = sent?.prompt;
      const messages = toMessages(run).map((message) =>
        known && message.id === `${run.id}:instruction` ? { ...message, text: known } : message,
      );
      /*
       * Which file an edit is aimed at, said out loud.
       *
       * The runtime's result card shows the file it wrote, which for an edit
       * is a copy beside the original — nothing on screen named the original.
       * When the target was *inferred* (the last file this conversation made,
       * because the message named none) that silence is the whole bug: the
       * user asked for a change and could not tell what was being changed.
       */
      if (sent?.target) {
        messages.push({
          id: `${run.id}:target`,
          role: "agent",
          text: translate(sent.target.explicit ? "shell.service.target.explicit" : "shell.service.target.inferred", {
            file: sent.target.fileName,
          }),
          createdAt: at + 1,
        });
      }
      groups.push({ at, messages });
    }
    for (const turn of localTurns.get(conversationId) ?? []) groups.push({ at: turn.at, messages: turn.messages });
    // Waiting messages come last: they were typed after everything above and
    // have not run yet.
    for (const queued of queues.get(conversationId) ?? []) {
      groups.push({ at: queued.at, messages: [{ id: queued.id, role: "user", text: queued.input.text.trim(), createdAt: queued.at }] });
    }
    return groups
      .map((group, index) => ({ ...group, index }))
      .sort((left, right) => left.at - right.at || left.index - right.index)
      .flatMap((group) => group.messages);
  };

  /** What the runtime is told about the conversation so far, or "" for a first message. */
  const conversationContext = (conversationId: string | undefined, folderId: string): string => {
    const turns: Array<{ at: number; lines: string[] }> = [];
    if (conversationId) {
      for (const run of conversationTasks(conversationId)) {
        const instruction = sentRuns.get(run.id)?.prompt ?? stripConversationContext(run.userInput?.prompt ?? "");
        if (!instruction.trim()) continue;
        const lines = [`User: ${clip(instruction, TURN_CHARS)}`];
        if (run.status === "completed") {
          lines.push(run.artifact?.fileName ? `Result: wrote ${run.artifact.fileName}` : "Result: done");
        } else if (run.status === "failed") {
          lines.push(`Result: failed${run.error ? ` — ${clip(run.error, TURN_CHARS)}` : ""}`);
        } else if (run.status === "cancelled") {
          lines.push("Result: stopped before finishing");
        }
        turns.push({ at: Date.parse(run.createdAt ?? "") || 0, lines });
      }
    }
    const local = [...(conversationId ? (localTurns.get(conversationId) ?? []) : []), ...(localTurns.get(orphanKey(folderId)) ?? [])];
    for (const turn of local) {
      const lines = turn.messages
        .filter((message) => message.text.trim())
        .map((message) => `${message.role === "user" ? "User" : "Agent (edited the open file in place)"}: ${clip(message.text, TURN_CHARS)}`);
      if (lines.length) turns.push({ at: turn.at, lines });
    }
    if (turns.length === 0) return "";
    const ordered = turns.sort((left, right) => left.at - right.at).slice(-CONTEXT_TURNS);
    // Oldest turns go first when the block is over budget; the latest one is
    // what "make it shorter" refers to.
    while (ordered.length > 1 && ordered.map((turn) => turn.lines.join("\n")).join("\n").length > CONTEXT_CHARS) ordered.shift();
    return `${CONVERSATION_CONTEXT_MARKER}\n${ordered.map((turn) => turn.lines.join("\n")).join("\n")}`;
  };

  const runStatus = (task: DesktopTask): AgentImageRun["status"] => {
    if (task.status === "completed") return "done";
    if (task.status === "failed") return "failed";
    if (task.status === "cancelled") return "cancelled";
    return "running";
  };

  /**
   * Every run of the picture `task` belongs to, oldest first.
   *
   * Grouped by conversation because that is the one link the desktop records
   * for a run started from another (`recordTaskWorkspaceContext`). Ordered by
   * creation time where it is known and by arrival otherwise — `taskOrder` is
   * newest first for live runs and appends history behind them.
   */
  const imageSeries = (task: DesktopTask): AgentImageSeries | undefined => {
    if (task.documentType !== "img") return undefined;
    const key = conversationOf(task);
    const members = state.taskOrder
      .map((id, index) => ({ task: state.tasks[id], index }))
      .filter((entry): entry is { task: DesktopTask; index: number } =>
        Boolean(entry.task) && entry.task!.documentType === "img" && conversationOf(entry.task!) === key,
      )
      .sort((left, right) => {
        const a = Date.parse(left.task.createdAt ?? "");
        const b = Date.parse(right.task.createdAt ?? "");
        if (!Number.isNaN(a) && !Number.isNaN(b) && a !== b) return a - b;
        return right.index - left.index;
      });
    return {
      runs: members.map(({ task: run }) => {
        const known = sentRuns.get(run.id);
        const baseTaskId = run.parentTaskId || known?.parentTaskId;
        return {
          taskId: run.id,
          status: runStatus(run),
          prompt: known?.prompt ?? run.userInput?.prompt ?? "",
          ...(baseTaskId ? { baseTaskId } : {}),
          ...(run.status === "failed" && run.error ? { error: run.error } : {}),
        };
      }),
    };
  };

  /** The contract's view of a desktop task, with everything this closure knows added. */
  const project = (task: DesktopTask): AgentTask => {
    const result = toAgentTaskWithReview(task, reviewArtifacts.get(task.id));
    const conversationId = conversationOf(task);
    const batchItems = batches.get(conversationId)?.some((item) => item.taskId === task.id) ? batches.get(conversationId) : undefined;
    const image = imageSeries(task);
    if (image) return { ...result, conversationId, image };
    /*
     * A follow-up is a run of its own, but the panel is the conversation: the
     * messages are every run's. The title is this run's own.
     *
     * It used to be the first run's — and `taskTitle` names a finished run
     * after the file it wrote, so every later card in a conversation carried
     * the first file's name whatever it was doing ("Q3 deck.pptx" over a run
     * that was writing a spreadsheet). The conversation keeps its name in the
     * sidebar through `list`; the card says what *this* run is.
     */
    const queued = (queues.get(conversationId) ?? []).map((entry) => ({ id: entry.id, text: entry.input.text.trim() }));
    return {
      ...result,
      attempt: attempts.get(task.id) ?? 1,
      logicalTaskId: attemptRoots.get(task.id)?.id ?? task.id,
      startedAt: attemptRoots.get(task.id)?.startedAt ?? result.startedAt,
      targetFileName: sentRuns.get(task.id)?.target?.fileName,
      ...(batchItems ? { batch: batchItems.map((item) => {
        const run = item.taskId ? state.tasks[item.taskId] : undefined;
        return { fileId: item.fileId, name: item.name, taskId: item.taskId,
          status: item.error ? "failed" as const : run?.status === "completed" ? "completed" as const : run?.status === "failed" ? "failed" as const : run?.status === "cancelled" ? "stopped" as const : run ? "running" as const : "queued" as const,
          error: item.error || run?.error ? agentErrorSummary(item.error ?? run!.error!) : undefined,
          suggestion: run ? toAgentTaskWithReview(run, reviewArtifacts.get(run.id)).suggestion : null };
      }) } : {}),
      ...(result.status === "done" && batchItems?.some((item) => item.error || (item.taskId && state.tasks[item.taskId]?.status === "failed")) ? { outcome: "partial" as const } : {}),
      conversationId,
      messages: conversationMessages(conversationId),
      ...(queued.length > 0 ? { queued } : {}),
    };
  };

  /** Puts a message behind the conversation's live run; see `queues`. */
  const enqueue = (conversationId: string, input: SendInput, head: DesktopTask) => {
    queueSerial += 1;
    const entry: QueuedSend = { id: `queued:${conversationId}:${queueSerial}`, conversationId, input, at: Date.now() };
    queues.set(conversationId, [...(queues.get(conversationId) ?? []), entry]);
    emit({ kind: "task", task: project(head), focused: isFocused(head) });
  };

  /**
   * What happens to the queue when a run of its conversation ends.
   *
   * Completed or failed: the next message goes out, as typed, into the same
   * conversation — a failure is the runtime's answer to the first message, not
   * a reason to drop the second. Stopped: the user pulled the plug, and the
   * messages behind it remain visible until the user continues or removes them.
   */
  const settleQueue = (task: DesktopTask) => {
    if (!isTerminalStatus(task.status)) return;
    const conversationId = conversationOf(task);
    const waiting = queues.get(conversationId);
    if (!waiting || waiting.length === 0 || draining.has(conversationId)) return;
    const head = headOf(conversationId);
    if (head && ACTIVE_STATUSES.includes(head.status)) return;
    if (task.status === "cancelled") heldQueues.add(conversationId);
    if (heldQueues.has(conversationId)) return;
    const [next, ...rest] = waiting;
    if (rest.length > 0) queues.set(conversationId, rest);
    else queues.delete(conversationId);
    draining.add(conversationId);
    void dispatch(next.input, next.conversationId).catch((reason) => {
      const item = batchInputs.get(next.input);
      if (item) recordBatchFailure(item, next.conversationId, reason);
      emit({ kind: "error", message: errorMessage(reason) });
    }).finally(() => {
      draining.delete(conversationId);
      const head = headOf(conversationId);
      if (head) { emit({ kind: "task", task: project(head), focused: isFocused(head) }); settleQueue(head); }
    });
  };

  // Dispatch can fail before the runtime allocates a task (for example an
  // unreadable attachment). Keep that file's failure and continue the batch.
  const recordBatchFailure = (item: BatchItem, conversationId: string, reason: unknown) => {
    const id = `batch-failed:${conversationId}:${++queueSerial}`;
    item.taskId = id;
    item.error = errorMessage(reason);
    retryInputs.set(id, item.input);
    attempts.set(id, item.attempt ?? 1);
    state = attachUserInput(state, id, { prompt: item.input.text }, undefined, { conversationId,
      createdAt: new Date().toISOString(), workspaceId: item.input.folderId });
    state = applyTaskEvent(state, { event_id: `${id}:failed`, task_id: id, type: "task.failed",
      ts: new Date().toISOString(), payload: { message: item.error } });
    const thread = threads.get(item.input.folderId);
    if (!thread?.conversationId || thread.conversationId === conversationId) threads.set(item.input.folderId, { conversationId, fresh: false });
    emit({ kind: "task", task: project(state.tasks[id]), focused: isFocused(state.tasks[id]) });
  };

  /**
   * Starts the runs one image message asks for.
   *
   * A separate path from `generate` below because nothing about it is
   * inferred: the type is stated, the size is stated, and what the runtime
   * gets is the user's words untouched — the look travels as the runtime's own
   * `style` argument instead of being appended to the prompt.
   *
   * "Four images" is four runs in one conversation. The runtime makes one
   * picture per run, and each is a version the user can pick, download or
   * change on its own, which is what a result grid would be for anyway.
   */
  const sendImage = async (text: string, input: SendInput, image: ImageGenerationInput, workspaceId: string | undefined) => {
    const references = [...(image.references ?? [])];
    for (const attachment of input.attachments) {
      if (attachment.path && isReferenceImagePath(attachment.path)) references.push(attachment.path);
    }
    const ignored: string[] = [];
    for (const mention of input.mentions) {
      if (mention.kind !== "file") {
        ignored.push(`@${mention.label}`);
        continue;
      }
      const record = await api.getDocument(mention.id).catch(() => null);
      if (record && isReferenceImagePath(record.filePath)) references.push(record.filePath);
      else ignored.push(`@${mention.label}`);
    }
    if (ignored.length > 0) {
      emit({
        kind: "notice",
        message: translate(ignored.length === 1 ? "shell.service.image.ignoredOne" : "shell.service.image.ignoredMany", { items: ignored.join(", ") }),
      });
    }

    let conversationId: string | undefined = input.conversationId;
    let parentTaskId: string | undefined;
    /*
     * The runtime names the file after the topic. A change keeps the picture's
     * name — "Make the light warmer" is an instruction, not what the picture
     * is — and the runtime suffixes it (`name-2.png`) rather than overwrite.
     */
    let topic = text.slice(0, 64);
    if (image.baseFileId) {
      const base = await api.getDocument(image.baseFileId);
      topic = base.fileName.replace(/(?:-\d+)?\.[^.]+$/, "") || topic;
      references.unshift(base.filePath);
      parentTaskId = base.currentArtifactTaskId || undefined;
      const baseTask = parentTaskId ? state.tasks[parentTaskId] : undefined;
      conversationId = baseTask ? conversationOf(baseTask) : parentTaskId;
    }

    const size = image.ratio === "auto" ? null : imageDimensions(image);
    const style = imageStyleText(image);
    const count = Math.min(4, Math.max(1, Math.round(image.count) || 1));
    for (let index = 0; index < count; index += 1) {
      const result = await api.generate({
        documentType: "img",
        topic,
        prompt: text,
        ...(workspaceId ? { workspaceId } : { noProject: true }),
        ...(conversationId ? { conversationId } : {}),
        ...(parentTaskId ? { parentTaskId } : {}),
        ...(references.length > 0 ? { referenceImages: [...new Set(references)] } : {}),
        ...(size ? { imageRatio: ratioBucket(size[0], size[1]), imageSize: `${size[0]}x${size[1]}` } : {}),
        ...(style ? { imageStyle: style } : {}),
      });
      // The first run of a new picture names the conversation: the desktop
      // defaults a run's conversation to its own id.
      conversationId ??= result.taskId;
      sentRuns.set(result.taskId, { conversationId, ...(parentTaskId ? { parentTaskId } : {}), prompt: text });
      // The picture is what the panel shows now.
      threads.set(input.folderId, { conversationId, fresh: false });
      activeTaskId = result.taskId;
    }
  };

  /** The library's record of the file a run wrote, if it is still there. */
  const documentMadeBy = async (task: DesktopTask): Promise<DocumentRecord | undefined> => {
    const page = await api
      .listDocuments({ ...(task.workspaceId ? { workspaceId: task.workspaceId } : {}), limit: 200 })
      .catch(() => null);
    return page?.items.find((record) => record.currentArtifactTaskId === task.id || record.filePath === task.artifact?.filePath);
  };

  /** The active run and its question, when it is blocked on one. */
  const pendingQuestion = (): { taskId: string; question: NonNullable<AgentTask["question"]> } | null => {
    const task = activeTaskId ? state.tasks[activeTaskId] : undefined;
    if (!task) return null;
    const question = toQuestion(task);
    return question ? { taskId: task.id, question } : null;
  };

  /**
   * The run pause/resume/finish should act on.
   *
   * `send` records `activeTaskId` from the generate/modify response, which
   * arrives *before* the first bridge event hydrates `state.tasks`. Looking
   * only in `state.tasks` made every control a no-op for the whole of that
   * gap — which is exactly when the user reaches for Stop.
   *
   * If the id is known, that is the run. If it is not (a run that started
   * before this window, or whose id was dropped), the live task in state is
   * the next-best answer. Either way the buttons never silently return.
   */
  const liveTask = (): DesktopTask | { id: string } | undefined => {
    if (activeTaskId) return state.tasks[activeTaskId] ?? { id: activeTaskId };
    return state.taskOrder
      .map((id) => state.tasks[id])
      .find((task): task is DesktopTask => Boolean(task) && ACTIVE_STATUSES.includes(task.status));
  };

  /**
   * Pause/resume/finish follow this id until the run it names is over.
   *
   * `send` records the generate/modify result before any event exists. `current`
   * then hydrates history, which can still list an older run as "running", and
   * a leftover event from that run can arrive after the new id is known. Either
   * would retarget Stop at a task the bridge has already forgotten — the
   * `task_not_found` toast that used to answer a click on Stop.
   */
  const adoptActive = (id: string) => {
    if (!activeTaskId || activeTaskId === id) {
      activeTaskId = id;
      return;
    }
    const held = state.tasks[activeTaskId];
    if (held && !ACTIVE_STATUSES.includes(held.status)) activeTaskId = id;
  };

  const cancelTask = async (taskId: string) => {
    if (formatGates.has(taskId)) {
      formatGates.delete(taskId);
      const task = state.tasks[taskId];
      task.status = "cancelled";
      task.question = undefined;
      emit({ kind: "task", task: project(task) });
      return;
    }
    try {
      await api.cancel(taskId);
    } catch (reason) {
      // The Go side already records a local `task.cancelled` for this code.
      // The run is gone; treating it as a failure made Stop look broken.
      if (errorCode(errorMessage(reason)) !== BRIDGE_ERROR_CODES.taskNotFound) throw reason;
    }
  };

  // Subscribed for the service's whole life rather than per listener: task
  // state has to keep up with the bridge even while nothing is watching, or a
  // run started before the first subscriber would be invisible afterwards.
  api.onBridgeEvent((event: BridgeEvent) => {
    if (!event.task_id) return;
    state = applyTaskEvent(state, event);
    const task = state.tasks[event.task_id];
    if (!task) return;
    if (ACTIVE_STATUSES.includes(task.status)) adoptActive(task.id);
    const review = reviewArtifacts.get(task.id);
    if (review && task.status === "completed" && task.artifact?.filePath) { review.artifactFile = task.artifact.filePath; persistReviews(); }
    // Before the task is projected: a dropped queue must not be drawn once more.
    settleQueue(task);
    emit({ kind: "task", task: project(task), focused: isFocused(task) });
    // The contract has no failed status, so a failure is reported twice: the
    // task turns `done`, and this says why — once per failure, not once per
    // event that arrives after it (see `reportedErrors`).
    if (task.status === "failed" && task.error) {
      const key = `${task.id}\n${task.error}`;
      if (!reportedErrors.has(key)) {
        reportedErrors.add(key);
        emit({ kind: "error", message: agentErrorSummary(task.error) });
      }
    }
  });

  /**
   * Sends one message: the body of `send`, with the conversation it continues
   * pinned by the caller when it must be.
   *
   * `forcedConversationId` is set when a queued message is finally sent (see
   * `queues`). By then the folder's panel may show another conversation, and
   * reading the thread afresh would file the message under that one.
   */
  const dispatch = async (input: SendInput, forcedConversationId?: string): Promise<void> => {
    const text = input.text.trim();
    if (!text) return;

    /*
     * A blocked run gets the answer, not a new run.
     *
     * Without this the composer is a trap: the run is waiting on a question,
     * the user types the answer into the only text box on screen, and it
     * starts a *second* generation while the first stays blocked forever.
     * Nothing on screen says that happened.
     */
    /*
     * Which conversation this message continues.
     *
     * The shell may name one outright (`input.conversationId`): a chat it
     * created before anything was said in it, or the thread a Local document
     * owns. An id with runs is continued; one the service has never seen
     * starts life under that id — the desktop records whatever conversation
     * id a run's first event carries. A queued message carries its thread as
     * `forcedConversationId`. Otherwise it is the folder's panel's, or none
     * for a message that says it starts something new.
     */
    const addressed =
      input.conversationId ?? forcedConversationId ?? (input.newConversation ? undefined : focusedConversation(input.folderId));
    const pending = forcedConversationId || (input.newConversation && !input.conversationId) ? null : pendingQuestion();
    const pendingTask = pending ? state.tasks[pending.taskId] : undefined;
    if (pending && pendingTask && addressed && conversationOf(pendingTask) === addressed) {
      if (!pending.question.allowFreeform && pending.question.options.length > 0) {
        emit({
          kind: "notice",
          message: translate("shell.service.question.pickOption"),
        });
        return;
      }
      await service.answer({ text });
      return;
    }

    const workspaceId = input.folderId === DEFAULT_FOLDER_ID ? undefined : input.folderId;

    /*
     * Which conversation this message continues.
     *
     * The panel shows one, and a message typed under it is a follow-up. The
     * desktop defaults a run's conversation to its own id, so leaving this
     * out — which is what every send did — made each message a conversation
     * of its own: a new row on Home, and a panel that forgot everything said
     * before it.
     */
    if (input.newConversation && !input.conversationId && !forcedConversationId) {
      threads.set(input.folderId, { fresh: true });
      localTurns.delete(orphanKey(input.folderId));
      emit({ kind: "cleared", folderId: input.folderId });
    }
    const conversationId = addressed;

    /*
     * One run at a time per conversation.
     *
     * A message typed while this conversation's run is still going waits for
     * it (`queues`), and the panel shows it waiting. Pictures are the
     * exception: a batch of four *is* four concurrent runs, by design.
     */
    if (conversationId && !input.imageGeneration) {
      const head = headOf(conversationId);
      if (head && ACTIVE_STATUSES.includes(head.status)) {
        enqueue(conversationId, input, head);
        return;
      }
    }

    if (!input.documentType && requestsFormatChoice(text)) {
      const id = `format-choice:${crypto.randomUUID()}`;
      const joined = conversationId ?? id;
      const task: DesktopTask = {
        id, conversationId: joined, workspaceId, status: "question", topic: text,
        createdAt: new Date().toISOString(), events: [], userInput: { prompt: text },
        question: { id: `${id}:question`, question: translate("shell.service.chooseFormat"),
          options: [{ id: "docx", label: "Word (.docx)" }, { id: "xlsx", label: "Excel (.xlsx)" }, { id: "pptx", label: "PowerPoint (.pptx)" }], allowFreeform: true },
      };
      formatGates.set(id, input);
      state = { ...state, tasks: { ...state.tasks, [id]: task }, taskOrder: [id, ...state.taskOrder] };
      threads.set(input.folderId, { conversationId: joined, fresh: false });
      activeTaskId = id;
      emit({ kind: "task", task: project(task), focused: true });
      return;
    }

    const parentTaskId = conversationId ? headOf(conversationId)?.id : undefined;
    const lineage = {
      ...(conversationId ? { conversationId } : {}),
      ...(parentTaskId ? { parentTaskId } : {}),
    };
    /*
     * The runtime keeps no conversation of its own — every run starts from
     * the prompt alone — so what was said before travels in the prompt.
     */
    const context = conversationContext(conversationId, input.folderId);
    const withContext = (prompt: string) => (context ? `${prompt}\n\n${context}` : prompt);
    const started = (taskId: string, sentPrompt: string, target?: SentRun["target"]) => {
      const joined = conversationId ?? taskId;
      retryInputs.set(taskId, input);
      const batchItem = batchInputs.get(input);
      if (batchItem) { batchItem.taskId = taskId; batchItem.error = undefined; attempts.set(taskId, batchItem.attempt ?? 1); }
      sentRuns.set(taskId, { conversationId: joined, ...(parentTaskId ? { parentTaskId } : {}), prompt: text, ...(target ? { target } : {}) });
      /*
       * On the panel now, not at the first bridge event.
       *
       * The desktop records what was asked (`task.user_input`) but does not
       * push it, so a run only appeared once the runtime said something —
       * and the message the user had just sent was missing from the thread
       * until a reload read it back from history. The prompt kept here is
       * the one the runtime got, which is what a resume has to repeat.
       */
      state = attachUserInput(state, taskId, { prompt: sentPrompt }, parentTaskId, {
        conversationId: joined,
        createdAt: new Date().toISOString(),
        ...(workspaceId ? { workspaceId } : {}),
      });
      // A queued message sent after the user moved to another conversation
      // must not pull the panel back; a message they just typed is the panel.
      const thread = threads.get(input.folderId);
      if (!forcedConversationId || !thread?.conversationId || thread.conversationId === joined) {
        threads.set(input.folderId, { conversationId: joined, fresh: false });
      }
      const orphans = localTurns.get(orphanKey(input.folderId));
      if (orphans) {
        localTurns.set(joined, [...(localTurns.get(joined) ?? []), ...orphans]);
        localTurns.delete(orphanKey(input.folderId));
      }
      activeTaskId = taskId;
      const task = state.tasks[taskId];
      if (task) emit({ kind: "task", task: project(task), focused: isFocused(task) });
    };

    /*
     * Whether the change should wait for the user before it lands.
     *
     * Two ways to ask: the composer's permission tier, or the words — "先审阅",
     * "let me review it first". Either keeps the edit as a suggestion with
     * Apply/Undo against the original, instead of leaving the user to find the
     * written copy on their own.
     */
    const reviewRequested = input.permission !== "full" || reviewRequestedBy(text);

    const modifyDocument = async (record: DocumentRecord, explicit: boolean) => {
      const dropped = unsupportedParts(input, "modify");
      if (dropped.length > 0) emit({ kind: "notice", message: droppedNotice(dropped) });
      const batchItem = batchInputs.get(input);
      const scopedText = batchItem ? `${text}\n\nThis is one item of a batch. Modify only the source file ${record.fileName} in this run. Other referenced files are handled separately. Do not create a different document type.` : text;
      const prompt = explicit ? promptWithComposerContext(scopedText, input) : withContext(promptWithComposerContext(scopedText, input));
      const result = await api.modify({
        documentType: record.documentType as GenerateInput["documentType"],
        sourceFile: record.filePath,
        prompt,
        ...(workspaceId ? { workspaceId } : { noProject: true }),
        ...lineage,
      });
      if (reviewRequested) {
        reviewArtifacts.set(result.taskId, {
          sourceFileId: record.id,
          sourceFile: record.filePath,
          applied: false,
          undoable: false,
        });
      }
      started(result.taskId, prompt, { fileName: record.fileName, explicit });
    };

    if (input.imageGeneration) {
      await sendImage(text, input, input.imageGeneration, workspaceId);
      return;
    }

    const settings = await api.getSettings();
    const requestedRoute = inferHomeTaskRoute({ prompt: text, documentType: input.documentType });
    if (requestedRoute.kind === "unsupported_format") {
      throw new Error(translate("shell.service.unsupportedFormat", { format: requestedRoute.format, supported: SUPPORTED_OUTPUTS }));
    }
    const newFile = Boolean(input.documentType) || requestsNewFile(text);

    // Editing what is open, or starting something new. A stated document type
    // is the composer saying "a new one" — it clears `activeFileId` on the way
    // out, so this branch is reached only when the user left the choice alone.
    if (input.activeFileId && !newFile) {
      const record = await api.getDocument(input.activeFileId);
      await modifyDocument(record, true);
      return;
    }

    /*
     * The file the message points at, when it points at exactly one.
     *
     * A mention chip or a quoted passage names a file. That used to travel
     * only as a line of prompt text, and the target was chosen by the
     * fallback below — so "change one sentence in @report.docx" edited the
     * deck the conversation had made earlier and never touched the report.
     * One editable file names its target; multiple editable files form a
     * sequential batch with one frozen target per run.
     */
    if (!newFile) {
      const named = referencedFileIds(input);
      const unreadable: Array<{ attachment: SendInput["attachments"][number]; reason: unknown }> = [];
      // Native attachments carry paths, not mention ids. Register those exact
      // targets before routing, so they never fall through to a new deck.
      for (const attachment of input.attachments) {
        if (!attachment.path || !/\.(docx|xlsx|pptx)$/i.test(attachment.path)) continue;
        try {
          const imported = await api.importLocalFile(attachment.path);
          if (!named.includes(imported.id)) named.push(imported.id);
        } catch (reason) { unreadable.push({ attachment, reason }); }
      }
      if (named.length > 0 || unreadable.length > 0) {
        const records = await Promise.all(named.map((id) => api.getDocument(id).catch(() => null)));
        const editable = records.filter(
          (record): record is DocumentRecord => Boolean(record) && MODIFIABLE.has(record!.documentType.trim().toLowerCase()),
        );
        if (editable.length === 1 && unreadable.length === 0) {
          await modifyDocument(editable[0], true);
          return;
        }
        if (editable.length + unreadable.length === 1 && unreadable.length) throw unreadable[0].reason;
        if (editable.length + unreadable.length > 1) {
          const joined = conversationId ?? `batch:${Date.now()}:${++queueSerial}`;
          const items = editable.map((record): BatchItem => ({ fileId: record.id, name: record.fileName,
            input: { ...input, activeFileId: record.id, conversationId: joined, newConversation: false,
              mentions: [{ kind: "file", id: record.id, label: record.fileName }],
              attachments: input.attachments.filter(attachment => attachment.path === record.filePath),
              reference: input.reference?.fileId === record.id ? input.reference : undefined } }));
          for (const { attachment } of unreadable) items.push({ fileId: `attachment:${attachment.path}`, name: attachment.name,
            input: { ...input, activeFileId: null, conversationId: joined, newConversation: false, mentions: [], reference: undefined, attachments: [attachment] } });
          batches.set(joined, items);
          for (const item of items) batchInputs.set(item.input, item);
          queues.set(joined, [...items.slice(1).map((item) => ({ id: `queued:${joined}:${++queueSerial}`, conversationId: joined, input: item.input, at: Date.now() })), ...(queues.get(joined) ?? [])]);
          try { await dispatch(items[0].input, joined); }
          catch (reason) {
            recordBatchFailure(items[0], joined, reason);
            settleQueue(state.tasks[items[0].taskId!]);
          }
          return;
        }
      }
    }

    /*
     * A follow-up with nothing open and nothing named still means the thing
     * this conversation made. "Make it shorter" after a run wrote a document
     * is about that document; generating from the words alone would start a
     * new one that knows nothing of it. A stated type is the user asking for
     * a new file, and a message that names files has said what it is about,
     * so both go the generate way below.
     */
    if (conversationId && !newFile && !namesAnything(input)) {
      const made = [...conversationTasks(conversationId)]
        .reverse()
        .find((task) => task.status === "completed" && task.artifact?.filePath && MODIFIABLE.has(task.artifact.documentType || task.documentType || ""));
      const record = made ? await documentMadeBy(made) : undefined;
      /*
       * Only when the words do not ask for something else. "Now a budget
       * spreadsheet" after a deck names a kind the deck is not; editing the
       * deck with it is the "unknown sentinel target" failure. The route is
       * asked with the made file's own type as its fallback, so a type that
       * comes back different was read off the words.
       */
      const madeType = (record?.documentType.trim().toLowerCase() ?? "") as GenerateInput["documentType"];
      const route = record ? inferHomeTaskRoute({ prompt: text }, madeType) : undefined;
      const asksForAnother = route ? route.kind === "unsupported_format" || route.documentType !== madeType : false;
      if (record && !asksForAnother) {
        await modifyDocument(record, false);
        return;
      }
    }

    const dropped = unsupportedParts(input, "generate");
    if (dropped.length > 0) emit({ kind: "notice", message: droppedNotice(dropped) });

    /*
     * What to make. The composer's answer wins over the heuristic.
     *
     * `inferHomeTaskRoute` reads the type off the words, and it has to:
     * for most of this shell's life there was nowhere for a user to say it.
     * It is still the fallback, and still the only thing that can spot a
     * catalog cleanup — but a stated type is not a hint to be weighed against
     * keywords, so it goes in as `input.documentType` and comes back out of
     * the route unchanged.
     */
    const route = inferHomeTaskRoute(
      { prompt: text, ...(input.documentType ? { documentType: input.documentType } : {}) },
      settings.defaults.documentType,
    );
    if (route.kind === "needs_source") {
      throw new Error(translate("shell.service.needsSource"));
    }
    /*
     * A format this product does not make is refused, not substituted.
     *
     * "Save it as a .txt" used to fall through every keyword and land on the
     * settings default, so the user got a deck and no word about why.
     */
    if (route.kind === "unsupported_format") {
      throw new Error(translate("shell.service.unsupportedFormat", { format: route.format, supported: SUPPORTED_OUTPUTS }));
    }
    /*
     * The name the user asked for, everywhere it can be read.
     *
     * `outputFileName` is the field officecli names the artifact by, when it
     * has the field (officecli-internal 85b63c6; an older build ignores it and
     * names by slug). The name also stays as the topic and spelled out in the
     * prompt, which is how it travelled before the field existed and what the
     * model and an older runtime still read. Only an explicit name is sent:
     * a run with no name on the wire keeps the slug, which is the behaviour
     * the user had, while a guessed one would rename their file.
     */
    const requestedName = requestedFileName(text);
    const outputFileName = outputFileStem(requestedName);
    const prompt = newFile ? promptWithComposerContext(text, input, requestedName) : withContext(promptWithComposerContext(text, input, requestedName));
    const result = await api.generate({
      documentType: route.documentType,
      topic: (requestedName ? requestedName.replace(/\.[^.]+$/, "") : text).slice(0, 64),
      prompt,
      ...(outputFileName ? { outputFileName } : {}),
      ...lineage,
      ...(route.sourceFile ? { sourceFile: route.sourceFile } : {}),
      ...(workspaceId ? { workspaceId } : { noProject: true }),
      /*
       * `plan` is what makes the run stop at the outline; without it the
       * gate is unreachable.
       *
       * The runtime wires its one confirmation stop only for an interactive
       * best-mode run, and the bridge produces that only for
       * `generationMode: "plan"` (`officeGenerateModeArgs`). Nothing here has
       * ever set the field, so every run is `fast` and the outline gate — a
       * feature that exists on both sides, with a card, a decision payload
       * and tests — has never appeared in front of anyone.
       *
       * Whether it *should* appear is a product question, not a defect:
       * turning it on puts a mandatory pause in front of every deck. So this
       * is opt-in and off, and the switch exists so the question can be
       * answered by trying it rather than by imagining it. `?planMode=1` on
       * the shell URL, or `officedex.planMode` in localStorage for a
       * packaged build, which has no address bar.
       */
      ...(planModeRequested() ? { generationMode: "plan" as const } : {}),
      enableImages: /(?:no|without|do not (?:add|include|create|generate))\s+(?:any\s+)?images?\b|不要(?:添加|生成|包含)?图片|无图片|纯文字/i.test(text) ? false : settings.defaults.enableImages,
      // Only sent when the setting is on. An explicit false would suppress
      // request wording such as "联网搜索…"; omitting it leaves that path
      // open while keeping the default off.
      ...(settings.defaults.enableWebSearch ? { enableWebSearch: true } : {}),
      imageQuality: settings.defaults.imageQuality,
    });
    started(result.taskId, prompt);
  };

  /**
   * Ends a run from this side before the runtime confirms it.
   *
   * `cancel` resolves when the bridge has *accepted* the cancellation; the
   * event saying the task is over arrives later, or — for a task the bridge
   * had already forgotten — not at all. The card sat on "Reading" for ever.
   * The reducer takes a terminal state from any source, and a later real
   * `task.cancelled` is a terminal-to-terminal step it allows.
   */
  const markStopped = (taskId: string) => {
    const current = state.tasks[taskId];
    if (!current || isTerminalStatus(current.status)) return;
    state = applyTaskEvent(state, {
      event_id: `local-stop-${taskId}-${Date.now()}`,
      task_id: taskId,
      type: "task.cancelled",
      ts: new Date().toISOString(),
      payload: { message: translate("shell.service.stoppedByUser") },
    });
    const task = state.tasks[taskId];
    if (!task) return;
    settleQueue(task);
    emit({ kind: "task", task: project(task), focused: isFocused(task) });
  };

  const service: AgentPort = {
    async current(folderId) {
      const entries = await api.getTaskHistory(HISTORY_PAGE).catch(() => [] as TaskHistoryEntry[]);
      if (entries.length > 0) {
        const hydrated = hydrate(entries);
        // History is authoritative for what happened; live events are ahead of
        // it for what is happening. Merge rather than replace.
        for (const id of hydrated.taskOrder) {
          if (!state.tasks[id]) state = { ...state, tasks: { ...state.tasks, [id]: hydrated.tasks[id] }, taskOrder: [...state.taskOrder, id] };
        }
      }
      const conversationId = focusedConversation(folderId);
      const task = conversationId ? headOf(conversationId) : undefined;
      if (!conversationId || !task) return null;
      threads.set(folderId, { conversationId, fresh: false });
      if (ACTIVE_STATUSES.includes(task.status)) adoptActive(task.id);
      return project(task);
    },

    /**
     * Every folder's recent runs, newest first.
     *
     * Reads the same history page `current` does. There is no deeper query in
     * `DesktopAPI` — `getTaskHistory(limit)` is the only way in — so "how far
     * back" is one page of entries narrowed to `LIST_LIMIT` rows, and a run
     * older than that page is simply not recent.
     *
     * Ordered by `updatedAtOf` alone, with no rule hoisting live runs to the
     * top. A run that is under way emits events continuously, so it *is* the
     * most recently touched thing and lands there on its own; a second
     * "active first" rule would only bite when a run goes quiet, and its
     * visible effect would be rows jumping down the list at the moment they
     * finish — right as the user reaches for them.
     *
     * `activeTaskId` is deliberately not touched. `current` sets it because
     * opening a folder is a statement about what the user is working on;
     * drawing a list is not, and letting Home retarget pause/resume/finish as
     * a side effect of rendering would make those buttons act on whatever
     * happened to be listed last.
     */
    async list(options): Promise<AgentTaskSummary[]> {
      const entries = await api.getTaskHistory(HISTORY_PAGE).catch(() => [] as TaskHistoryEntry[]);
      if (entries.length > 0) state = mergeHistory(state, hydrate(entries));
      /*
       * One row per conversation, not per run. A follow-up is a run of its
       * own, and so is every version of a picture; listed run by run, one
       * conversation would push every other task off Home. The most recently
       * touched run speaks for the row (status, time); the id is the
       * conversation's, so the row keeps its identity as runs are added.
       */
      const seen = new Set<string>();
      return state.taskOrder
        .map((id) => state.tasks[id])
        .filter((task): task is DesktopTask => Boolean(task))
        .sort((left, right) => updatedAtOf(right) - updatedAtOf(left))
        .filter((task) => {
          const key = conversationOf(task);
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        })
        .slice(0, options?.limit ?? LIST_LIMIT)
        .map((task) => {
          const conversationId = conversationOf(task);
          const first = conversationTasks(conversationId)[0];
          const runs = conversationTasks(conversationId);
          const summary: AgentTaskSummary = {
            ...toSummary(task),
            id: conversationId,
            conversationId,
            // The row is the conversation, so it keeps the name the first
            // message gave it; the cards say what each run is (`project`).
            ...(first && first.id !== task.id ? { title: taskTitle(first, translate("shell.service.untitledTask")) } : {}),
            // Every run's id, so a file stamped with a later run's id can still
            // be traced to this conversation (`FileMeta.artifactTaskId`).
            runTaskIds: runs.map((run) => run.id),
          };
          const image = imageSeries(task);
          if (!image) return summary;
          const busy = image.runs.some((run) => run.status === "running");
          return {
            ...summary,
            id: image.runs[0]?.taskId ?? summary.id,
            // A batch still drawing is working even if its newest run landed.
            ...(busy && summary.status === "done" ? { status: "writing" as const } : {}),
            image,
          };
        });
    },

    async send(input: SendInput) {
      await dispatch(input);
    },

    /**
     * Unblocks a waiting run.
     *
     * `optionId` when the user picked one of the offered options, `text` when
     * they typed. The runtime wants the question id back with the answer, so a
     * question that has already been superseded is dropped rather than replied
     * to with a stale id.
     */
    async answer(input: { optionId?: string; text?: string; outline?: readonly AgentOutlinePage[] }) {
      const pending = pendingQuestion();
      if (!pending) return;
      const gate = formatGates.get(pending.taskId);
      if (gate) {
        const answer = (input.optionId ?? input.text ?? "").trim();
        const choices = [
          { type: "docx" as const, pattern: /^(?:word|docx|文档|文稿)(?:\s*\(\.docx\))?$/i },
          { type: "xlsx" as const, pattern: /^(?:excel|xlsx|表格|工作簿)(?:\s*\(\.xlsx\))?$/i },
          { type: "pptx" as const, pattern: /^(?:powerpoint|pptx?|幻灯片|演示文稿)(?:\s*\(\.pptx\))?$/i },
        ];
        const type = choices.find(choice => choice.pattern.test(answer))?.type;
        if (!type) { emit({ kind: "notice", message: translate("shell.service.chooseFormat") }); return; }
        const task = state.tasks[pending.taskId];
        task.status = "completed";
        task.question = undefined;
        formatGates.delete(task.id);
        try {
          await dispatch({ ...gate, documentType: type, newConversation: false, conversationId: task.conversationId,
            text: `${gate.text}\n\nThe user has now chosen ${type.toUpperCase()} and authorized creation. Continue using that format.`,
          }, task.conversationId);
          if (activeTaskId && activeTaskId !== task.id) attemptRoots.set(activeTaskId, { id: task.id, startedAt: Date.parse(task.createdAt!) });
          persistPending();
        } catch (error) {
          task.status = "question";
          task.question = { id: `${task.id}:question`, question: translate("shell.service.chooseFormat"), options: [], allowFreeform: true };
          formatGates.set(task.id, gate);
          activeTaskId = task.id;
          emit({ kind: "task", task: project(task) });
          throw error;
        }
        return;
      }

      /*
       * Approving the outline is not the same call as answering a question.
       *
       * `respondToPlanReview` sends the *plan's* id and carries a fallback for
       * runtimes that want the legacy question id; a plain `respond` with an
       * "approve" answer is ambiguous to older ones and can reopen the gate
       * indefinitely (see the note in renderer/flows/resumeTask.ts). Routing
       * both through `answer` keeps one verb for the user — unblock whatever is
       * blocking — without pretending the wire calls are interchangeable.
       *
       * What goes back is whatever the panel collected. The gate's whole point
       * is that the outline is the last place a change costs nothing — every
       * stage after it rewrites whole pages — so a gate that can only be
       * approved is a pause that buys the user nothing. `input.text` carries
       * the edited outline when the card offered one (`planApprovalAnswer`
       * serialises it: titles, order, and absence meaning removal); an empty
       * string is the unmodified plan, which is what the runtime treats as
       * "approved as proposed".
       */
      const blocked = state.tasks[pending.taskId];
      /*
       * The edited outline, put on the wire here rather than in the panel.
       *
       * `planApprovalAnswer` writes the runtime's decision shape — a section
       * per page, numbered by position, with a page left out meaning dropped.
       * The shell hands over the list it collected and stays out of that
       * format; `undefined` is the unmodified plan, which the runtime reads
       * as approved as proposed.
       */
      const edited = input.outline?.length
        ? planApprovalAnswer(
            input.outline.map((page, index) => ({
              id: String(page.slide),
              slide: index + 1,
              title: page.title,
            })),
          )
        : planApprovalAnswer(undefined);
      if (blocked?.status === "plan_review") {
        await respondToPlanReview(api, blocked, "approve", edited);
        return;
      }
      /*
       * The same gate, delivered as a question (`kind: pptx_outline_gate`) by
       * the progressive pipeline. The runtime reads a decision only off the
       * approve option with a JSON answer; anything else approves the outline
       * as proposed, which is what an empty edit should mean.
       */
      if (pending.question.kind === OUTLINE_GATE_KIND) {
        await api.respond({
          taskId: pending.taskId,
          questionId: pending.question.id,
          optionId: "approve",
          ...(edited ? { answer: edited } : {}),
        });
        return;
      }

      const answer = input.text?.trim();
      if (!input.optionId && !answer) return;
      await api.respond({
        taskId: pending.taskId,
        questionId: pending.question.id,
        ...(input.optionId ? { optionId: input.optionId } : {}),
        ...(answer ? { answer } : {}),
      });
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    async pause() {
      const task = liveTask();
      if (!task) return;
      const documentType = "documentType" in task ? task.documentType : undefined;
      if (!api.pausePptx || (documentType && documentType !== "pptx")) {
        // Saying so beats a button that silently does nothing. Holding a run at
        // a boundary only exists for presentations today.
        throw new NotImplementedError(
          "agent.pause",
          translate("shell.service.pauseUnavailable"),
        );
      }
      await api.pausePptx(task.id);
    },

    async resume() {
      const task = liveTask();
      if (!task) return;
      const documentType = "documentType" in task ? task.documentType : undefined;
      if (!api.resumePptxLive || (documentType && documentType !== "pptx")) {
        throw new NotImplementedError(
          "agent.resume",
          translate("shell.service.resumeUnavailable"),
        );
      }
      await api.resumePptxLive(task.id);
    },

    async moveConversation(conversationId, folderId) {
      if (!api.moveConversation) throw new Error("Moving chats requires the desktop app.");
      await api.moveConversation(conversationId, folderId === DEFAULT_FOLDER_ID ? "" : folderId);
      for (const task of conversationTasks(conversationId)) task.workspaceId = folderId === DEFAULT_FOLDER_ID ? undefined : folderId;
      for (const entry of queues.get(conversationId) ?? []) entry.input.folderId = folderId;
      for (const item of batches.get(conversationId) ?? []) item.input.folderId = folderId;
      threads.set(folderId, { conversationId, fresh: false });
    },

    async retryBatch(taskId) {
      const task = state.tasks[taskId];
      if (!task) return;
      const joined = conversationOf(task);
      if (headOf(joined) && ACTIVE_STATUSES.includes(headOf(joined)!.status)) return;
      const pending = (batches.get(joined) ?? []).filter((item) => !item.taskId || state.tasks[item.taskId]?.status !== "completed");
      if (!pending.length) return;
      const other = (queues.get(joined) ?? []).filter((entry) => !batchInputs.has(entry.input));
      for (const item of pending) { item.attempt = (item.attempt ?? 1) + (item.taskId ? 1 : 0); item.error = undefined; item.taskId = undefined; }
      queues.set(joined, [...pending.slice(1).map((item) => ({ id: `queued:${joined}:${++queueSerial}`, conversationId: joined, input: item.input, at: Date.now() })), ...other]);
      heldQueues.delete(joined);
      try { await dispatch(pending[0].input, joined); }
      catch (reason) {
        recordBatchFailure(pending[0], joined, reason);
        settleQueue(state.tasks[pending[0].taskId!]);
      }
    },

    async retry(taskId) {
      const original = retryInputs.get(taskId);
      const task = state.tasks[taskId];
      if (!original || !task) throw new Error(translate("shell.service.nothingToResume"));
      await dispatch(original, conversationOf(task));
      const next = headOf(conversationOf(task));
      if (next && next.id !== taskId) {
        attempts.set(next.id, (attempts.get(taskId) ?? 1) + 1);
        attemptRoots.set(next.id, attemptRoots.get(taskId) ?? { id: taskId, startedAt: project(task).startedAt });
        persistPending();
        emit({ kind: "task", task: project(next), focused: isFocused(next) });
      }
    },

    async sendQueued(taskId) {
      const task = state.tasks[taskId];
      if (!task || !isTerminalStatus(task.status)) return;
      heldQueues.delete(conversationOf(task));
      persistPending();
      // A cancelled run is a queue gate only until the user chooses to continue.
      settleQueue({ ...task, status: "completed" });
    },

    async removeQueued(taskId, messageId) {
      const task = state.tasks[taskId];
      if (!task) return;
      const conversationId = conversationOf(task);
      const waiting = queues.get(conversationId) ?? [];
      const removed = waiting.find((entry) => entry.id === messageId);
      const batchItem = removed && batchInputs.get(removed.input);
      if (batchItem) batches.set(conversationId, (batches.get(conversationId) ?? []).filter((item) => item !== batchItem));
      queues.set(conversationId, waiting.filter((entry) => entry.id !== messageId));
      emit({ kind: "task", task: project(task), focused: isFocused(task) });
    },

    async finish(taskId) {
      /*
       * The card's Stop names its run. Without the id this acted on the
       * service-wide `activeTaskId`, which is whatever started last anywhere —
       * so Stop on one project's card could cancel a run in another.
       */
      const task: DesktopTask | { id: string } | undefined = taskId ? (state.tasks[taskId] ?? { id: taskId }) : liveTask();
      if (!task) return;
      /*
       * "Four images" is four runs, and Stop means all of them: cancelling
       * only the one pause/resume track would leave three still billing.
       */
      const known = state.tasks[task.id];
      if (known?.documentType === "img") {
        const running = imageSeries(known)?.runs.filter((run) => run.status === "running") ?? [];
        for (const run of running) await cancelTask(run.taskId);
        for (const run of running) markStopped(run.taskId);
        if (!activeTaskId || activeTaskId === task.id || running.some((run) => run.taskId === activeTaskId)) activeTaskId = undefined;
        return;
      }
      // `cancel` is the closest the desktop has. The promises differ in wording
      // — finish keeps what was applied, cancel stops the run — but the outcome
      // matches: a cancelled run's output stays on disk as its partial artifact.
      await cancelTask(task.id);
      markStopped(task.id);
      if (!activeTaskId || activeTaskId === task.id) activeTaskId = undefined;
    },

    async resumeFailed(taskId) {
      const task = state.tasks[taskId];
      const checkpoint = task ? resumeCheckpointOf(task) : undefined;
      const input = task?.userInput;
      if (!task || !checkpoint || !input?.prompt.trim()) {
        throw new Error(translate("shell.service.nothingToResume"));
      }
      const settings = await api.getSettings();
      // The runtime refuses a resume whose prompt, target or image decision
      // differs from the checkpoint's, so all three come from the failed run —
      // the prompt as the bridge recorded it, images as the runtime announced.
      // No generation mode: the outline was approved before the checkpoint was
      // written, and the runtime restores it without reopening the gate.
      let images: boolean | undefined;
      for (let index = task.events.length - 1; index >= 0 && images === undefined; index -= 1) {
        const value = task.events[index].payload?.resume_images;
        if (typeof value === "boolean") images = value;
      }
      const result = await api.generate({
        documentType: "pptx",
        topic: task.topic || input.prompt.slice(0, 64),
        prompt: input.prompt,
        ...(input.pptxWorkflow ? { pptxWorkflow: input.pptxWorkflow } : {}),
        ...(input.sourceFile ? { sourceFile: input.sourceFile } : {}),
        ...(input.templateId ? { templateId: input.templateId, templateVersion: input.templateVersion, templateAssetDir: input.templateAssetDir } : {}),
        ...(task.workspaceId ? { workspaceId: task.workspaceId } : { noProject: true }),
        conversationId: conversationOf(task),
        parentTaskId: task.id,
        resumeCheckpoint: checkpoint,
        enableImages: images ?? settings.defaults.enableImages,
        // No web search: the research the pages were written from is part of
        // the checkpoint and is reused as it is.
        imageQuality: settings.defaults.imageQuality,
      });
      const joined = conversationOf(task);
      sentRuns.set(result.taskId, { conversationId: joined, parentTaskId: task.id, prompt: stripConversationContext(input.prompt) });
      attempts.set(result.taskId, (attempts.get(task.id) ?? 1) + 1);
      attemptRoots.set(result.taskId, attemptRoots.get(task.id) ?? { id: task.id, startedAt: project(task).startedAt });
      persistPending();
      state = attachUserInput(state, result.taskId, input, task.id, {
        conversationId: joined, createdAt: new Date().toISOString(), workspaceId: task.workspaceId,
      });
      activeTaskId = result.taskId;
      emit({ kind: "task", task: project(state.tasks[result.taskId]), focused: isFocused(state.tasks[result.taskId]) });
    },

    async suggestionChanges(id) {
      const review = reviewArtifacts.get(id);
      if (!review?.artifactFile) throw new Error(translate("shell.service.suggestionUnavailable"));
      return readSuggestionChanges(api, review.sourceFile, review.artifactFile);
    },

    async rejectSuggestion(id) {
      const review = reviewArtifacts.get(id);
      if (!review || review.applied) throw new Error(translate("shell.service.suggestionUnavailable"));
      review.rejected = true;
      review.undoable = false;
      persistReviews();
      const task = state.tasks[id];
      if (task) emit({ kind: "task", task: project(task) });
    },

    async applySuggestion(id) {
      const review = reviewArtifacts.get(id);
      if (!review?.artifactFile || review.rejected || !api.applyArtifactSuggestion) {
        throw new NotImplementedError("agent.applySuggestion", translate("shell.service.suggestionUnavailable"));
      }
      await api.applyArtifactSuggestion({ suggestionId: id, sourceFile: review.sourceFile, artifactFile: review.artifactFile });
      review.applied = true;
      review.undoable = true;
      persistReviews();
      const task = state.tasks[id];
      if (task) emit({ kind: "task", task: project(task) });
    },

    async undoSuggestion(id) {
      const review = reviewArtifacts.get(id);
      if (!review?.undoable || !review.artifactFile || !api.undoArtifactSuggestion) {
        throw new NotImplementedError("agent.undoSuggestion", translate("shell.service.suggestionNotUndoable"));
      }
      await api.undoArtifactSuggestion({ suggestionId: id, sourceFile: review.sourceFile, artifactFile: review.artifactFile });
      review.applied = false;
      review.undoable = false;
      persistReviews();
      const task = state.tasks[id];
      if (task) emit({ kind: "task", task: project(task) });
    },

    async startConversation(folderId) {
      threads.set(folderId, { fresh: true });
      localTurns.delete(orphanKey(folderId));
      emit({ kind: "cleared", folderId });
    },

    async openConversation(folderId, conversationId) {
      const entries = await api.getTaskHistory(HISTORY_PAGE).catch(() => [] as TaskHistoryEntry[]);
      if (entries.length > 0) state = mergeHistory(state, hydrate(entries));
      const task = headOf(conversationId);
      if (task && folderOf(task) !== folderId) return null;
      // Picking a conversation is a statement about what the next message
      // continues — and about which runs are "focused" — whether or not
      // anything has been said in it yet.
      threads.set(folderId, { conversationId, fresh: false });
      if (!task) return null;
      if (ACTIVE_STATUSES.includes(task.status)) adoptActive(task.id);
      return project(task);
    },

    async recordExchange({ folderId, conversationId: addressed, messages }) {
      if (messages.length === 0) return;
      const conversationId = addressed ?? focusedConversation(folderId);
      const key = conversationId ?? orphanKey(folderId);
      const turn = { at: messages[0].createdAt || Date.now(), messages: messages.map((message) => ({ ...message })) };
      localTurns.set(key, [...(localTurns.get(key) ?? []), turn]);
      if (!conversationId) return;
      threads.set(folderId, { conversationId, fresh: false });
      const head = headOf(conversationId);
      if (head) emit({ kind: "task", task: project(head), focused: true });
    },
  };
  return service;
}

/**
 * The parts of a submission the desktop cannot carry.
 *
 * The composer gathers context that the legacy bridge cannot carry as
 * structured fields. The run still goes ahead; reported notices make an
 * attachment or review gate that had no effect visible instead of silently
 * dropping it.
 *
 * Full access is the desktop's current direct-write behavior, so it is not
 * reported as dropped. Review mode is honoured on an edit — the result is
 * held as a suggestion with Apply/Undo against the original — and has nothing
 * to hold on a generation, where there is no original; it is reported as
 * dropped only there. Custom permission mode has no runtime gate on either.
 */
export function unsupportedParts(input: SendInput, path: "generate" | "modify"): string[] {
  const dropped: string[] = [];
  if (input.attachments.some((attachment) => !attachment.path)) dropped.push("pathless attachments");
  if (input.permission === "review" && path === "generate") dropped.push("review mode");
  if (input.permission === "custom") dropped.push("custom permission mode");
  return dropped;
}

function droppedNotice(dropped: string[]): string {
  return dropped.some((part) => part === "review mode" || part === "custom permission mode")
    ? translate("shell.service.dropped.with", { parts: droppedLabels(dropped) })
    : translate("shell.service.dropped.without", { parts: droppedLabels(dropped) });
}

/** The ids of the files a message names, through its chips and its quote, each once. */
export function referencedFileIds(input: Pick<SendInput, "mentions" | "reference">): string[] {
  const ids: string[] = [];
  for (const mention of input.mentions) {
    if (mention.kind === "file" && mention.id && !ids.includes(mention.id)) ids.push(mention.id);
  }
  const quoted = input.reference?.fileId;
  if (quoted && !ids.includes(quoted)) ids.push(quoted);
  return ids;
}

/** Whether the message points at anything at all — a file, a folder, a quoted passage. */
function namesAnything(input: Pick<SendInput, "mentions" | "reference" | "attachments">): boolean {
  return input.mentions.length > 0 || input.attachments.length > 0 || Boolean(input.reference);
}

/**
 * Words that ask to see the change before it is applied.
 *
 * Deliberately narrow: a false positive turns a direct edit into a review
 * card, which costs a click; a false negative is the original bug.
 */
const REVIEW_INTENT =
  /先审阅|审阅后|审阅一下|先看一下|先看看|先给我看|看过再|确认后再|确认再|先别(?:改|写|保存|应用)|不要直接(?:改|写|保存|应用)|review (?:it |them |this |that )?(?:first|before)|let me review|for (?:my )?review|before (?:you )?apply(?:ing)?|do(?: not|n't) apply/i;

export function reviewRequestedBy(text: string): boolean {
  return REVIEW_INTENT.test(text);
}

/** How the refusal names what *is* supported. Product names, not type ids. */
const SUPPORTED_OUTPUTS = "PPTX, DOCX, XLSX, PNG";

const DROPPED_LABEL_KEYS: Record<string, string> = {
  "pathless attachments": "shell.service.dropped.pathless",
  "review mode": "shell.service.dropped.review",
  "custom permission mode": "shell.service.dropped.custom",
};

/** `unsupportedParts` keeps stable English ids; this is how they read in the UI. */
function droppedLabels(dropped: string[]): string {
  return dropped
    .map((part) => (DROPPED_LABEL_KEYS[part] ? translate(DROPPED_LABEL_KEYS[part]) : part))
    .join(translate("shell.service.dropped.or"));
}

/** Carries composer context through the existing prompt-only runtime API. */
export function promptWithComposerContext(prompt: string, input: SendInput, requestedFileName?: string | null): string {
  const context: string[] = [];
  if (requestedFileName) {
    context.push(`Requested output file name: ${requestedFileName}`);
  }
  if (input.mentions.length > 0) {
    context.push(`Mentioned files or folders: ${input.mentions.map((mention) => `@${mention.label}`).join(", ")}`);
  }
  const attachments = input.attachments.filter((attachment) => attachment.path);
  if (attachments.length > 0) {
    context.push(`Attached local files: ${attachments.map((attachment) => `${attachment.name} (${attachment.path})`).join(", ")}`);
  }
  const selected = input.reference?.text.trim();
  if (selected) {
    context.push(`Selected passage from ${input.reference?.label ?? "the document"}:\n${selected}`);
  }
  return context.length > 0 ? `${prompt}\n\n${context.join("\n\n")}` : prompt;
}

/** What the runtime is told the conversation-so-far block starts with; see `send`. */
const CONVERSATION_CONTEXT_MARKER = "[Earlier in this conversation — for context only; do not redo these requests]";
/** Turns carried into a follow-up's prompt, newest kept. */
const CONTEXT_TURNS = 6;
/** Ceiling on the whole block, so a long thread cannot crowd out the instruction. */
const CONTEXT_CHARS = 2000;
/** Ceiling on one instruction or reply inside the block. */
const TURN_CHARS = 300;
/** Types `office.modify` can change in place. */
const MODIFIABLE = new Set(["docx", "xlsx", "pptx"]);

/** The statuses a run does not leave on its own; mirrors the reducer's rule. */
function isTerminalStatus(status: DesktopTask["status"]): boolean {
  return status === "completed" || status === "failed" || status === "cancelled";
}

interface SentRun {
  conversationId: string;
  parentTaskId?: string;
  prompt: string;
  /** The file an edit was aimed at, and whether the message named it. */
  target?: { fileName: string; explicit: boolean };
}

interface QueuedSend {
  id: string;
  conversationId: string;
  input: SendInput;
  at: number;
}

interface LocalTurn {
  at: number;
  messages: AgentMessage[];
}

/** The instruction as typed, without the conversation block `send` appended. */
export function stripConversationContext(prompt: string): string {
  const index = prompt.indexOf(`\n\n${CONVERSATION_CONTEXT_MARKER}`);
  return index < 0 ? prompt : prompt.slice(0, index);
}

function clip(text: string, limit: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > limit ? `${flat.slice(0, limit - 1)}…` : flat;
}
