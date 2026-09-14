import { describe, expect, it } from "vitest";
import type { DesktopTask } from "../../shared/types";
import { pptxDeckStillDrawing, pptxHasDeckEnd, pptxOpStreamDrained } from "./pptxDeckState";

const picture = (seq: number, slide: number, digest?: string) => digest
  ? { seq, op: "shape.add", slide, shape: { kind: "picture", imageRef: { kind: "primary", digest } } }
  : { seq, op: "shape.add", slide, shape: { kind: "picture", imageRef: { kind: "primary" } } };

const task = (overrides: Partial<DesktopTask>): DesktopTask => ({
  id: "t", conversationId: "t", status: "running", events: [], ...overrides,
});

describe("pptxDeckState", () => {
  it("reads deck.end as the author's last word", () => {
    expect(pptxHasDeckEnd([picture(1, 1)])).toBe(false);
    expect(pptxHasDeckEnd([picture(1, 1), { seq: 2, op: "deck.end" }])).toBe(true);
  });

  it("keeps a completed run on screen while its pictures are still landing", () => {
    const pending = task({ status: "completed", vibeOps: [picture(1, 1), picture(2, 2)] as DesktopTask["vibeOps"] });
    expect(pptxDeckStillDrawing(pending)).toBe(true);
    const placed = task({ status: "completed", vibeOps: [picture(1, 1, "a".repeat(64))] as DesktopTask["vibeOps"] });
    expect(pptxDeckStillDrawing(placed)).toBe(false);
    // A run that has not finished is not "still drawing" by this rule — the
    // stage has its own reasons to show progress for it.
    expect(pptxDeckStillDrawing(task({ status: "running", vibeOps: [picture(1, 1)] as DesktopTask["vibeOps"] }))).toBe(false);
  });

  it("closes the deck on screen once deck.end arrives even with slots open", () => {
    const closed = task({ status: "completed", vibeOps: [picture(1, 1), { seq: 2, op: "deck.end" }] as DesktopTask["vibeOps"] });
    expect(pptxDeckStillDrawing(closed)).toBe(false);
  });

  /**
   * The one case where the two answers must disagree, and why: the sequencer
   * latches `finished` on the stream answer and then drops every later update(),
   * so closing the stream at deck.end would strand the image patches that fill
   * the open slots. Anyone "unifying" these two has to delete this test on
   * purpose.
   */
  it("keeps the op stream open past deck.end while a picture slot is still open", () => {
    const closedButPending = task({ status: "completed", vibeOps: [picture(1, 1), { seq: 2, op: "deck.end" }] as DesktopTask["vibeOps"] });
    expect(pptxDeckStillDrawing(closedButPending)).toBe(false);
    expect(pptxOpStreamDrained(closedButPending)).toBe(false);
    const closedAndPlaced = task({ status: "completed", vibeOps: [picture(1, 1, "a".repeat(64)), { seq: 2, op: "deck.end" }] as DesktopTask["vibeOps"] });
    expect(pptxOpStreamDrained(closedAndPlaced)).toBe(true);
  });

  it("treats failed and cancelled runs as drained, and live ones as not", () => {
    expect(pptxOpStreamDrained(task({ status: "failed" }))).toBe(true);
    expect(pptxOpStreamDrained(task({ status: "cancelled" }))).toBe(true);
    expect(pptxOpStreamDrained(task({ status: "running" }))).toBe(false);
    expect(pptxOpStreamDrained(task({ status: "question" }))).toBe(false);
  });
});
