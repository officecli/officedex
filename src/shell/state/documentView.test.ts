import { afterEach, describe, expect, test } from "vitest";

import { DEFAULT_DOCUMENT_ZOOM, readDocumentZoom, writeDocumentZoom } from "./documentView";

const KEY = "officedex.shell.documentView.v1";

describe("document view preferences", () => {
  afterEach(() => localStorage.removeItem(KEY));

  test("a file the user never zoomed opens at 80%", () => {
    expect(DEFAULT_DOCUMENT_ZOOM).toBe(80);
    expect(readDocumentZoom("never-seen")).toBe(80);
  });

  test("remembers each file's zoom separately, fit modes included", () => {
    writeDocumentZoom("a.docx", 125);
    writeDocumentZoom("b.pptx", "fit-page");
    writeDocumentZoom("c.docx", "fit-width");
    expect(readDocumentZoom("a.docx")).toBe(125);
    expect(readDocumentZoom("b.pptx")).toBe("fit-page");
    expect(readDocumentZoom("c.docx")).toBe("fit-width");
    writeDocumentZoom("a.docx", 90);
    expect(readDocumentZoom("a.docx")).toBe(90);
  });

  test("ignores unreadable storage and values that are not a zoom", () => {
    localStorage.setItem(KEY, "{not json");
    expect(readDocumentZoom("a.docx")).toBe(80);
    localStorage.setItem(KEY, JSON.stringify({ "a.docx": { zoom: "huge" }, "b.docx": { zoom: -5 } }));
    expect(readDocumentZoom("a.docx")).toBe(80);
    expect(readDocumentZoom("b.docx")).toBe(80);
    writeDocumentZoom("c.docx", Number.NaN);
    expect(readDocumentZoom("c.docx")).toBe(80);
  });

  test("drops the least recently changed files past the cap", () => {
    for (let index = 0; index < 501; index += 1) writeDocumentZoom(`file-${index}`, 100 + (index % 50), index);
    const stored = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Record<string, unknown>;
    expect(Object.keys(stored)).toHaveLength(500);
    expect(readDocumentZoom("file-0")).toBe(80);
    expect(readDocumentZoom("file-500")).toBe(100);
  });
});
