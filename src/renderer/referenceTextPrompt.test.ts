import { describe, expect, it } from "vitest";
import { buildReferenceTextPrompt } from "./referenceTextPrompt";

const document = (fileName: string, text: string, truncated = false) => ({
  filePath: `/tmp/${fileName}`,
  fileName,
  text,
  truncated,
});

describe("buildReferenceTextPrompt", () => {
  it("returns the prompt unchanged when nothing usable is attached", () => {
    expect(buildReferenceTextPrompt("Build a deck", [])).toBe("Build a deck");
    expect(buildReferenceTextPrompt("Build a deck", [document("empty.txt", "   ")])).toBe("Build a deck");
  });

  it("fences each document by name and keeps the request last", () => {
    const result = buildReferenceTextPrompt("Summarise Q3", [
      document("north.txt", "North revenue 120"),
      document("south.txt", "South revenue 95"),
    ]);

    expect(result).toContain("<<<FILE: north.txt>>>");
    expect(result).toContain("North revenue 120");
    expect(result).toContain("<<<FILE: south.txt>>>");
    expect(result).toContain("2 reference documents");
    // The request must trail the data so it sits next to the rules.
    expect(result.indexOf("North revenue 120")).toBeLessThan(result.indexOf("Request: Summarise Q3"));
  });

  it("marks truncated documents so the model knows the source is partial", () => {
    const result = buildReferenceTextPrompt("Summarise", [document("big.txt", "partial content", true)]);
    expect(result).toContain("<<<FILE: big.txt (truncated)>>>");
  });

  it("states the grounding rules", () => {
    const result = buildReferenceTextPrompt("Summarise", [document("a.txt", "data")]);
    expect(result).toContain("Do not invent data");
  });
});
