import { describe, expect, it } from "vitest";
import { decodeOfficeOutput, decodeOfficeOutputs } from "./productRegistryCodec";

describe("product registry codec", () => {
  it("rejects unknown runtime values instead of casting them into the UI", () => {
    const base = { id: "x", projectId: "p", outputType: "presentation", title: "PPT", version: 1, status: "succeeded", manuallyEdited: false, updatedAt: "" };
    expect(decodeOfficeOutput(base)).toBeDefined();
    expect(decodeOfficeOutput({ ...base, outputType: "unknown" })).toBeUndefined();
    expect(decodeOfficeOutputs([{ ...base }, { ...base, status: "broken" }])).toHaveLength(1);
  });
});
