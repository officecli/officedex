import { act, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { BridgeEvent, DesktopAPI } from "../shared/types";
import type { FileMeta } from "../shared/uiPort";
import { createDesktopCanvas } from "./createDesktopCanvas";

afterEach(cleanup);

/** Live generation is selected explicitly; background runs preserve the open file. */
let sheetStage: Record<string, unknown> | null = null;
let sheetCanvas: Record<string, unknown> | null = null;

vi.mock("./SheetStage", () => ({
  SheetStage: (props: Record<string, unknown>) => {
    sheetStage = props;
    return null;
  },
}));

vi.mock("./SheetCanvas", () => ({
  SheetCanvas: (props: Record<string, unknown>) => {
    sheetCanvas = props;
    return null;
  },
}));

vi.mock("./PresentationCanvas", () => ({ PresentationCanvas: () => null }));
vi.mock("./DocxCanvas", () => ({ DocxCanvas: () => null }));

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

const workbook = (id: string): FileMeta => ({
  id,
  name: `${id}.xlsx`,
  type: "sheet",
  folderId: "folder:default",
  createdAt: 0,
  updatedAt: 0,
  lastOpenedAt: null,
  dirty: false,
  pinned: false,
});

const started = (taskId: string, documentType = "xlsx"): BridgeEvent => ({
  event_id: `${taskId}-start`,
  task_id: taskId,
  type: "task.started",
  ts: "2026-09-20T00:00:00Z",
  payload: { document_type: documentType },
});

const finished = (taskId: string): BridgeEvent => ({
  event_id: `${taskId}-done`,
  task_id: taskId,
  type: "task.completed",
  ts: "2026-09-20T00:05:00Z",
  payload: {},
});

describe("workbook stage routing", () => {
  afterEach(() => {
    sheetStage = null;
    sheetCanvas = null;
  });

  it("shows the stage for a run with no file behind it", () => {
    const { emit } = harness();

    emit(started("task-book"));

    expect(sheetStage).not.toBeNull();
    expect((sheetStage!.task as { id: string }).id).toBe("task-book");
  });

  it("preserves the explicitly opened workbook during background generation", () => {
    const { adapter, emit } = harness();
    act(() => adapter.show(workbook("budget")));
    expect(sheetCanvas).not.toBeNull();

    sheetCanvas = null;
    emit(started("task-book"));

    expect(sheetStage).toBeNull();
    expect(sheetCanvas).not.toBeNull();
  });

  it("gives the canvas back when the run ends", () => {
    const { adapter, emit } = harness();
    act(() => adapter.show(workbook("budget")));
    act(() => adapter.showFileless?.());
    emit(started("task-book"));
    expect(sheetStage).not.toBeNull();

    sheetStage = null;
    emit(finished("task-book"));
    act(() => adapter.show(workbook("budget")));

    expect(sheetStage).toBeNull();
    expect(sheetCanvas).not.toBeNull();
  });

  // A deck and a document have their own stages; this one must not answer for
  // them.
  it("leaves other document types alone", () => {
    const { adapter, emit } = harness();
    act(() => adapter.show(workbook("budget")));

    sheetCanvas = null;
    emit(started("task-deck", "pptx"));

    expect(sheetStage).toBeNull();
  });
});
