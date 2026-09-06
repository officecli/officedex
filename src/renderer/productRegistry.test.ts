import { describe, expect, it } from "vitest";
import { affectedOutputs, emptyOfficeProductRegistry, outputsForWorkbook, registerImageAsset, upsertOutput } from "./productRegistry";
import { createLineage, type OfficeImageAsset, type OfficeOutputRef } from "../shared/officeProduct";

const output: OfficeOutputRef = {
  id: "html-1",
  projectId: "p-1",
  type: "html-app",
  title: "Dashboard",
  version: 1,
  status: "succeeded",
  lineage: createLineage({ workbookId: "book-1", viewIds: ["view-1"], workbookFingerprint: "v1" }),
  updatedAt: "2026-09-06T00:00:00.000Z",
};

describe("office product registry", () => {
  it("indexes outputs by workbook and view", () => {
    const registry = upsertOutput(emptyOfficeProductRegistry(), output);
    expect(outputsForWorkbook(registry, "book-1")).toHaveLength(1);
    expect(affectedOutputs(registry, "view-1")).toEqual([output]);
  });

  it("keeps standalone and template images in one reusable asset index", () => {
    const image: OfficeImageAsset = { ...output, id: "img-1", type: "image", mode: "template", templateId: "cover", title: "Cover" };
    expect(registerImageAsset(emptyOfficeProductRegistry(), image).images).toEqual([image]);
  });
});
