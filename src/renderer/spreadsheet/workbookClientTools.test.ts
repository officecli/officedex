import { describe, expect, it } from "vitest";
import {
  parseWorkbookAddChartRequest,
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

  it("normalizes a chart request and preserves camelCase chart identifiers", () => {
    expect(parseWorkbookAddChartRequest({
      chart_type: "columnClustered",
      range: { start_row: 0, start_column: 0, row_count: 5, column_count: 2 },
      title: "Revenue by Region",
      legend_visible: true,
      width: 480,
      height: 300,
    })).toEqual({
      sheetId: undefined,
      sheetName: undefined,
      range: { row: 0, column: 0, rowCount: 5, columnCount: 2 },
      chartType: "columnClustered",
      title: "Revenue by Region",
      legendVisible: true,
      width: 480,
      height: 300,
    });
  });

  it("accepts case-insensitive chart types but returns the SDK spelling", () => {
    const range = { start_row: 0, start_column: 0, row_count: 4, column_count: 2 };
    expect(parseWorkbookAddChartRequest({ chart_type: "columnclustered", range }).chartType).toBe("columnClustered");
    expect(parseWorkbookAddChartRequest({ chart_type: "  LineMarkers  ", range }).chartType).toBe("lineMarkers");
    expect(parseWorkbookAddChartRequest({ chart_type: "waterfall", range }).chartType).toBe("waterfall");
  });

  it("omits optional chart fields that were not supplied", () => {
    const parsed = parseWorkbookAddChartRequest({
      chart_type: "pie",
      range: { start_row: 1, start_column: 2, row_count: 3, column_count: 2 },
    });
    expect(parsed).not.toHaveProperty("title");
    expect(parsed).not.toHaveProperty("width");
    expect(parsed.range).toEqual({ row: 1, column: 2, rowCount: 3, columnCount: 2 });
  });

  it("rejects unusable chart requests", () => {
    const range = { start_row: 0, start_column: 0, row_count: 5, column_count: 2 };
    expect(() => parseWorkbookAddChartRequest({ range }))
      .toThrow("requires chart_type");
    expect(() => parseWorkbookAddChartRequest({ chart_type: "3d-donut-explosion", range }))
      .toThrow("chart_type must be one of");
    expect(() => parseWorkbookAddChartRequest({ chart_type: "pie" }))
      .toThrow("requires a range object");
    expect(() => parseWorkbookAddChartRequest({ chart_type: "pie", range: { start_row: 0, start_column: 0, row_count: 1, column_count: 2 } }))
      .toThrow("at least 2 rows and 2 columns");
    expect(() => parseWorkbookAddChartRequest({ chart_type: "pie", sheet_id: "a", sheet_name: "b", range }))
      .toThrow("either sheet_id or sheet_name");
    expect(() => parseWorkbookAddChartRequest({ chart_type: "pie", range, width: 10 }))
      .toThrow("width must be an integer between");
  });
});
