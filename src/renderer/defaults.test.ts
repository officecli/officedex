import { describe, expect, it } from "vitest";
import { defaultGenerateInput } from "./defaults";

describe("defaultGenerateInput", () => {
  it("uses hosted runtime by default", () => {
    expect(defaultGenerateInput.runtimeMode).toBe("hosted");
  });
});
