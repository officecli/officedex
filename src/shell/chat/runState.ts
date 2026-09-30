import type { AgentTask } from "../../shared/uiPort";
import type { DexState } from "../dex/faceRenderer";

/**
 * The states a run can be seen in — AGENT-STATE-STANDARD §03.
 *
 * `permission` (Needs approval) is a gate before a run exists and is drawn by
 * the conversation, not from a task; the other twelve are read off the task
 * here. Planning, Reading, Preparing changes and Checking are four phases of
 * one running task, not four tasks.
 */
export type RunState =
  | "queued"
  | "planning"
  | "reading"
  | "working"
  | "checking"
  | "input"
  | "review"
  | "complete"
  | "stopped"
  | "failed"
  | "partial"
  | "offline";

export const isRunning = (state: RunState | null): boolean =>
  state === "planning" || state === "reading" || state === "working" || state === "checking";

/**
 * What the task says is happening, in the standard's vocabulary.
 *
 * Read from the task's own status and outcome — never from elapsed time or
 * from which animation has finished (§04: "不能仅依靠经过秒数推测当前阶段").
 */
export function runStateOf(task: AgentTask | null): RunState | null {
  if (!task) return null;
  switch (task.status) {
    case "idle":
      return null;
    case "working":
      return "planning";
    case "reading":
      return "reading";
    case "writing": {
      // The last stage of a run is its check; everything before it is the work.
      const active = task.steps.findIndex((step) => step.state === "active");
      return task.steps.length > 1 && active === task.steps.length - 1 ? "checking" : "working";
    }
    case "paused":
      return "stopped";
    case "awaiting-review":
      return task.question ? "input" : "review";
    case "done":
      switch (task.outcome) {
        case "failed":
          return "failed";
        case "stopped":
          return "stopped";
        case "partial":
          return "partial";
        case "interrupted":
          return "offline";
        default:
          // How the run ended outranks what it left behind: a partial result
          // with changes to review is still partial, and says so.
          if (task.suggestion && !task.suggestion.applied) return "review";
          // A record from before outcomes were reported: recovery means it failed.
          return task.recovery ? "partial" : "complete";
      }
  }
}

export const RUN_TITLE_KEY: Record<RunState, string> = {
  queued: "dx.run.queued",
  planning: "dx.run.planning",
  reading: "dx.run.reading",
  working: "dx.run.working",
  checking: "dx.run.checking",
  input: "dx.run.input",
  review: "dx.run.review",
  complete: "dx.run.complete",
  stopped: "dx.run.stopped",
  failed: "dx.run.failed",
  partial: "dx.run.partial",
  offline: "dx.run.offline",
};

/** The `data-status` the stylesheet colours the status line by. */
export const RUN_DATA_STATUS: Record<RunState, string> = {
  queued: "queued",
  planning: "preparing",
  reading: "running",
  working: "running",
  checking: "running",
  input: "waiting",
  review: "review",
  complete: "completed",
  stopped: "stopped",
  failed: "failed",
  partial: "partial",
  offline: "interrupted",
};

/**
 * The expression Dex wears for a run — AGENT-STATE-STANDARD §10.
 *
 * Planning → think, Reading → read, preparing text → write, preparing
 * structured content → fill, awaiting review → review, needing a decision →
 * confirm, stopped → paused, queued → queued, error → retry, no connection →
 * offline. Checking has no expression of its own and wears `review`; it is the
 * words "Checking results" that say what is happening.
 */
export function dexStateFor(state: RunState | null, task: AgentTask | null): DexState | null {
  switch (state) {
    case "planning":
      return "think";
    case "reading":
      return "read";
    case "working":
      return task?.documentType === "xlsx" ? "fill" : "write";
    case "checking":
    case "review":
      return "review";
    case "input":
      return "confirm";
    case "stopped":
      return "paused";
    case "queued":
      return "queued";
    case "failed":
    case "partial":
      return "retry";
    case "offline":
      return "offline";
    default:
      return null;
  }
}
