import { describe, expect, it } from "vitest";
import { estimateOfficeCost } from "./officeCost";

describe("office cost estimates", () => {
  it("scales by output size and keeps failed operations refundable", () => {
    expect(estimateOfficeCost({ operation: "generate", outputType: "presentation", pages: 22, images: 2 })).toEqual({ credits: 8, unit: "Credit", refundableOnFailure: true });
    expect(estimateOfficeCost({ operation: "image", outputType: "image" })).toMatchObject({ credits: 4, refundableOnFailure: true });
  });
});
