import type { BridgeEvent, DesktopAPI, DesktopTask, GenerateInput, TaskHistoryEntry } from "../shared/types";
import type { AgentEvent, AgentMessage, AgentOutlinePage, AgentPort, AgentStatus, AgentStep, AgentTask, AgentTaskSummary, SendInput } from "../shared/uiPort";
import { pptxPageStates } from "../renderer/presentation/pptxRuntimeActivity";
import { NotImplementedError } from "../shared/notImplemented";
import { applyTaskEvent, attachTaskContext, createInitialTaskState, type TaskState } from "../renderer/taskState";
import { taskTitle } from "../renderer/taskTitle";
import { inferHomeTaskRoute } from "../renderer/homeIntake";
import { DEFAULT_FOLDER_ID } from "./files";

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

function toStatus(task: DesktopTask): AgentStatus {
  switch (task.status) {
    case "starting":
      return "working";
    case "running":
      // The active stage says more than "running" does, and the contract has
      // two states for it.
      return task.activeStageId?.includes("draw") || task.activeStageId?.includes("write")
        ? "writing"
        : "reading";
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
  if (task.status === "question") return "Waiting for your answer";
  if (task.status === "plan_review") return "Waiting for your review";
  if (task.status === "failed") return task.error?.trim() || "The run stopped";
  if (task.status === "completed") return "Done";
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
      text: task.userInput.prompt,
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
      text: task.error,
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
  const question = task.question;
  if (!question?.id) return null;
  const active = question.questions?.[question.currentIndex ?? 0];
  return {
    id: question.id,
    text: (active?.question || question.question || "").trim(),
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

function toAgentTask(task: DesktopTask): AgentTask {
  const documentType = task.documentType === "docx" || task.documentType === "xlsx" || task.documentType === "pptx"
    ? task.documentType
    : undefined;
  return {
    id: task.id,
    title: taskTitle(task, "Untitled task"),
    folderId: task.workspaceId?.trim() || DEFAULT_FOLDER_ID,
    documentType,
    status: toStatus(task),
    phase: phaseOf(task),
    steps: toSteps(task),
    messages: toMessages(task),
    outline: toOutline(task),
    // No desktop model for proposed-then-applied changes; see the header.
    suggestion: null,
    question: toQuestion(task),
  };
}

interface ReviewArtifactState {
  sourceFileId: string;
  sourceFile: string;
  artifactFile?: string;
  applied: boolean;
  undoable: boolean;
}

function toAgentTaskWithReview(task: DesktopTask, review?: ReviewArtifactState): AgentTask {
  const result = toAgentTask(task);
  if (!review || !review.artifactFile) return result;
  return {
    ...result,
    suggestion: {
      id: task.id,
      targetFileId: review.sourceFileId,
      summary: `Review the generated ${task.documentType?.toUpperCase() ?? "document"} changes before applying them.`,
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
    title: taskTitle(task, "Untitled task"),
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
  const reviewArtifacts = new Map<string, ReviewArtifactState>();
  const listeners = new Set<(event: AgentEvent) => void>();

  const emit = (event: AgentEvent) => {
    for (const listener of listeners) listener(event);
  };

  /** The active run and its question, when it is blocked on one. */
  const pendingQuestion = (): { taskId: string; question: NonNullable<AgentTask["question"]> } | null => {
    const task = activeTaskId ? state.tasks[activeTaskId] : undefined;
    if (!task) return null;
    const question = toQuestion(task);
    return question ? { taskId: task.id, question } : null;
  };

  // Subscribed for the service's whole life rather than per listener: task
  // state has to keep up with the bridge even while nothing is watching, or a
  // run started before the first subscriber would be invisible afterwards.
  api.onBridgeEvent((event: BridgeEvent) => {
    if (!event.task_id) return;
    state = applyTaskEvent(state, event);
    const task = state.tasks[event.task_id];
    if (!task) return;
    if (ACTIVE_STATUSES.includes(task.status)) activeTaskId = task.id;
    const review = reviewArtifacts.get(task.id);
    if (review && task.status === "completed" && task.artifact?.filePath) review.artifactFile = task.artifact.filePath;
    emit({ kind: "task", task: toAgentTaskWithReview(task, review) });
    // The contract has no failed status, so a failure is reported twice: the
    // task turns `done`, and this says why.
    if (task.status === "failed" && task.error) {
      emit({ kind: "error", message: task.error });
    }
  });

  return {
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
      const task = pickForFolder(state, folderId);
      if (!task) return null;
      if (ACTIVE_STATUSES.includes(task.status)) activeTaskId = task.id;
      return toAgentTaskWithReview(task, reviewArtifacts.get(task.id));
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
      return state.taskOrder
        .map((id) => state.tasks[id])
        .filter((task): task is DesktopTask => Boolean(task))
        .sort((left, right) => updatedAtOf(right) - updatedAtOf(left))
        .slice(0, options?.limit ?? LIST_LIMIT)
        .map(toSummary);
    },

    async send(input: SendInput) {
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
      const pending = pendingQuestion();
      if (pending) {
        if (!pending.question.allowFreeform && pending.question.options.length > 0) {
          emit({
            kind: "notice",
            message: "Pick one of the options above to continue — this question does not take a typed answer.",
          });
          return;
        }
        await this.answer({ text });
        return;
      }

      const dropped = unsupportedParts(input);
      if (dropped.length > 0) {
      emit({
        kind: "notice",
        message: dropped.some((part) => part === "review mode" || part === "custom permission mode")
          ? `Sent with ${dropped.join(" or ")} unavailable in the current runtime. The source file stays unchanged and the result is written as a separate artifact.`
          : `Sent without ${dropped.join(" or ")} — the current runtime has no file path for those attachments.`,
      });
      }

      const settings = await api.getSettings();
      const workspaceId = input.folderId === DEFAULT_FOLDER_ID ? undefined : input.folderId;

      // Editing what is open, or starting something new. The document type of a
      // new run is inferred from the instruction by the same rules the old Home
      // used — the contract carries no type field.
      if (input.activeFileId) {
        const record = await api.getDocument(input.activeFileId);
        const result = await api.modify({
          documentType: record.documentType as GenerateInput["documentType"],
          sourceFile: record.filePath,
          prompt: promptWithComposerContext(text, input),
          ...(workspaceId ? { workspaceId } : { noProject: true }),
        });
        if (input.permission !== "full") {
          reviewArtifacts.set(result.taskId, {
            sourceFileId: record.id,
            sourceFile: record.filePath,
            applied: false,
            undoable: false,
          });
        }
        activeTaskId = result.taskId;
        return;
      }

      const route = inferHomeTaskRoute({ prompt: text }, settings.defaults.documentType);
      if (route.kind === "needs_source") {
        throw new Error("That request needs a file to work from. Open one first.");
      }
      const result = await api.generate({
        documentType: route.documentType,
        topic: text.slice(0, 64),
        prompt: promptWithComposerContext(text, input),
        ...(route.sourceFile ? { sourceFile: route.sourceFile } : {}),
        ...(workspaceId ? { workspaceId } : { noProject: true }),
        enableImages: settings.defaults.enableImages,
        imageQuality: settings.defaults.imageQuality,
      });
      activeTaskId = result.taskId;
    },

    /**
     * Unblocks a waiting run.
     *
     * `optionId` when the user picked one of the offered options, `text` when
     * they typed. The runtime wants the question id back with the answer, so a
     * question that has already been superseded is dropped rather than replied
     * to with a stale id.
     */
    async answer(input: { optionId?: string; text?: string }) {
      const pending = pendingQuestion();
      if (!pending) return;
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
      const task = activeTaskId ? state.tasks[activeTaskId] : undefined;
      if (!task) return;
      if (!api.pausePptx || task.documentType !== "pptx") {
        // Saying so beats a button that silently does nothing. Holding a run at
        // a boundary only exists for presentations today.
        throw new NotImplementedError(
          "agent.pause",
          "Pausing only works while a presentation is being drawn. This run cannot be held.",
        );
      }
      await api.pausePptx(task.id);
    },

    async resume() {
      const task = activeTaskId ? state.tasks[activeTaskId] : undefined;
      if (!task) return;
      if (!api.resumePptxLive || task.documentType !== "pptx") {
        throw new NotImplementedError(
          "agent.resume",
          "Resuming only works while a presentation is being drawn.",
        );
      }
      await api.resumePptxLive(task.id);
    },

    async finish() {
      if (!activeTaskId) return;
      // `cancel` is the closest the desktop has. The promises differ in wording
      // — finish keeps what was applied, cancel stops the run — but the outcome
      // matches: a cancelled run's output stays on disk as its partial artifact.
      await api.cancel(activeTaskId);
      activeTaskId = undefined;
    },

    async applySuggestion(id) {
      const review = reviewArtifacts.get(id);
      if (!review?.artifactFile || !api.applyArtifactSuggestion) {
        throw new NotImplementedError("agent.applySuggestion", "This agent result is not available as a reviewable artifact yet.");
      }
      await api.applyArtifactSuggestion({ suggestionId: id, sourceFile: review.sourceFile, artifactFile: review.artifactFile });
      review.applied = true;
      review.undoable = true;
      const task = state.tasks[id];
      if (task) emit({ kind: "task", task: toAgentTaskWithReview(task, review) });
    },

    async undoSuggestion(id) {
      const review = reviewArtifacts.get(id);
      if (!review?.undoable || !review.artifactFile || !api.undoArtifactSuggestion) {
        throw new NotImplementedError("agent.undoSuggestion", "This agent result is no longer undoable.");
      }
      await api.undoArtifactSuggestion({ suggestionId: id, sourceFile: review.sourceFile, artifactFile: review.artifactFile });
      review.applied = false;
      review.undoable = false;
      const task = state.tasks[id];
      if (task) emit({ kind: "task", task: toAgentTaskWithReview(task, review) });
    },
  };
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
 * reported as dropped. Review and custom permission modes still have no
 * matching runtime gate and are called out explicitly.
 */
function unsupportedParts(input: SendInput): string[] {
  const dropped: string[] = [];
  if (input.attachments.some((attachment) => !attachment.path)) dropped.push("pathless attachments");
  if (input.permission === "review") dropped.push("review mode");
  if (input.permission === "custom") dropped.push("custom permission mode");
  return dropped;
}

/** Carries composer context through the existing prompt-only runtime API. */
function promptWithComposerContext(prompt: string, input: SendInput): string {
  const context: string[] = [];
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
