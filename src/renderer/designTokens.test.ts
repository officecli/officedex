import { describe, expect, it } from "vitest";
import { pageMapping } from "./designTokens";

describe("Stitch page mapping", () => {
  it("covers every exported Stitch page used by the redesign", () => {
    expect(pageMapping.map((item) => item.page)).toEqual([
      "_1",
      "_2",
      "_3",
      "_4",
      "_5",
      "_6",
      "_7",
      "_8",
      "_9",
      "_10",
      "_11",
      "_12",
      "_13",
      "_14",
      "_15",
    ]);
  });

  it("keeps the required task, settings, artifact, and Fluid states represented", () => {
    const mapped = pageMapping.map((item) => item.mappedTo).join("\n");

    expect(mapped).toContain("execution pipeline");
    expect(mapped).toContain("Connection failure");
    expect(mapped).toContain("App settings");
    expect(mapped).toContain("Artifacts");
    expect(mapped).toContain("Fluid");
  });
});
