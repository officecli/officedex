import { describe, expect, it } from "vitest";

import { inPlaceEditorFor } from "./useAgentTask";

/**
 * Which instruction goes where.
 *
 * A file the agent can change where it stands must not be sent to the
 * generation runtime — that path re-authors the whole thing from the prompt.
 * It was reachable for documents only (`target?.type === "doc"`), so "change
 * slide 3's title" against an open deck regenerated the deck and left the title
 * alone: the bug this decision exists to prevent.
 */

const doc = { type: "doc" };
const slides = { type: "slides" };
const sheet = { type: "sheet" };

/** A canvas with an in-place editor mounted, or without one. */
const canvas = (mounted: boolean) => ({
  canEditDocument: () => mounted,
});

describe("in-place editing", () => {
  it("routes an open document to the Word editor", () => {
    expect(inPlaceEditorFor(doc, canvas(true))).toBe("docx");
  });

  it("routes an open deck to the deck editor", () => {
    // This is the case that did not exist, and the whole reason for this test.
    expect(inPlaceEditorFor(slides, canvas(true))).toBe("pptx");
  });

  it("leaves workbooks to the generation runtime", () => {
    // A workbook has no in-place editor; `null` sends it down the ordinary path.
    expect(inPlaceEditorFor(sheet, canvas(true))).toBeNull();
  });

  it("falls back to generation when nothing is mounted for the open file", () => {
    // Mid-run the canvas is showing a stage, not the file's editor, and the
    // adapter is the only thing that knows. An instruction typed then belongs
    // to the run, not to a file that is not on screen.
    expect(inPlaceEditorFor(doc, canvas(false))).toBeNull();
    expect(inPlaceEditorFor(slides, canvas(false))).toBeNull();
  });

  it("is null with no file and with no canvas", () => {
    expect(inPlaceEditorFor(null, canvas(true))).toBeNull();
    expect(inPlaceEditorFor(slides, null)).toBeNull();
  });

  it("survives an adapter that has no in-place editor at all", () => {
    // `canEditDocument` is optional on the contract: a canvas that cannot edit
    // in place must not be asked, and must not throw.
    expect(inPlaceEditorFor(slides, {} as never)).toBeNull();
  });
});
