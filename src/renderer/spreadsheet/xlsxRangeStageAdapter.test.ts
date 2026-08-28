import { describe, expect, it } from "vitest";
import { createXlsxArtifactStageIntent, xlsxRangeStageAdapter, getXlsxActionCost } from "./xlsxRangeStageAdapter";
import { xlsxDocumentSelectionFixture, xlsxRangeSelectionFixture, xlsxRangeSheetFixture, xlsxRangeWorkbookFixture } from "./xlsxRangeFixtures";

describe("XLSX T2 stage adapter", () => {
  it("keeps inspect as the only explicitly free operation", () => {
    expect(xlsxRangeStageAdapter.getActions(xlsxDocumentSelectionFixture)).toEqual([
      { id: "inspect", label: "Inspect selection", cost: "free", freeOperation: "read-only-preview" },
      { id: "rewrite", label: "Rewrite selection", cost: "heavy" },
    ]);
    expect(getXlsxActionCost("range", "inspect")).toBe("free");
  });

  it("meters bounded range edits and treats document edits as heavy", () => {
    expect(xlsxRangeStageAdapter.getCost(xlsxRangeSelectionFixture, "rewrite")).toBe("metered");
    expect(xlsxRangeStageAdapter.getCost(xlsxDocumentSelectionFixture, "rewrite")).toBe("heavy");
  });

  it("builds a deterministic request without workbook content or execution", () => {
    const request = xlsxRangeStageAdapter.createEditRequest({
      workbook: xlsxRangeWorkbookFixture,
      sheet: xlsxRangeSheetFixture,
      selection: { range: "B2:D8" },
      instruction: "Normalize prices",
    });
    expect(request.range?.a1).toBe("B2:D8");
    expect(request.actionReference).toEqual({ id: "xlsx.edit.local", version: "v1" });
    expect(JSON.stringify(request)).not.toMatch(/(bytes|base64|workbookContent|values)/i);
  });

  it("maps a bounded range into the shared identity-only stage protocol", () => {
    expect(createXlsxArtifactStageIntent({
      artifactPath: "/tmp/catalog.xlsx",
      selection: xlsxRangeSelectionFixture,
      instruction: "Normalize prices",
    })).toEqual(expect.objectContaining({
      version: 1,
      costClass: "metered",
      target: expect.objectContaining({ documentType: "xlsx" }),
      scope: { kind: "range", sheetId: "sheet-products", sheetName: "Products", a1: "B2:D8" },
    }));
  });
});
