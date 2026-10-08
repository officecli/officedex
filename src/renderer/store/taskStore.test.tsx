/**
 * The task store, and the document projection it exposes.
 *
 * The projection is the point of this file. `projectTaskStateToDocuments` has
 * been written and tested since August with zero production consumers, because
 * the only place it could have been called from was the root component. These
 * tests assert it is now computed from live task state — if the store stops
 * projecting, it goes back to being dead code and this goes red.
 */
import { act, render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { BridgeEvent } from "../../shared/types";
import { applyTaskEvent } from "../taskState";
import type { DocumentProjection } from "../documentModel";
import { TaskStoreProvider, useDocumentProjection, useTaskStore } from "./taskStore";
import type { TaskStore } from "./taskStore";

function harness() {
  const seen: { store?: TaskStore; projection?: DocumentProjection } = {};
  function Probe() {
    seen.store = useTaskStore();
    seen.projection = useDocumentProjection();
    return null;
  }
  render(<TaskStoreProvider><Probe /></TaskStoreProvider>);
  return seen;
}

const started = (taskId: string, documentType = "pptx"): BridgeEvent => ({
  type: "task.started",
  task_id: taskId,
  payload: { document_type: documentType },
});

const completed = (taskId: string, path: string, documentType = "pptx"): BridgeEvent => ({
  type: "task.completed",
  task_id: taskId,
  payload: {
    document_type: documentType,
    result: { file_path: path, file_name: path.split("/").pop(), document_type: documentType },
  },
});

describe("TaskStore", () => {
  it("starts empty and projects nothing", () => {
    const seen = harness();
    expect(seen.store!.state.taskOrder).toEqual([]);
    expect(seen.projection).toMatchObject({ documents: [], pendingDocuments: [], archivedConversations: [] });
  });

  it("takes the same updater shape taskState.ts is written in", () => {
    const seen = harness();
    act(() => {
      seen.store!.update((current) => applyTaskEvent(current, started("run-1")));
    });
    expect(seen.store!.state.taskOrder).toEqual(["run-1"]);
  });

  // A run with no artifact yet is a pending document, not a document.
  it("projects a live run as a pending document", () => {
    const seen = harness();
    act(() => {
      seen.store!.update((current) => applyTaskEvent(current, started("run-1")));
    });

    expect(seen.projection!.documents).toHaveLength(0);
    expect(seen.projection!.pendingDocuments).toMatchObject([{ latestTaskId: "run-1", status: "running" }]);
  });

  // Once it produces a file it becomes a document keyed by that file's path,
  // with the run recorded against it.
  it("projects a finished run as a document with its run", () => {
    const seen = harness();
    act(() => {
      seen.store!.update((current) => {
        let next = applyTaskEvent(current, started("run-1"));
        return applyTaskEvent(next, completed("run-1", "/tmp/deck.pptx"));
      });
    });

    expect(seen.projection!.pendingDocuments).toHaveLength(0);
    expect(seen.projection!.documents).toMatchObject([{
      title: "deck.pptx",
      documentType: "pptx",
      runIds: ["run-1"],
      latestRunId: "run-1",
    }]);
    expect(seen.projection!.runs).toMatchObject([{ id: "run-1", status: "completed" }]);
  });

  // Two runs against the same file are one document with two runs — the whole
  // reason the projection exists rather than a flat task list.
  it("folds a follow-up edit into the same document", () => {
    const seen = harness();
    act(() => {
      seen.store!.update((current) => {
        let next = applyTaskEvent(current, started("run-1"));
        next = applyTaskEvent(next, completed("run-1", "/tmp/deck.pptx"));
        next = applyTaskEvent(next, {
          type: "task.started",
          task_id: "run-2",
          payload: { document_type: "pptx", conversation_id: "run-1", parent_task_id: "run-1" },
        });
        return applyTaskEvent(next, completed("run-2", "/tmp/deck.pptx"));
      });
    });

    expect(seen.projection!.documents).toHaveLength(1);
    expect(seen.projection!.documents[0].runIds).toHaveLength(2);
  });

  it("keeps the projection identity stable while the state is unchanged", () => {
    const seen = harness();
    const first = seen.projection;
    act(() => {
      // An event with no task id is a no-op in the reducer, so the state object
      // is the same one and the memo must not recompute.
      seen.store!.update((current) => applyTaskEvent(current, { type: "bridge.reconnected", payload: {} }));
    });
    expect(seen.projection).toBe(first);
  });
});
