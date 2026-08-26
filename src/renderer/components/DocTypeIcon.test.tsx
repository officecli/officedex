import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DocTypeIcon, docTypeFromPath, docTypeKey } from "./DocTypeIcon";

afterEach(cleanup);

function markup(type: string, chip = false): string {
  cleanup();
  const { container } = render(<DocTypeIcon type={type} chip={chip} />);
  return container.innerHTML;
}

describe("DocTypeIcon", () => {
  it("gives every format its own icon, not one icon in four colors", () => {
    for (const chip of [false, true]) {
      const shapes = ["docx", "pptx", "img", "xlsx"].map((type) => markup(type, chip));
      expect(new Set(shapes).size).toBe(4);
    }
  });

  it("draws the document miniature only where there is room for it", () => {
    // File rows get the illustrated mark; inline placements get the line icon,
    // because the miniature's paper and content lines smudge below ~24px.
    expect(markup("docx", true)).toContain(">W<");
    expect(markup("docx")).not.toContain(">W<");
    expect(markup("pptx", true)).toContain(">P<");
    expect(markup("pptx")).not.toContain(">P<");
  });

  it("carries the format's identity class in both sizes", () => {
    expect(markup("pptx")).toContain("doc-type-icon doc-type--pptx");
    expect(markup("pptx", true)).toContain("doc-type-chip doc-type--pptx");
  });

  it("falls back to a plain document for anything unknown", () => {
    expect(docTypeKey("pdf")).toBe("generic");
    expect(docTypeKey(undefined)).toBe("generic");
    expect(markup("pdf")).not.toContain(">W<");
  });

  it("reads the format from a file path, including the aliases that map onto one mark", () => {
    expect(docTypeFromPath("/tmp/deck.PPTX")).toBe("pptx");
    expect(docTypeFromPath("/tmp/notes.md")).toBe("docx");
    expect(docTypeFromPath("/tmp/data.csv")).toBe("xlsx");
    expect(docTypeFromPath("/tmp/shot.webp")).toBe("img");
    expect(docTypeFromPath("/tmp/archive.zip")).toBe("generic");
  });
});
