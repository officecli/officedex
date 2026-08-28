import { describe, expect, it } from "vitest";
import {
  parseWorkbookFormatCellsRequest,
  parseWorkbookSnapshotRequest,
  parseWorkbookStageMediaRequest,
  parseWorkbookWriteCellsRequest,
} from "./workbookClientTools";

describe("workbook client tool arguments", () => {
  it("bounds snapshots and normalizes a write matrix", () => {
    expect(parseWorkbookSnapshotRequest({})).toEqual({ sheetId: undefined, maxRows: 200, maxColumns: 64 });
    expect(parseWorkbookWriteCellsRequest({
      sheet_name: "Sheet1",
      start_row: 2,
      start_column: 3,
      values: [["a", 2], [true, null]],
    })).toEqual({
      sheetId: undefined,
      sheetName: "Sheet1",
      startRow: 2,
      startColumn: 3,
      values: [["a", "2"], ["true", ""]],
    });
  });

  it("rejects unbounded or ambiguous writes", () => {
    expect(() => parseWorkbookWriteCellsRequest({ start_row: 0, start_column: 0, values: [[1], [1, 2]] }))
      .toThrow("rectangular");
    expect(() => parseWorkbookWriteCellsRequest({ sheet_id: "a", sheet_name: "b", start_row: 0, start_column: 0, values: [[1]] }))
      .toThrow("either sheet_id or sheet_name");
  });

  it("requires exactly one media source and supports status-free staging", () => {
    expect(parseWorkbookStageMediaRequest({
      file_path: "/tmp/image.png",
      row: 1,
      column: 2,
    })).toEqual({
      filePath: "/tmp/image.png",
      data: undefined,
      mime: undefined,
      sheetId: undefined,
      sheetName: undefined,
      row: 1,
      column: 2,
      statusColumn: -1,
    });
    expect(() => parseWorkbookStageMediaRequest({ row: 0, column: 0 })).toThrow("exactly one");
  });
});

describe("workbook.format_cells arguments", () => {
  it("normalizes a single range and the supported style keys", () => {
    expect(parseWorkbookFormatCellsRequest({
      sheet_name: "Sheet1",
      range: { start_row: 1, start_column: 0, row_count: 12, column_count: 5 },
      style: { background: "#ffeb3b", bold: true, align: "Center", number_format: "percent", font_size: 14 },
    })).toEqual({
      sheetId: undefined,
      sheetName: "Sheet1",
      ranges: [{ startRow: 1, startColumn: 0, rowCount: 12, columnCount: 5 }],
      style: { background: "#FFEB3B", bold: true, align: "center", formatCategory: "percent", fontSize: 14 },
    });
  });

  it("accepts several ranges and defaults each span to one cell", () => {
    const request = parseWorkbookFormatCellsRequest({
      ranges: [{ start_row: 3, start_column: 1 }, { start_row: 7, start_column: 1, row_count: 2 }],
      style: { background: "#FFF" },
    });
    expect(request.ranges).toEqual([
      { startRow: 3, startColumn: 1, rowCount: 1, columnCount: 1 },
      { startRow: 7, startColumn: 1, rowCount: 2, columnCount: 1 },
    ]);
  });

  it("expands the border shorthand and lets a side override it", () => {
    const { style } = parseWorkbookFormatCellsRequest({
      range: { start_row: 0, start_column: 0 },
      style: { border: { color: "#cccccc" }, border_bottom: { color: "#000000", line_style: "thick" } },
    });
    expect(style.borderTop).toEqual(["#CCCCCC", 1]);
    expect(style.borderBottom).toEqual(["#000000", 5]);
  });

  it("rejects malformed styles, ranges, and oversized requests", () => {
    const range = { start_row: 0, start_column: 0 };
    expect(() => parseWorkbookFormatCellsRequest({ range, style: { background: "yellow" } }))
      .toThrow("hex color");
    expect(() => parseWorkbookFormatCellsRequest({ range, style: { align: "middle" } }))
      .toThrow("style.align must be one of");
    expect(() => parseWorkbookFormatCellsRequest({ range, style: { bold: "yes" } }))
      .toThrow("style.bold must be a boolean");
    expect(() => parseWorkbookFormatCellsRequest({ range, style: {} }))
      .toThrow("at least one supported property");
    expect(() => parseWorkbookFormatCellsRequest({ style: { bold: true } }))
      .toThrow("at least one range");
    expect(() => parseWorkbookFormatCellsRequest({ range: { start_row: 0, start_column: 0, row_count: 100_000, column_count: 10 }, style: { bold: true } }))
      .toThrow("limited to 50000 cells");
    expect(() => parseWorkbookFormatCellsRequest({ sheet_id: "a", sheet_name: "b", range, style: { bold: true } }))
      .toThrow("either sheet_id or sheet_name");
  });
});
