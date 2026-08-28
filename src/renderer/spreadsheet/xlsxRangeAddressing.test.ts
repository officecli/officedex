import { describe, expect, it } from "vitest";
import {
  createXlsxLocalEditRequest,
  normalizeXlsxRange,
  XLSX_T2_RANGE_CAPABILITIES,
  resolveXlsxSelection,
  XlsxRangeAddressingError,
} from "./xlsxRangeAddressing";
import { xlsxRangeSheetFixture, xlsxRangeWorkbookFixture } from "./xlsxRangeFixtures";

function expectCode(run: () => unknown, code: XlsxRangeAddressingError["code"]): void {
  expect(run).toThrowError(XlsxRangeAddressingError);
  try { run(); } catch (error) { expect(error).toMatchObject({ code }); }
}

describe("XLSX T2 range addressing", () => {
  it("publishes the supported and fail-closed selection boundary", () => {
    expect(XLSX_T2_RANGE_CAPABILITIES).toEqual({
      singleCell: true, rectangularRange: true, wholeRow: false, wholeColumn: false, multiArea: false, mergedCells: false,
    });
  });

  it("canonicalizes cells, rectangles, absolute markers, and reversed selections", () => {
    expect(normalizeXlsxRange("$b$2")).toMatchObject({ kind: "cell", a1: "B2", start: { row: 2, column: 2 } });
    expect(normalizeXlsxRange("D8:B4")).toMatchObject({ kind: "range", a1: "B4:D8", start: { row: 4, column: 2 }, end: { row: 8, column: 4 } });
    expect(normalizeXlsxRange({ startRow: 9, startColumn: 5, endRow: 2, endColumn: 1 })).toMatchObject({ a1: "A2:E9" });
  });

  it("clamps bounded numeric selections to the sheet grid", () => {
    expect(normalizeXlsxRange({ startRow: 0, startColumn: 0, endRow: 12, endColumn: 20 }, { maxRows: 10, maxColumns: 8 })).toMatchObject({ a1: "A1:H10" });
    expect(normalizeXlsxRange("XFE1:XFD2", { maxRows: 2, maxColumns: 8 })).toMatchObject({ a1: "H1:H2" });
  });

  it("rejects whole rows/columns, multi-area, and malformed ranges", () => {
    expectCode(() => normalizeXlsxRange("1:3"), "unsupported-unbounded-range");
    expectCode(() => normalizeXlsxRange("A:C"), "unsupported-unbounded-range");
    expectCode(() => normalizeXlsxRange("A1:B2,C3"), "unsupported-multi-area");
    expectCode(() => normalizeXlsxRange("A0"), "invalid-range");
  });

  it("resolves absent selection to document and present selection to range", () => {
    expect(resolveXlsxSelection(xlsxRangeWorkbookFixture, xlsxRangeSheetFixture)).toMatchObject({ scope: "document", range: null });
    expect(resolveXlsxSelection(xlsxRangeWorkbookFixture, xlsxRangeSheetFixture, { range: "C3" })).toMatchObject({ scope: "range", range: { kind: "cell", a1: "C3" } });
    expectCode(() => resolveXlsxSelection(xlsxRangeWorkbookFixture, xlsxRangeSheetFixture, { range: "A1:B2", areaCount: 2 }), "unsupported-multi-area");
    expectCode(() => resolveXlsxSelection(xlsxRangeWorkbookFixture, xlsxRangeSheetFixture, { range: "A1", merged: true }), "unsupported-merged-cells");
  });

  it("creates immutable identity-only edit requests", () => {
    const request = createXlsxLocalEditRequest({ workbook: xlsxRangeWorkbookFixture, sheet: xlsxRangeSheetFixture, selection: { range: "B2:D8" }, instruction: "  Normalize prices  " });
    expect(request).toEqual({
      workbook: xlsxRangeWorkbookFixture,
      sheet: xlsxRangeSheetFixture,
      range: expect.objectContaining({ a1: "B2:D8" }),
      instruction: "Normalize prices",
      actionReference: { id: "xlsx.edit.local", version: "v1" },
    });
    expect(Object.isFrozen(request)).toBe(true);
    expect(Object.isFrozen(request.range)).toBe(true);
    expect(JSON.stringify(request)).not.toContain("content");
    expect(JSON.stringify(request)).not.toContain("values");
    expectCode(() => createXlsxLocalEditRequest({ workbook: xlsxRangeWorkbookFixture, sheet: xlsxRangeSheetFixture, instruction: " " }), "invalid-instruction");
  });
});
