import { act, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { BridgeEvent, DesktopAPI, DesktopTask } from "../shared/types";
import type { FileMeta } from "../shared/uiPort";
import { createDesktopCanvas } from "./createDesktopCanvas";

afterEach(cleanup);

/**
 * A document being written takes the canvas, and gives it back when the file
 * exists.
 *
 * The rule is the deck's rule, applied to the type that did not have it: a run
 * that has produced no file has no file to be active, so routing on the active
 * tab shows *the last document the user opened* for the length of the run. That
 * is not a blank canvas — it is a different document, sitting there looking
 * finished, while a new one is being written somewhere the user cannot see.
 *
 * The leaves are stubbed: what is under test is which of them the canvas picks.
 */
let docStage: Record<string, unknown> | null = null;
let docCanvas: Record<string, unknown> | null = null;
let deckStage: Record<string, unknown> | null = null;

vi.mock("./DocxStage", async () => {
  const actual = await vi.importActual<typeof import("./DocxStage")>("./DocxStage");
  return {
    ...actual,
    DocxStage: (props: Record<string, unknown>) => {
      docStage = props;
      return null;
    },
  };
});

vi.mock("./PresentationStage", async () => {
  const actual = await vi.importActual<typeof import("./PresentationStage")>("./PresentationStage");
  return {
    ...actual,
    PresentationStage: (props: Record<string, unknown>) => {
      deckStage = props;
      return null;
    },
  };
});

vi.mock("./DocxCanvas", () => ({
  DocxCanvas: (props: Record<string, unknown>) => {
    docCanvas = props;
    return null;
  },
}));

vi.mock("./PresentationCanvas", () => ({ PresentationCanvas: () => null }));
vi.mock("./SheetCanvas", () => ({ SheetCanvas: () => null }));

function harness() {
  const listeners = new Set<(event: BridgeEvent) => void>();
  const api = {
    onBridgeEvent: (listener: (event: BridgeEvent) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getTaskHistory: async () => [],
  } as unknown as DesktopAPI;

  const host = document.createElement("div");
  document.body.append(host);
  const adapter = createDesktopCanvas({ api, onUnavailable: () => {} });
  act(() => {
    void adapter.mount(host);
  });

  return {
    adapter,
    emit(event: BridgeEvent) {
      act(() => {
        for (const listener of listeners) listener(event);
      });
    },
  };
}

const doc = (id: string): FileMeta => ({
  id,
  name: `${id}.docx`,
  type: "doc",
  folderId: "folder:default",
  createdAt: 0,
  updatedAt: 0,
  lastOpenedAt: null,
  dirty: false,
  pinned: false,
});

const started = (taskId: string, documentType = "docx"): BridgeEvent => ({
  event_id: `${taskId}-start`,
  task_id: taskId,
  type: "task.started",
  ts: "2026-09-19T10:00:00Z",
  payload: { document_type: documentType },
});

const finished = (taskId: string): BridgeEvent => ({
  event_id: `${taskId}-done`,
  task_id: taskId,
  type: "task.completed",
  ts: "2026-09-19T10:02:00Z",
  payload: {},
});

describe("a document being written takes the canvas", () => {
  afterEach(() => {
    docStage = null;
    docCanvas = null;
    deckStage = null;
  });

  it("shows the stage for a run with no file behind it", () => {
    const { emit } = harness();
    expect(docStage).toBeNull();

    emit(started("task-doc"));

    expect(docStage).not.toBeNull();
    expect((docStage!.task as DesktopTask).id).toBe("task-doc");
  });

  // The case that made this worth building: a document open in a tab is not the
  // document being written, and leaving it up says it is.
  it("takes the canvas from an open document", () => {
    const { adapter, emit } = harness();
    act(() => adapter.show(doc("last-weeks-report")));
    expect(docCanvas).not.toBeNull();

    docCanvas = null;
    emit(started("task-doc"));

    expect(docStage).not.toBeNull();
    expect(docCanvas).toBeNull();
  });

  it("gives the canvas back to the editor when the run ends", () => {
    const { adapter, emit } = harness();
    act(() => adapter.show(doc("file-one")));
    emit(started("task-doc"));
    expect(docStage).not.toBeNull();

    docStage = null;
    emit(finished("task-doc"));

    expect(docStage).toBeNull();
    expect(docCanvas).not.toBeNull();
  });

  it("leaves a workbook run alone — it has a stage of its own", () => {
    const { emit } = harness();
    emit(started("task-sheet", "xlsx"));
    expect(docStage).toBeNull();
  });

  // Rare, and the deck has the more informative stage: it shows real pages.
  it("yields to a deck when both are running", () => {
    const { emit } = harness();
    emit(started("task-doc"));
    expect(docStage).not.toBeNull();

    // Cleared so the assertion below is about *this* render, not about the
    // props the previous one left in module scope.
    docStage = null;
    emit(started("task-deck", "pptx"));

    expect(deckStage).not.toBeNull();
    expect(docStage).toBeNull();
  });
});
