import { act, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { BridgeEvent, DesktopAPI, DesktopTask } from "../shared/types";
import type { FileMeta } from "../shared/uiPort";
import { createDesktopCanvas } from "./createDesktopCanvas";

afterEach(cleanup);

/** Live generation is selected explicitly; background runs preserve the open file. */
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

describe("document stage routing", () => {
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

  it("preserves the explicitly opened document during background generation", () => {
    const { adapter, emit } = harness();
    act(() => adapter.show(doc("last-weeks-report")));
    expect(docCanvas).not.toBeNull();

    docCanvas = null;
    emit(started("task-doc"));

    expect(docStage).toBeNull();
    expect(docCanvas).not.toBeNull();
  });

  it("gives the canvas back to the editor when the run ends", () => {
    const { adapter, emit } = harness();
    act(() => adapter.show(doc("file-one")));
    act(() => adapter.showFileless?.());
    emit(started("task-doc"));
    expect(docStage).not.toBeNull();

    docStage = null;
    emit(finished("task-doc"));
    act(() => adapter.show(doc("file-one")));

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
