import { renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import type { DesktopAPI } from "../shared/types";
import type { PresentationEditorController } from "../renderer/presentation/PresentationEditorFrame";
import type { VibeReplayFeed } from "../renderer/presentation/vibeReplay";
import { useLiveDeckReplay } from "./useLiveDeckReplay";

/**
 * The sequencer is the thing that draws, so what these pin is that one gets
 * built and fed — the bug was that nothing did, and the deck stayed blank for
 * the length of the run while the ops sat in the feed.
 */
const built: Array<{ controller: PresentationEditorController }> = [];
const updates: VibeReplayFeed[] = [];
let disposed = 0;

vi.mock("../renderer/presentation/vibeReplay", () => ({
  VibeReplaySequencer: class {
    constructor(options: { controller: PresentationEditorController }) {
      built.push(options);
    }
    update(feed: VibeReplayFeed) {
      updates.push(feed);
    }
    dispose() {
      disposed += 1;
    }
  },
}));

afterEach(() => {
  built.length = 0;
  updates.length = 0;
  disposed = 0;
});

const api = { recordRendererLog: () => Promise.resolve() } as unknown as DesktopAPI;
const controllerA = { id: "a" } as unknown as PresentationEditorController;
const controllerB = { id: "b" } as unknown as PresentationEditorController;
const feedFor = (taskId: string, filePath = "/live/deck-1.pptx") =>
  ({ taskId, filePath, ops: [] }) as unknown as VibeReplayFeed;

it("builds a sequencer once the editor hands over a controller, and feeds it", () => {
  const { rerender } = renderHook(
    ({ controller, feed }: { controller: PresentationEditorController | null; feed?: VibeReplayFeed }) =>
      useLiveDeckReplay(api, controller, feed),
    { initialProps: { controller: null as PresentationEditorController | null, feed: feedFor("task-1") } },
  );

  // No controller yet: the editor has not booted, so there is nothing to draw
  // into and building a sequencer now would capture null.
  expect(built).toHaveLength(0);

  rerender({ controller: controllerA, feed: feedFor("task-1") });
  expect(built).toHaveLength(1);
  expect(updates).toHaveLength(1);

  // More ops on the same run reuse the sequencer rather than restarting it —
  // a second sequencer would redraw the deck onto itself.
  rerender({ controller: controllerA, feed: feedFor("task-1") });
  expect(built).toHaveLength(1);
  expect(updates).toHaveLength(2);
});

/*
 * One sequencer belongs to one (task, document, editor session). The rule is
 * the workbench's and it was a bug there first: mixing two runs' op streams in
 * one sequencer draws the wrong deck.
 */
it("retires the sequencer when the run or the editor session changes", () => {
  const { rerender } = renderHook(
    ({ controller, feed }: { controller: PresentationEditorController; feed: VibeReplayFeed }) =>
      useLiveDeckReplay(api, controller, feed),
    { initialProps: { controller: controllerA, feed: feedFor("task-1") } },
  );
  expect(built).toHaveLength(1);

  // A different run.
  rerender({ controller: controllerA, feed: feedFor("task-2") });
  expect(disposed).toBe(1);
  expect(built).toHaveLength(2);

  // A new editor session for the same run: the old controller's closure points
  // at a document that is gone.
  rerender({ controller: controllerB, feed: feedFor("task-2") });
  expect(disposed).toBe(2);
  expect(built).toHaveLength(3);
});
