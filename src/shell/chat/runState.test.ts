/**
 * What a task looks like in the standard's vocabulary — AGENT-STATE-STANDARD §03.
 *
 * Read off the record and nothing else. These walk every `status`, and every
 * `outcome` a `done` record can carry, because the mapping is the one place the
 * whole card's wording, colour and action set is decided: get "partial" wrong
 * here and the run offers "Retry" instead of "Retry remaining" everywhere.
 */
import { describe, expect, it } from "vitest";

import type { AgentOutcome, AgentStatus, AgentSuggestion, AgentTask } from "../../shared/uiPort";
import {
  RUN_DATA_STATUS,
  RUN_TITLE_KEY,
  dexStateFor,
  isRunning,
  runStateOf,
  type RunState,
} from "./runState";

const ALL_STATES: RunState[] = [
  "queued",
  "planning",
  "reading",
  "working",
  "checking",
  "input",
  "review",
  "complete",
  "stopped",
  "failed",
  "partial",
  "offline",
];

const task = (patch: Partial<AgentTask> = {}): AgentTask => ({
  id: "run",
  title: "Launch plan & copy",
  folderId: "launch",
  status: "working",
  phase: "",
  steps: [],
  messages: [],
  suggestion: null,
  question: null,
  ...patch,
});

/** Four steps with one of them active, which is how a run reports its phase. */
const steps = (active: number): AgentTask["steps"] =>
  ["plan", "read", "edit", "check"].map((id, index) => ({
    id,
    label: id,
    state: index < active ? "done" : index === active ? "active" : "pending",
  }));

const pending: AgentSuggestion = {
  id: "s1",
  targetFileId: "readme",
  summary: "Clarify the next step and owner.",
  applied: false,
  undoable: false,
};

describe("runStateOf", () => {
  it("has nothing to report without a task", () => {
    expect(runStateOf(null)).toBeNull();
  });

  it("reads each running status as its own phase", () => {
    expect(runStateOf(task({ status: "idle" }))).toBeNull();
    expect(runStateOf(task({ status: "working" }))).toBe("planning");
    expect(runStateOf(task({ status: "reading" }))).toBe("reading");
    expect(runStateOf(task({ status: "paused" }))).toBe("stopped");
  });

  /*
   * `writing` is two states: the last step of a run is its check, everything
   * before it is the work. A single-step run has no check to distinguish.
   */
  it("separates the final check from the work it checks", () => {
    expect(runStateOf(task({ status: "writing", steps: steps(2) }))).toBe("working");
    expect(runStateOf(task({ status: "writing", steps: steps(3) }))).toBe("checking");
    expect(runStateOf(task({ status: "writing", steps: [] }))).toBe("working");
    expect(runStateOf(task({ status: "writing", steps: steps(0).slice(0, 1) }))).toBe("working");
  });

  it("tells a blocking question apart from changes to look at", () => {
    const question = { id: "q", text: "Who is this for?", options: [], allowFreeform: true };
    expect(runStateOf(task({ status: "awaiting-review", question }))).toBe("input");
    expect(runStateOf(task({ status: "awaiting-review", suggestion: pending }))).toBe("review");
  });

  // How the run ended outranks what it left behind: a partial result with
  // changes to review is still partial, and the card has to say so.
  it("lets the outcome outrank a pending suggestion", () => {
    const outcomes: Array<[AgentOutcome, RunState]> = [
      ["failed", "failed"],
      ["stopped", "stopped"],
      ["partial", "partial"],
      ["interrupted", "offline"],
    ];
    for (const [outcome, expected] of outcomes) {
      expect(runStateOf(task({ status: "done", outcome }))).toBe(expected);
      expect(runStateOf(task({ status: "done", outcome, suggestion: pending }))).toBe(expected);
    }
  });

  it("calls a finished run with changes waiting a review", () => {
    expect(runStateOf(task({ status: "done", outcome: "completed", suggestion: pending }))).toBe("review");
    // Applied changes are not waiting for anything.
    expect(
      runStateOf(task({ status: "done", outcome: "completed", suggestion: { ...pending, applied: true } })),
    ).toBe("complete");
    expect(runStateOf(task({ status: "done", outcome: "completed" }))).toBe("complete");
    // A record from before outcomes were reported.
    expect(runStateOf(task({ status: "done" }))).toBe("complete");
  });

  // Recovery data only exists on a run that failed with pages worth keeping, so
  // an outcome-less `done` record carrying it did not complete.
  it("reads recovery data on an outcome-less record as partly done", () => {
    expect(runStateOf(task({ status: "done", recovery: { readyPages: 2, totalPages: 5 } }))).toBe("partial");
  });

  it("answers for every status the port can report", () => {
    const statuses: AgentStatus[] = ["idle", "reading", "writing", "working", "paused", "awaiting-review", "done"];
    for (const status of statuses) {
      expect(() => runStateOf(task({ status }))).not.toThrow();
    }
  });
});

describe("isRunning", () => {
  it("is true for the four phases of one running task and nothing else", () => {
    const running = ALL_STATES.filter((state) => isRunning(state));
    expect(running).toEqual(["planning", "reading", "working", "checking"]);
    expect(isRunning(null)).toBe(false);
  });
});

describe("the tables the card reads", () => {
  it("names a title and a data-status for every state", () => {
    expect(Object.keys(RUN_TITLE_KEY).sort()).toEqual([...ALL_STATES].sort());
    expect(Object.keys(RUN_DATA_STATUS).sort()).toEqual([...ALL_STATES].sort());
  });

  it("keeps the four running phases apart in words but together in colour", () => {
    // The stylesheet colours "running"; the words are what say which phase.
    expect(new Set(Object.values(RUN_TITLE_KEY)).size).toBe(ALL_STATES.length);
    expect(RUN_DATA_STATUS.reading).toBe("running");
    expect(RUN_DATA_STATUS.working).toBe("running");
    expect(RUN_DATA_STATUS.checking).toBe("running");
    expect(RUN_DATA_STATUS.planning).toBe("preparing");
  });
});

describe("dexStateFor", () => {
  it("wears one expression per state", () => {
    expect(dexStateFor("planning", task())).toBe("think");
    expect(dexStateFor("reading", task())).toBe("read");
    expect(dexStateFor("input", task())).toBe("confirm");
    expect(dexStateFor("stopped", task())).toBe("paused");
    expect(dexStateFor("queued", task())).toBe("queued");
    expect(dexStateFor("failed", task())).toBe("retry");
    expect(dexStateFor("partial", task())).toBe("retry");
    expect(dexStateFor("offline", task())).toBe("offline");
  });

  // Structured content is filled in, prose is written.
  it("fills a workbook and writes everything else", () => {
    expect(dexStateFor("working", task({ documentType: "xlsx" }))).toBe("fill");
    expect(dexStateFor("working", task({ documentType: "docx" }))).toBe("write");
    expect(dexStateFor("working", task())).toBe("write");
    expect(dexStateFor("working", null)).toBe("write");
  });

  // Checking has no expression of its own; the words say what is happening.
  it("gives checking the review face", () => {
    expect(dexStateFor("checking", task())).toBe("review");
    expect(dexStateFor("review", task())).toBe("review");
  });

  it("has no expression for a finished run or no run at all", () => {
    expect(dexStateFor("complete", task())).toBeNull();
    expect(dexStateFor(null, null)).toBeNull();
  });
});
