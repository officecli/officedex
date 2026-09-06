import { describe, expect, it } from "vitest";
import { calculateRefreshImpact, canAutoRefresh } from "./officeRefresh";
import { createLineage, type OfficeOutputRef } from "../shared/officeProduct";

const outputs: OfficeOutputRef[] = [
  { id: "ppt", projectId: "p", type: "presentation", title: "PPT", version: 1, status: "succeeded", lineage: createLineage({ workbookId: "book", viewIds: ["sales"], workbookFingerprint: "v1" }), updatedAt: "" },
  { id: "doc", projectId: "p", type: "document", title: "DOCX", version: 1, status: "succeeded", manuallyEdited: true, lineage: createLineage({ workbookId: "book", viewIds: ["sales"], workbookFingerprint: "v1" }), updatedAt: "" },
  { id: "other", projectId: "p", type: "html-app", title: "Other", version: 1, status: "succeeded", lineage: createLineage({ workbookId: "other-book", viewIds: ["sales"], workbookFingerprint: "v1" }), updatedAt: "" },
];

describe("office refresh impact", () => {
  it("selects only outputs depending on the changed workbook view", () => {
    const impact = calculateRefreshImpact(outputs, createLineage({ workbookId: "book", viewIds: ["sales"], workbookFingerprint: "v2" }), ["sales"]);
    expect(impact.map((item) => item.output.id)).toEqual(["ppt", "doc"]);
    expect(canAutoRefresh(impact[0].plan)).toBe(true);
    expect(impact[1].plan.requiresApproval).toBe(true);
  });
});
