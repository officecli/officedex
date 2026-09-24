import { act, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { BridgeEvent, DesktopAPI } from "../shared/types";
import type { FileMeta } from "../shared/uiPort";
import { createDesktopCanvas } from "./createDesktopCanvas";

afterEach(cleanup);

/**
 * A deck being drawn takes the canvas, and gives it back when it is done.
 *
 * The rule this guards is the one that made the routing hard: **a drawing deck
 * is not a file.** `CreateLivePptxDraft` writes to `workspaceDir/live/` and
 * registers the path with the preview registry only — it never reaches
 * `documents`, so the deck has no library entry, no tab and nothing for the
 * canvas to key on. The run is what puts it on screen.
 *
 * The leaves are stubbed: what is under test is which of them the canvas picks,
 * not whether PowerPoint renders.
 */
let stage: Record<string, unknown> | null = null;
let presentation: Record<string, unknown> | null = null;

vi.mock("./PresentationStage", async () => {
  const actual = await vi.importActual<typeof import("./PresentationStage")>("./PresentationStage");
  return {
    ...actual,
    PresentationStage: (props: Record<string, unknown>) => {
      stage = props;
      return null;
    },
  };
});

vi.mock("./PresentationCanvas", () => ({
  PresentationCanvas: (props: Record<string, unknown>) => {
    presentation = props;
    return null;
  },
}));

vi.mock("./DocxCanvas", () => ({ DocxCanvas: () => null }));
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

const deck = (id: string): FileMeta => ({
  id,
  name: `${id}.pptx`,
  type: "slides",
  folderId: "folder:default",
  createdAt: 0,
  updatedAt: 0,
  lastOpenedAt: null,
  dirty: false,
  pinned: false,
});

const started = (taskId: string): BridgeEvent => ({
  event_id: `${taskId}-start`,
  task_id: taskId,
  type: "task.started",
  ts: "2026-09-18T10:00:00Z",
  payload: { document_type: "pptx" },
});

const finished = (taskId: string): BridgeEvent => ({
  event_id: `${taskId}-done`,
  task_id: taskId,
  type: "task.completed",
  ts: "2026-09-18T10:05:00Z",
  payload: {},
});

describe("a drawing deck takes the canvas", () => {
  afterEach(() => {
    stage = null;
    presentation = null;
  });

  // Nothing is open and nothing is on disk, and the user still has to see the
  // outline gate and the pages appearing.
  it("shows the stage for a run with no file behind it", () => {
    const { emit } = harness();

    emit(started("task-deck"));

    expect(stage).not.toBeNull();
    expect((stage!.task as { id: string }).id).toBe("task-deck");
  });

  // What is happening outranks what is open: the deck being drawn is the thing
  // the user just asked for.
  it("takes the canvas from an open document", () => {
    const { adapter, emit } = harness();
    act(() => adapter.show(deck("existing")));
    expect(presentation).not.toBeNull();

    presentation = null;
    emit(started("task-deck"));

    expect(stage).not.toBeNull();
    expect(presentation).toBeNull();
  });

  /*
   * A run outranks the recording.
   *
   * Watching the demo and then asking for a real deck is the ordinary next
   * thing to do, and the recording must not survive it: `demo` is still set on
   * the shell (nothing clears it but `open-file`, and a run has no file), so
   * the canvas was keeping the finished recording on screen while the panel
   * beside it listed the new run's pages — two different decks, one window.
   */
  it("lets a new run take the canvas away from the recording", () => {
    const { adapter, emit } = harness();
    // Long before the run below: this is "watched the recording, then asked for
    // a real deck", so the run is the newer request.
    act(() =>
      adapter.showFileless?.({
        demo: true,
        demoStartedAt: new Date(0).toISOString(),
      }),
    );
    expect((stage!.task as { id: string }).id).toBe("builtin-nexaedge");

    stage = null;
    emit(started("task-deck"));

    expect(stage).not.toBeNull();
    expect((stage!.task as { id: string }).id).toBe("task-deck");
  });

  // Once the run is over the deck is an ordinary file, and the open tab is
  // whatever the user was looking at.
  it("gives the canvas back when the run ends", () => {
    const { adapter, emit } = harness();
    act(() => adapter.show(deck("existing")));
    emit(started("task-deck"));
    expect(stage).not.toBeNull();

    stage = null;
    emit(finished("task-deck"));

    expect(stage).toBeNull();
    expect((presentation!.file as FileMeta).id).toBe("existing");
  });

  // A run for a document is not a deck, and has no stage of its own.
  it("ignores a run that is not a presentation", () => {
    const { emit } = harness();

    emit({
      event_id: "task-doc-start",
      task_id: "task-doc",
      type: "task.started",
      ts: "2026-09-18T10:00:00Z",
      payload: { document_type: "docx" },
    });

    expect(stage).toBeNull();
  });

  // The store lives above the per-file switch, so a tab change must not lose a
  // run's history — that would restart the drawing from an empty deck.
  it("keeps the run across a tab switch", () => {
    const { adapter, emit } = harness();
    emit(started("task-deck"));
    act(() => adapter.show(deck("other")));

    expect(stage).not.toBeNull();
    expect((stage!.task as { id: string }).id).toBe("task-deck");
  });
});
