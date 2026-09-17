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
  SendInput,
} from "../types";

export interface FakeAgentDeps {
  /** Reads current file metadata, so suggestion summaries name a real file. */
  getFiles(): FileMeta[];
  /** Called when a suggestion is applied or undone, so the file goes dirty. */
  markDirty(fileId: string, dirty: boolean): void;
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
  const listeners = new Set<(event: AgentEvent) => void>();

  let timer: unknown = null;
  let queue: Array<() => void> = [];
  let paused = false;
  let runningFolderId: string | null = null;

  const emit = (task: AgentTask) => {
    const snapshot: AgentEvent = { kind: "task", task: structuredClone(task) };
    for (const listener of listeners) listener(snapshot);
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

  function suggestionFor(task: AgentTask, input: SendInput): AgentSuggestion {
    const inScope = deps.getFiles().filter((file) => file.folderId === task.folderId);
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
    };
    tasks.set(folderId, created);
    return created;
  }

  return {
    async current(folderId) {
      const task = tasks.get(folderId);
      return task ? structuredClone(task) : null;
    },

    async send(input) {
      stop();
      paused = false;
      runningFolderId = input.folderId;

      const title = input.text.length > 60 ? `${input.text.slice(0, 60)}…` : input.text;
      const task = ensureTask(input.folderId, title);
      if (task.messages.length === 0) task.title = title;

      task.messages.push({
        id: nextId("message"),
        role: "user",
        text: input.text,
        reference: input.reference,
        createdAt: now(),
      });
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
      task.status = "done";
      task.phase = "Task complete";
      task.steps.forEach((step) => {
        step.state = "done";
      });
      emit(task);
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
  };
}
