import { describe, expect, it } from "vitest";

import { slidesGeneratingPreview } from "./slidesGeneratingPreview";

describe("slidesGeneratingPreview", () => {
  it("reads a generating phase from the query in DEV", () => {
    expect(slidesGeneratingPreview("?slidesGenerating=writing", true)).toBe("writing");
    expect(slidesGeneratingPreview("?slidesGenerating=research", true)).toBe("research");
  });

  it("ignores unknown values and production builds", () => {
    expect(slidesGeneratingPreview("?slidesGenerating=nope", true)).toBeNull();
    expect(slidesGeneratingPreview("?slidesGenerating=writing", false)).toBeNull();
  });
});
