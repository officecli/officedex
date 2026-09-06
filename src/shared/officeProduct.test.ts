import { describe, expect, it } from "vitest";
import { createLineage, lineageChanged, planRefresh, type OfficeOutputRef } from "./officeProduct";

const output: OfficeOutputRef = {
  id: "ppt-1",
  projectId: "project-1",
  type: "presentation",
  title: "Weekly review",
  version: 2,
  status: "succeeded",
  manuallyEdited: true,
  lineage: createLineage({ workbookId: "book-1", viewIds: ["view-1"], workbookFingerprint: "v1" }),
  updatedAt: "2026-09-06T00:00:00.000Z",
};

describe("office product lineage", () => {
  it("deduplicates source and view references", () => {
    expect(createLineage({ workbookId: "book", viewIds: ["a", "a"], sourceIds: ["s", "s"], workbookFingerprint: "x" })).toMatchObject({
      viewIds: ["a"],
      sourceIds: ["s"],
    });
  });

  it("detects workbook version changes", () => {
    expect(lineageChanged(output, createLineage({ workbookId: "book-1", workbookFingerprint: "v2" }))).toBe(true);
    expect(lineageChanged(output, createLineage({ workbookId: "book-1", workbookFingerprint: "v1" }))).toBe(false);
  });

  it("requires approval before refreshing a manually edited presentation", () => {
    expect(planRefresh(output, createLineage({ workbookId: "book-1", viewIds: ["view-2"], workbookFingerprint: "v2" }))).toEqual({
      outputId: "ppt-1",
      changedViews: ["view-2"],
      strategy: "charts",
      preserveManualEdits: true,
      requiresApproval: true,
    });
  });
});
