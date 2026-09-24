/**
 * A scripted stand-in for the agent service: no model, no network, just the
 * phase progression the shell has to render — working → preparing → awaiting
 * review → applied/undone, with pause and resume.
 *
 * Timers are injected so tests can drive the machine without waiting.
 */

import type {
  AgentEvent,
  AgentPort,
  AgentStatus,
  AgentSuggestion,
  AgentTask,
  FileMeta,
  ImageGenerationInput,
  SendInput,
} from "../../../shared/uiPort";
import { imageDimensions } from "../../../shared/imageGeneration";

export interface FakeAgentDeps {
  /** Reads current file metadata, so suggestion summaries name a real file. */
  getFiles(): FileMeta[];
  /** Called when a suggestion is applied or undone, so the file goes dirty. */
  markDirty(fileId: string, dirty: boolean): void;
  /**
   * Files a finished image run into the library. Optional so the agent can be
   * built on its own in tests that never send an image.
   */
  addImage?(folderId: string, name: string, taskId: string, size: [number, number], seed: number): FileMeta;
  /**
   * Block the run on a question before it does any work.
   *
   * Off by default so the scripted run stays the straight line every other test
   * expects. On, it is the one shape the real runtime has that this fake
   * otherwise cannot produce — and the one the shell used to have no way
   * through.
   */
  asksQuestion?: boolean;
  /**
   * Tasks the fake starts life holding, one per folder.
   *
   * The scripted run only ever produces the task it is running, so every status
   * that is not on that path — paused, done, a second live run — was
   * unreachable, and Home's task list could only ever be empty or hold one row.
   * The UI audit needs all of them on screen at once. Keyed by `folderId` on the
   * way in, matching how `ensureTask` stores them; a later `send` into the same
   * folder resumes the seeded task rather than replacing it.
   */
  seedTasks?: AgentTask[];
  setTimeout?: (fn: () => void, ms: number) => unknown;
  clearTimeout?: (handle: unknown) => void;
  now?: () => number;
}

const PHASES: ReadonlyArray<{ status: AgentStatus; phase: string; delay: number }> = [
  { status: "reading", phase: "Reading your instructions and the current file", delay: 900 },
  { status: "writing", phase: "Preparing suggested changes", delay: 1400 },
];

let counter = 0;
const nextId = (prefix: string) => `${prefix}-${(counter += 1)}`;

export function createFakeAgent(deps: FakeAgentDeps): AgentPort {
  const schedule = deps.setTimeout ?? ((fn, ms) => setTimeout(fn, ms));
  const cancel = deps.clearTimeout ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  const now = deps.now ?? (() => Date.now());

  const tasks = new Map<string, AgentTask>();
  for (const task of deps.seedTasks ?? []) tasks.set(task.folderId, structuredClone(task));
  const listeners = new Set<(event: AgentEvent) => void>();

  let timer: unknown = null;
  let queue: Array<() => void> = [];
  let paused = false;
  let runningFolderId: string | null = null;

  const emit = (task: AgentTask) => {
    const snapshot: AgentEvent = { kind: "task", task: structuredClone(task) };
    for (const listener of listeners) listener(snapshot);
  };

  /** One task per folder is one conversation per folder: a new one replaces it. */
  const clear = (folderId: string) => {
    tasks.delete(folderId);
    const event: AgentEvent = { kind: "cleared", folderId };
    for (const listener of listeners) listener(event);
  };

  const stop = () => {
    if (timer !== null) cancel(timer);
    timer = null;
    queue = [];
  };

  const pump = () => {
    if (paused || timer !== null) return;
    const step = queue.shift();
    if (!step) return;
    step();
  };

  /** Queues `fn` to run after `delay`, respecting pause. */
  const after = (delay: number, fn: () => void) => {
    queue.push(() => {
      timer = schedule(() => {
        timer = null;
        fn();
        pump();
      }, delay);
    });
  };

  function suggestionFor(task: AgentTask, input: SendInput): AgentSuggestion {    const inScope = deps.getFiles().filter((file) => file.folderId === task.folderId);
    const target =
      inScope.find((file) => file.id === input.activeFileId) ?? inScope[0] ?? deps.getFiles()[0];
    const summary =
      target?.type === "sheet"
        ? `Update the forecast rows in ${target.name} and refresh the linked totals.`
        : target?.type === "slides"
          ? `Add a closing "Next steps" slide to ${target.name}.`
          : `Append a launch checklist to ${target?.name ?? "the current file"}, keeping the existing content.`;
    return { id: nextId("suggestion"), targetFileId: target?.id ?? "", summary, applied: false, undoable: false };
  }

  function ensureTask(folderId: string, title: string): AgentTask {
    const existing = tasks.get(folderId);
    if (existing) return existing;
    const created: AgentTask = {
      id: nextId("task"),
      title,
      folderId,
      status: "idle",
      phase: "",
      steps: [],
      messages: [],
      suggestion: null,
      // Set only when `asksQuestion` is on; the default script runs straight
      // through without blocking on anything.
      question: null,
    };
    tasks.set(folderId, created);
    return created;
  }

  /** The scripted run: read, draft, hand back a suggestion. */
  function startRun(task: AgentTask): void {
    const input: SendInput = {
      text: task.messages.at(-1)?.text ?? "",
      folderId: task.folderId,
      mentions: [],
      attachments: [],
      activeFileId: null,
      modelId: "",
      permission: "full",
    };
    task.suggestion = null;
    task.status = "working";
    task.phase = PHASES[0].phase;
    task.steps = [
      { id: nextId("step"), label: "Read the files in scope", state: "active" },
      { id: nextId("step"), label: "Draft the change", state: "pending" },
      { id: nextId("step"), label: "Hand back for review", state: "pending" },
    ];
    emit(task);

    PHASES.forEach((entry, index) => {
      after(entry.delay, () => {
        task.status = entry.status;
        task.phase = entry.phase;
        task.steps.forEach((step, stepIndex) => {
          step.state = stepIndex < index + 1 ? "done" : stepIndex === index + 1 ? "active" : "pending";
        });
        emit(task);
      });
    });

    after(700, () => {
      task.status = "awaiting-review";
      task.phase = "Suggested changes are ready";
      task.steps.forEach((step) => {
        step.state = "done";
      });
      task.suggestion = suggestionFor(task, input);
      task.messages.push({
        id: nextId("message"),
        role: "agent",
        text: `${task.suggestion.summary} Review and apply when you are ready.`,
        createdAt: now(),
      });
      emit(task);
    });

    pump();
  }

  /**
   * The scripted image run: a pause, then one file per requested picture.
   *
   * Mirrors the desktop service's shape rather than the document run above:
   * every picture is its own run in the task's series, a change to a version
   * continues that version's series, and the task emitted when a run lands
   * carries the run's id — that id is what the shell opens the new file by.
   */
  let imageSeed = 0;
  function runImage(input: SendInput, image: ImageGenerationInput): void {
    const files = deps.getFiles();
    const baseRun = image.baseFileId ? files.find((file) => file.id === image.baseFileId)?.artifactTaskId : undefined;
    const existing = tasks.get(input.folderId);
    const continuing = Boolean(baseRun && existing?.image?.runs.some((run) => run.taskId === baseRun));
    const title = input.text.length > 60 ? `${input.text.slice(0, 60)}…` : input.text;
    const task: AgentTask = continuing && existing
      ? existing
      : {
          id: nextId("task"),
          title,
          folderId: input.folderId,
          documentType: "img",
          status: "idle",
          phase: "",
          steps: [],
          messages: [],
          suggestion: null,
          question: null,
          image: { runs: [] },
        };
    // Re-inserted so a new picture lists as the newest task: a Map keeps a
    // replaced key in its old slot, which put a fresh run below stale ones.
    tasks.delete(input.folderId);
    tasks.set(input.folderId, task);
    const series = task.image!;
    const count = Math.min(4, Math.max(1, image.count));
    const started = Array.from({ length: count }, () => ({
      taskId: nextId("image-run"),
      status: "running" as const,
      prompt: input.text,
      ...(baseRun ? { baseTaskId: baseRun } : {}),
    }));
    series.runs.push(...started);
    task.messages.push({ id: nextId("message"), role: "user", text: input.text, createdAt: now() });
    task.status = "writing";
    task.phase = "Creating image";
    task.id = started[0].taskId;
    emit(task);

    const size = image.ratio === "auto" ? ([1600, 1600] as [number, number]) : imageDimensions(image);
    const slug = (continuing ? task.title : title).replace(/[\\/:*?"<>|…]+/g, "").trim().slice(0, 40) || "Image";
    started.forEach((run, index) => {
      after(index === 0 ? 2200 : 500, () => {
        const version = series.runs.indexOf(run) + 1;
        const live = series.runs.find((entry) => entry.taskId === run.taskId);
        if (!live || live.status !== "running") return;
        deps.addImage?.(input.folderId, version === 1 ? `${slug}.png` : `${slug} v${version}.png`, run.taskId, size, (imageSeed += 1));
        Object.assign(live, { status: "done" });
        const pending = series.runs.some((entry) => entry.status === "running");
        task.status = pending ? "writing" : "done";
        task.phase = pending ? "Creating image" : "Image ready";
        // The last landing names the batch's first picture: a new batch opens
        // on its first version, as the prototype does.
        task.id = pending ? run.taskId : started[0].taskId;
        emit(task);
      });
    });
    pump();
  }

  return {
    async current(folderId) {
      const task = tasks.get(folderId);
      return task ? structuredClone(task) : null;
    },

    /**
     * Every folder's task: whatever is live first, then newest-created.
     *
     * `tasks` is keyed by folder and only ever inserted into once, so its
     * iteration order is creation order — it says nothing about what was
     * touched most recently. Sorting live runs to the front is the closest
     * this fake gets to the real service, which orders by the runtime's own
     * history timestamps.
     */
    async list(options) {
      const live = (status: AgentTask["status"]) =>
        status === "working" || status === "reading" || status === "writing" || status === "paused";
      const rows = [...tasks.values()]
        .reverse()
        .sort((a, b) => Number(live(b.status)) - Number(live(a.status)))
        .map((task) => ({
          // An image task's id moves to whichever run landed last; the row
          // keeps the series' first run, as the desktop service does.
          id: task.image?.runs[0]?.taskId ?? task.id,
          title: task.title,
          folderId: task.folderId,
          status: task.status,
          phase: task.phase,
          ...(task.image ? { image: structuredClone(task.image) } : {}),
        }));
      return options?.limit === undefined ? rows : rows.slice(0, options.limit);
    },

    // Answering releases the run the question was blocking. Without a pending
    // question there is nothing to release, which is what the real service does
    // too.
    async answer(input) {
      const task = runningFolderId ? tasks.get(runningFolderId) : undefined;
      if (!task?.question) return;
      task.messages.push({
        id: nextId("message"),
        role: "user",
        text: input.optionId
          ? (task.question.options.find((option) => option.id === input.optionId)?.label ?? input.optionId)
          : (input.text ?? ""),
        createdAt: now(),
      });
      task.question = null;
      startRun(task);
    },

    async send(input) {
      stop();
      paused = false;
      runningFolderId = input.folderId;
      if (input.newConversation) clear(input.folderId);

      if (input.imageGeneration) {
        runImage(input, input.imageGeneration);
        return;
      }

      const title = input.text.length > 60 ? `${input.text.slice(0, 60)}…` : input.text;
      const task = ensureTask(input.folderId, title);
      if (task.messages.length === 0) task.title = title;
      // The real service routes on it; the task panel offers Pause only for decks.
      if (input.documentType) task.documentType = input.documentType;

      task.messages.push({
        id: nextId("message"),
        role: "user",
        text: input.text,
        reference: input.reference,
        createdAt: now(),
      });

      // A question blocks before any work happens, the way a plan review does.
      if (task.question) {
        await this.answer({ text: input.text });
        return;
      }
      if (deps.asksQuestion) {
        task.suggestion = null;
        task.steps = [];
        task.status = "awaiting-review";
        task.phase = "Waiting for your answer";
        task.question = {
          id: nextId("question"),
          text: "Who is this for?",
          options: [
            { id: "exec", label: "Executives", description: "Short, outcome first", recommended: true },
            { id: "team", label: "The project team" },
          ],
          allowFreeform: true,
        };
        emit(task);
        return;
      }

      startRun(task);
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    async pause() {
      if (paused) return;
      paused = true;
      if (timer !== null) {
        cancel(timer);
        timer = null;
      }
      const task = runningFolderId ? tasks.get(runningFolderId) : null;
      if (!task) return;
      task.status = "paused";
      task.phase = "Task paused";
      emit(task);
    },

    async resume() {
      if (!paused) return;
      paused = false;
      const task = runningFolderId ? tasks.get(runningFolderId) : null;
      if (task) {
        task.status = "working";
        task.phase = PHASES[0].phase;
        emit(task);
      }
      pump();
    },

    async finish() {
      stop();
      paused = false;
      const task = runningFolderId ? tasks.get(runningFolderId) : null;
      if (!task) return;
      for (const run of task.image?.runs ?? []) {
        if (run.status === "running") Object.assign(run, { status: "cancelled" });
      }
      task.status = "done";
      task.phase = "Task complete";
      task.steps.forEach((step) => {
        step.state = "done";
      });
      emit(task);
    },

    async resumeFailed(taskId) {
      const task = [...tasks.values()].find((candidate) => candidate.id === taskId);
      if (!task?.recovery) throw new Error("This run left nothing to pick up from. Start it again instead.");
      stop();
      paused = false;
      runningFolderId = task.folderId;
      delete task.recovery;
      startRun(task);
    },

    async applySuggestion(id) {
      for (const task of tasks.values()) {
        if (task.suggestion?.id !== id || task.suggestion.applied) continue;
        task.suggestion.applied = true;
        task.suggestion.undoable = true;
        deps.markDirty(task.suggestion.targetFileId, true);
        task.messages.push({
          id: nextId("message"),
          role: "agent",
          text: "Changes applied. You can keep editing, or undo them.",
          createdAt: now(),
        });
        task.status = "done";
        task.phase = "Changes applied";
        emit(task);
        return;
      }
    },

    async undoSuggestion(id) {
      for (const task of tasks.values()) {
        if (task.suggestion?.id !== id || !task.suggestion.undoable) continue;
        task.suggestion.applied = false;
        task.suggestion.undoable = false;
        deps.markDirty(task.suggestion.targetFileId, false);
        task.messages.push({
          id: nextId("message"),
          role: "agent",
          text: "Reverted. The file is back to its previous content.",
          createdAt: now(),
        });
        task.phase = "Change reverted";
        emit(task);
        return;
      }
    },

    async startConversation(folderId) {
      if (runningFolderId === folderId) stop();
      clear(folderId);
    },

    // The desktop keeps an edit made before any conversation for the next one;
    // the fake has nowhere to put it until a task exists, and drops it.
    async recordExchange({ folderId, messages }) {
      const task = tasks.get(folderId);
      if (!task) return;
      const seen = new Set(task.messages.map((message) => message.id));
      task.messages.push(...messages.filter((message) => !seen.has(message.id)).map((message) => ({ ...message })));
      emit(task);
    },
  };
}
