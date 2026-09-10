import { describe, expect, it } from "vitest";

import type { PresentationPptxEditorContext } from "../../shared/presentationPptxProtocol";
import {
  buildSelectSlideScript,
  changedSlideIds,
  focusSlideAfterEdit,
} from "./pptxEditFocus";

function deck(
  slides: Array<{ id: string; title: string; left?: number }>,
  selectedSlideIds: string[] = [],
): PresentationPptxEditorContext {
  return {
    slides: slides.map((slide, index) => ({
      id: slide.id,
      index,
      shapes: [
        {
          id: `${slide.id}-title`,
          name: "Title",
          type: "Placeholder",
          left: slide.left ?? 10,
          top: 20,
          width: 300,
          height: 60,
          text: slide.title,
        },
      ],
    })),
    selectedSlideIds,
    selectedShapes: [],
  };
}

describe("changedSlideIds", () => {
  it("reports the slide whose text moved and nothing else", () => {
    const before = deck([
      { id: "s1", title: "Overview" },
      { id: "s2", title: "Three things" },
      { id: "s3", title: "East leads" },
    ]);
    const after = deck([
      { id: "s1", title: "Overview" },
      { id: "s2", title: "The three numbers that matter" },
      { id: "s3", title: "East leads" },
    ]);
    expect(changedSlideIds(before, after)).toEqual(["s2"]);
  });

  it("sees a shape that only moved on the page", () => {
    const before = deck([{ id: "s1", title: "Overview", left: 10 }]);
    const after = deck([{ id: "s1", title: "Overview", left: 120 }]);
    expect(changedSlideIds(before, after)).toEqual(["s1"]);
  });

  it("ignores geometry jitter below what a reader could see", () => {
    const before = deck([{ id: "s1", title: "Overview", left: 10 }]);
    const after = deck([{ id: "s1", title: "Overview", left: 10.0000001 }]);
    expect(changedSlideIds(before, after)).toEqual([]);
  });

  it("counts an inserted slide and everything it pushed down", () => {
    const before = deck([
      { id: "s1", title: "Overview" },
      { id: "s2", title: "Detail" },
    ]);
    const after = deck([
      { id: "s1", title: "Overview" },
      { id: "new", title: "Inserted" },
      { id: "s2", title: "Detail" },
    ]);
    expect(changedSlideIds(before, after)).toEqual(["new", "s2"]);
  });

  it("treats a missing baseline as nothing known to have changed", () => {
    expect(changedSlideIds(null, deck([{ id: "s1", title: "Overview" }]))).toEqual(
      ["s1"],
    );
    expect(changedSlideIds(deck([{ id: "s1", title: "Overview" }]), null)).toEqual(
      [],
    );
  });
});

describe("focusSlideAfterEdit", () => {
  it("points at the edited slide when the reader is looking elsewhere", () => {
    const before = deck(
      [
        { id: "s1", title: "Overview" },
        { id: "s2", title: "Three things" },
        { id: "s3", title: "East leads" },
      ],
      ["s3"],
    );
    const after = deck(
      [
        { id: "s1", title: "Overview" },
        { id: "s2", title: "The three numbers that matter" },
        { id: "s3", title: "East leads" },
      ],
      ["s3"],
    );
    expect(focusSlideAfterEdit(before, after)).toBe("s2");
  });

  it("stays put when the edit landed on the slide already on screen", () => {
    const before = deck([{ id: "s1", title: "Overview" }], ["s1"]);
    const after = deck([{ id: "s1", title: "Overview 2026" }], ["s1"]);
    expect(focusSlideAfterEdit(before, after)).toBeNull();
  });

  it("stays put when the script changed nothing", () => {
    const same = deck([{ id: "s1", title: "Overview" }], ["s1"]);
    expect(focusSlideAfterEdit(same, same)).toBeNull();
  });
});

describe("buildSelectSlideScript", () => {
  it("selects the slide through the Office.js presentation API", () => {
    const source = buildSelectSlideScript("slide-2");
    expect(source).toContain("PowerPoint.run");
    expect(source).toContain('setSelectedSlides([target])');
    expect(source).toContain('"slide-2"');
  });

  it("escapes an id rather than pasting it into the source", () => {
    const source = buildSelectSlideScript('a"); evil(); //');
    expect(source).toContain(JSON.stringify('a"); evil(); //'));
    expect(source).not.toContain("evil(); //\n");
  });
});
