import { base64ToUint8Array } from "../utils/bytes";

export interface WorkbookSnapshotRequest {
  sheetId?: string;
  maxRows: number;
  maxColumns: number;
}

export interface WorkbookWriteCellsRequest {
  sheetId?: string;
  sheetName?: string;
  startRow: number;
  startColumn: number;
  values: string[][];
}

export interface WorkbookStageMediaRequest {
  filePath?: string;
  data?: Uint8Array;
  mime?: string;
  sheetId?: string;
  sheetName?: string;
  row: number;
  column: number;
  statusColumn: number;
}

export type WorkbookBorderStyle = [color: string, lineStyle: number];

// Mirrors the writable subset of the Sheet SDK's SheetWritableCellMeta. Keys
// stay camelCase so SpreadsheetCanvas can spread this straight onto a cell.
export interface WorkbookCellStyle {
  background?: string;
  color?: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  fontFamily?: string;
  fontSize?: number;
  align?: WorkbookAlign;
  vertical?: WorkbookVertical;
  wrap?: WorkbookWrap;
  formatCategory?: WorkbookFormatCategory;
  precision?: number;
  borderTop?: WorkbookBorderStyle;
  borderRight?: WorkbookBorderStyle;
  borderBottom?: WorkbookBorderStyle;
  borderLeft?: WorkbookBorderStyle;
}

export interface WorkbookFormatRange {
  startRow: number;
  startColumn: number;
  rowCount: number;
  columnCount: number;
}

export interface WorkbookFormatCellsRequest {
  sheetId?: string;
  sheetName?: string;
  ranges: WorkbookFormatRange[];
  style: WorkbookCellStyle;
}

export interface WorkbookSnapshot {
  activeSheetId: string;
  sheets: Array<{
    id: string;
    name: string;
    rowCount: number;
    columnCount: number;
    rows: string[][];
    truncated: boolean;
  }>;
}

export interface WorkbookSelectionSnapshot {
  sheetId: string;
  sheetName: string;
  range: { row: number; column: number; rowCount: number; columnCount: number };
  values: string[][];
}

export interface WorkbookStageMediaResult {
  url: string;
  sheetId: string;
  sheetName: string;
  row: number;
  column: number;
}

const MAX_SNAPSHOT_ROWS = 1_000;
const MAX_SNAPSHOT_COLUMNS = 256;
const MAX_WRITE_CELLS = 10_000;
const MAX_FORMAT_CELLS = 50_000;
const MAX_FORMAT_RANGES = 64;

const WORKBOOK_ALIGNS = ["left", "center", "right", "justify"] as const;
const WORKBOOK_VERTICALS = ["top", "middle", "bottom"] as const;
const WORKBOOK_WRAPS = ["text-wrap", "text-no-wrap", "text-linebreak-overflow", "text-clip"] as const;
const WORKBOOK_FORMAT_CATEGORIES = [
  "auto", "text", "number", "percent", "currency", "accounting",
  "date", "time", "fraction", "scientific", "special",
] as const;

// Sheet SDK LineStyle enum members, named so the tool contract stays readable
// and stable even if the numeric enum is reordered upstream.
const WORKBOOK_LINE_STYLES: Record<string, number> = {
  none: 0, thin: 1, medium: 2, dashed: 3, dotted: 4, thick: 5, double: 6,
};

export type WorkbookAlign = (typeof WORKBOOK_ALIGNS)[number];
export type WorkbookVertical = (typeof WORKBOOK_VERTICALS)[number];
export type WorkbookWrap = (typeof WORKBOOK_WRAPS)[number];
export type WorkbookFormatCategory = (typeof WORKBOOK_FORMAT_CATEGORIES)[number];

export function parseWorkbookSnapshotRequest(arguments_: Record<string, unknown>): WorkbookSnapshotRequest {
  return {
    sheetId: optionalString(arguments_.sheet_id),
    maxRows: boundedInteger(arguments_.max_rows, 200, 1, MAX_SNAPSHOT_ROWS, "max_rows"),
    maxColumns: boundedInteger(arguments_.max_columns, 64, 1, MAX_SNAPSHOT_COLUMNS, "max_columns"),
  };
}

export function parseWorkbookWriteCellsRequest(arguments_: Record<string, unknown>): WorkbookWriteCellsRequest {
  const rawValues = arguments_.values;
  if (!Array.isArray(rawValues) || rawValues.length === 0) {
    throw new Error("workbook.write_cells requires a non-empty values matrix.");
  }
  const values = rawValues.map((row, rowIndex) => {
    if (!Array.isArray(row) || row.length === 0) {
      throw new Error(`workbook.write_cells values[${rowIndex}] must be a non-empty row.`);
    }
    return row.map(cellText);
  });
  const width = values[0].length;
  if (values.some((row) => row.length !== width)) {
    throw new Error("workbook.write_cells values must be a rectangular matrix.");
  }
  if (values.length * width > MAX_WRITE_CELLS) {
    throw new Error(`workbook.write_cells is limited to ${MAX_WRITE_CELLS} cells per call.`);
  }
  const sheetId = optionalString(arguments_.sheet_id);
  const sheetName = optionalString(arguments_.sheet_name);
  if (sheetId && sheetName) throw new Error("workbook.write_cells accepts either sheet_id or sheet_name, not both.");
  return {
    sheetId,
    sheetName,
    startRow: boundedInteger(arguments_.start_row, undefined, 0, 1_048_575, "start_row"),
    startColumn: boundedInteger(arguments_.start_column, undefined, 0, 16_383, "start_column"),
    values,
  };
}

export function parseWorkbookFormatCellsRequest(arguments_: Record<string, unknown>): WorkbookFormatCellsRequest {
  const sheetId = optionalString(arguments_.sheet_id);
  const sheetName = optionalString(arguments_.sheet_name);
  if (sheetId && sheetName) throw new Error("workbook.format_cells accepts either sheet_id or sheet_name, not both.");

  const ranges = parseFormatRanges(arguments_.ranges ?? arguments_.range);
  const cells = ranges.reduce((total, range) => total + range.rowCount * range.columnCount, 0);
  if (cells > MAX_FORMAT_CELLS) {
    throw new Error(`workbook.format_cells is limited to ${MAX_FORMAT_CELLS} cells per call.`);
  }

  const style = parseCellStyle(arguments_.style);
  return { sheetId, sheetName, ranges, style };
}

function parseFormatRanges(raw: unknown): WorkbookFormatRange[] {
  const entries = Array.isArray(raw) ? raw : raw === undefined || raw === null ? [] : [raw];
  if (entries.length === 0) throw new Error("workbook.format_cells requires at least one range.");
  if (entries.length > MAX_FORMAT_RANGES) {
    throw new Error(`workbook.format_cells accepts at most ${MAX_FORMAT_RANGES} ranges per call.`);
  }
  return entries.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(`workbook.format_cells ranges[${index}] must be an object.`);
    }
    const range = entry as Record<string, unknown>;
    return {
      startRow: boundedInteger(range.start_row, undefined, 0, 1_048_575, `ranges[${index}].start_row`),
      startColumn: boundedInteger(range.start_column, undefined, 0, 16_383, `ranges[${index}].start_column`),
      rowCount: boundedInteger(range.row_count, 1, 1, 1_048_576, `ranges[${index}].row_count`),
      columnCount: boundedInteger(range.column_count, 1, 1, 16_384, `ranges[${index}].column_count`),
    };
  });
}

function parseCellStyle(raw: unknown): WorkbookCellStyle {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("workbook.format_cells requires a style object.");
  }
  const source = raw as Record<string, unknown>;
  const style: WorkbookCellStyle = {};

  assignDefined(style, "background", optionalColor(source.background, "style.background"));
  assignDefined(style, "color", optionalColor(source.color, "style.color"));
  assignDefined(style, "bold", optionalBoolean(source.bold, "style.bold"));
  assignDefined(style, "italic", optionalBoolean(source.italic, "style.italic"));
  assignDefined(style, "underline", optionalBoolean(source.underline, "style.underline"));
  assignDefined(style, "strike", optionalBoolean(source.strike, "style.strike"));
  assignDefined(style, "fontFamily", optionalString(source.font_family));
  assignDefined(style, "align", optionalEnum(source.align, WORKBOOK_ALIGNS, "style.align"));
  assignDefined(style, "vertical", optionalEnum(source.vertical, WORKBOOK_VERTICALS, "style.vertical"));
  assignDefined(style, "wrap", optionalEnum(source.wrap, WORKBOOK_WRAPS, "style.wrap"));
  assignDefined(style, "formatCategory", optionalEnum(source.number_format, WORKBOOK_FORMAT_CATEGORIES, "style.number_format"));
  if (source.font_size !== undefined && source.font_size !== null) {
    style.fontSize = boundedInteger(source.font_size, undefined, 1, 409, "style.font_size");
  }
  if (source.precision !== undefined && source.precision !== null) {
    style.precision = boundedInteger(source.precision, undefined, 0, 30, "style.precision");
  }

  const borderAll = optionalBorder(source.border, "style.border");
  for (const [key, field] of [["borderTop", "border_top"], ["borderRight", "border_right"], ["borderBottom", "border_bottom"], ["borderLeft", "border_left"]] as const) {
    assignDefined(style, key, optionalBorder(source[field], `style.${field}`) ?? borderAll);
  }

  if (Object.keys(style).length === 0) {
    throw new Error("workbook.format_cells style must set at least one supported property.");
  }
  return style;
}

function assignDefined<K extends keyof WorkbookCellStyle>(style: WorkbookCellStyle, key: K, value: WorkbookCellStyle[K] | undefined): void {
  if (value !== undefined) style[key] = value;
}

function optionalColor(value: unknown, label: string): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const candidate = typeof value === "string" ? value.trim() : "";
  if (!/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(candidate)) {
    throw new Error(`${label} must be a hex color such as #FFEB3B.`);
  }
  return candidate.toUpperCase();
}

function optionalBoolean(value: unknown, label: string): boolean | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "boolean") throw new Error(`${label} must be a boolean.`);
  return value;
}

function optionalEnum<T extends readonly string[]>(value: unknown, allowed: T, label: string): T[number] | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const candidate = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!allowed.includes(candidate as T[number])) {
    throw new Error(`${label} must be one of ${allowed.join(", ")}.`);
  }
  return candidate as T[number];
}

function optionalBorder(value: unknown, label: string): WorkbookBorderStyle | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  const source = value as Record<string, unknown>;
  const color = optionalColor(source.color, `${label}.color`) ?? "#000000";
  const rawStyle = typeof source.line_style === "string" ? source.line_style.trim().toLowerCase() : "thin";
  const lineStyle = WORKBOOK_LINE_STYLES[rawStyle];
  if (lineStyle === undefined) {
    throw new Error(`${label}.line_style must be one of ${Object.keys(WORKBOOK_LINE_STYLES).join(", ")}.`);
  }
  return [color, lineStyle];
}

export function parseWorkbookStageMediaRequest(arguments_: Record<string, unknown>): WorkbookStageMediaRequest {
  const filePath = optionalString(arguments_.file_path);
  const dataBase64 = optionalString(arguments_.data_base64);
  if (Boolean(filePath) === Boolean(dataBase64)) {
    throw new Error("workbook.stage_media requires exactly one of file_path or data_base64.");
  }
  const mime = optionalString(arguments_.mime);
  if (dataBase64 && !mime?.startsWith("image/")) {
    throw new Error("workbook.stage_media requires an image mime when data_base64 is used.");
  }
  const sheetId = optionalString(arguments_.sheet_id);
  const sheetName = optionalString(arguments_.sheet_name);
  if (sheetId && sheetName) throw new Error("workbook.stage_media accepts either sheet_id or sheet_name, not both.");
  return {
    filePath,
    data: dataBase64 ? decodeBase64(dataBase64) : undefined,
    mime,
    sheetId,
    sheetName,
    row: boundedInteger(arguments_.row, undefined, 0, 1_048_575, "row"),
    column: boundedInteger(arguments_.column, undefined, 0, 16_383, "column"),
    statusColumn: boundedInteger(arguments_.status_column, -1, -1, 16_383, "status_column"),
  };
}

function boundedInteger(value: unknown, fallback: number | undefined, min: number, max: number, label: string): number {
  const candidate = value === undefined || value === null || value === "" ? fallback : Number(value);
  if (candidate === undefined || !Number.isInteger(candidate) || candidate < min || candidate > max) {
    throw new Error(`${label} must be an integer between ${min} and ${max}.`);
  }
  return candidate;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function cellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  throw new Error("workbook.write_cells values may only contain strings, numbers, booleans, or null.");
}

function decodeBase64(value: string): Uint8Array {
  try {
    const bytes = base64ToUint8Array(value);
    if (bytes.byteLength === 0) throw new Error("empty");
    return bytes;
  } catch {
    throw new Error("workbook.stage_media data_base64 is invalid.");
  }
}
