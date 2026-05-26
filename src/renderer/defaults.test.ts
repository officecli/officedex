import { describe, expect, it } from "vitest";
import { defaultGenerateInput } from "./defaults";

describe("defaultGenerateInput", () => {
  it("uses pptx as default document type", () => {
    expect(defaultGenerateInput.documentType).toBe("pptx");
  });
});
