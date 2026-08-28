/**
 * XLSX T2 range-addressing contract.
 *
 * This module is deliberately pure and identity-only. It does not read an
 * XLSX file, invoke a model, mutate a workbook, or charge Credits.
 */

export const XLSX_MAX_ROWS = 1_048_576;
export const XLSX_MAX_COLUMNS = 16_384;

/** Explicit T2 support boundary for callers that need to render capabilities. */
export const XLSX_T2_RANGE_CAPABILITIES = Object.freeze({
  singleCell: true,
  rectangularRange: true,
  wholeRow: false,
  wholeColumn: false,
  multiArea: false,
  mergedCells: false,
} as const);

export interface XlsxWorkbookIdentity {
  readonly workbookId: string;
  readonly workbookName?: string;
}

export interface XlsxSheetIdentity {
  readonly sheetId: string;
  readonly sheetName?: string;
}

export interface XlsxGridBounds {
  readonly maxRows?: number;
  readonly maxColumns?: number;
}

export interface XlsxCellAddress {
  /** One-based row number. */
  readonly row: number;
  /** One-based column number. */
  readonly column: number;
}

export interface XlsxRangeAddress {
  readonly kind: "cell" | "range";
  readonly start: XlsxCellAddress;
  readonly end: XlsxCellAddress;
  /** Canonical, absolute-free A1 notation, e.g. A1 or B2:D4. */
  readonly a1: string;
}

export type XlsxRangeInput = string | {
  readonly startRow: number;
  readonly startColumn: number;
  readonly endRow: number;
  readonly endColumn: number;
};

export interface XlsxDocumentSelection {
  readonly scope: "document";
  readonly workbook: XlsxWorkbookIdentity;
  readonly sheet: XlsxSheetIdentity;
  readonly range: null;
}

export interface XlsxRangeSelection {
  readonly scope: "range";
  readonly workbook: XlsxWorkbookIdentity;
  readonly sheet: XlsxSheetIdentity;
  readonly range: XlsxRangeAddress;
}

export type XlsxSelection = XlsxDocumentSelection | XlsxRangeSelection;

export interface XlsxSelectionInput {
  readonly range?: XlsxRangeInput | null;
  /** Multi-area selections are intentionally unsupported in T2. */
  readonly areaCount?: number;
  /** Merged-cell selections are intentionally unsupported in T2. */
  readonly merged?: boolean;
}

export interface XlsxActionReference {
  readonly id: string;
  readonly version: string;
}

export interface XlsxLocalEditRequest {
  readonly workbook: XlsxWorkbookIdentity;
  readonly sheet: XlsxSheetIdentity;
  readonly range: XlsxRangeAddress | null;
  readonly instruction: string;
  readonly actionReference: XlsxActionReference;
}

export class XlsxRangeAddressingError extends Error {
  readonly code:
    | "invalid-identity"
    | "invalid-range"
    | "unsupported-unbounded-range"
    | "unsupported-multi-area"
    | "unsupported-merged-cells"
    | "invalid-bounds"
    | "invalid-instruction"
    | "invalid-action";

  constructor(code: XlsxRangeAddressingError["code"], message: string) {
    super(message);
    this.name = "XlsxRangeAddressingError";
    this.code = code;
  }
}

function freezeDeep<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value as Record<string, unknown>)) freezeDeep(child);
  return value;
}

function assertIdentity(workbook: XlsxWorkbookIdentity, sheet: XlsxSheetIdentity): void {
  if (!workbook || typeof workbook.workbookId !== "string" || !workbook.workbookId.trim()
    || (workbook.workbookName !== undefined && typeof workbook.workbookName !== "string")
    || !sheet || typeof sheet.sheetId !== "string" || !sheet.sheetId.trim()
    || (sheet.sheetName !== undefined && typeof sheet.sheetName !== "string")) {
    throw new XlsxRangeAddressingError("invalid-identity", "A non-empty workbookId and sheetId are required.");
  }
}

function resolveBounds(bounds: XlsxGridBounds = {}): { maxRows: number; maxColumns: number } {
  const maxRows = bounds.maxRows ?? XLSX_MAX_ROWS;
  const maxColumns = bounds.maxColumns ?? XLSX_MAX_COLUMNS;
  if (!Number.isInteger(maxRows) || maxRows < 1 || maxRows > XLSX_MAX_ROWS
    || !Number.isInteger(maxColumns) || maxColumns < 1 || maxColumns > XLSX_MAX_COLUMNS) {
    throw new XlsxRangeAddressingError("invalid-bounds", "Grid bounds must be positive integers within XLSX limits.");
  }
  return { maxRows, maxColumns };
}

function columnLettersToNumber(value: string): number {
  let result = 0;
  for (const character of value.toUpperCase()) {
    result = result * 26 + character.charCodeAt(0) - 64;
    if (result > XLSX_MAX_COLUMNS) break;
  }
  return result;
}

function columnNumberToLetters(value: number): string {
  let current = value;
  let result = "";
  while (current > 0) {
    const remainder = (current - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    current = Math.floor((current - 1) / 26);
  }
  return result;
}

function parseCell(value: string): XlsxCellAddress {
  const match = /^\$?([A-Za-z]+)\$?([0-9]+)$/.exec(value);
  if (!match) throw new XlsxRangeAddressingError("invalid-range", `Invalid XLSX cell address: ${value}`);
  const column = columnLettersToNumber(match[1]);
  const row = Number(match[2]);
  if (!Number.isSafeInteger(row) || row < 1 || !Number.isSafeInteger(column) || column < 1) {
    throw new XlsxRangeAddressingError("invalid-range", `Invalid XLSX cell address: ${value}`);
  }
  return { row, column };
}

function parseRangeString(value: string): { start: XlsxCellAddress; end: XlsxCellAddress } {
  const normalized = value.trim();
  if (!normalized) throw new XlsxRangeAddressingError("invalid-range", "An A1 range is required.");
  if (normalized.includes(",")) {
    throw new XlsxRangeAddressingError("unsupported-multi-area", "Multi-area XLSX selections are not supported.");
  }
  // Whole rows (1:3) and columns (A:C) are unbounded in T2.
  if (/^\$?[0-9]+\s*:\s*\$?[0-9]+$/.test(normalized) || /^\$?[A-Za-z]+\s*:\s*\$?[A-Za-z]+$/.test(normalized)) {
    throw new XlsxRangeAddressingError("unsupported-unbounded-range", "Whole-row and whole-column ranges are not supported in XLSX T2.");
  }
  const parts = normalized.split(":");
  if (parts.length > 2) throw new XlsxRangeAddressingError("invalid-range", `Invalid XLSX range: ${value}`);
  const first = parseCell(parts[0].trim());
  const second = parts[1] === undefined ? first : parseCell(parts[1].trim());
  return { start: first, end: second };
}

function parseRangeInput(input: XlsxRangeInput): { start: XlsxCellAddress; end: XlsxCellAddress } {
  if (typeof input === "string") return parseRangeString(input);
  if (!input || ![input.startRow, input.startColumn, input.endRow, input.endColumn].every(Number.isFinite)
    || ![input.startRow, input.startColumn, input.endRow, input.endColumn].every(Number.isInteger)) {
    throw new XlsxRangeAddressingError("invalid-range", "Numeric range coordinates must be integers.");
  }
  return {
    start: { row: input.startRow, column: input.startColumn },
    end: { row: input.endRow, column: input.endColumn },
  };
}

/** Parse and canonicalize a bounded A1 cell or rectangle selection. */
export function normalizeXlsxRange(input: XlsxRangeInput, bounds: XlsxGridBounds = {}): XlsxRangeAddress {
  const limits = resolveBounds(bounds);
  const parsed = parseRangeInput(input);
  const startRow = Math.max(1, Math.min(limits.maxRows, Math.min(parsed.start.row, parsed.end.row)));
  const endRow = Math.max(1, Math.min(limits.maxRows, Math.max(parsed.start.row, parsed.end.row)));
  const startColumn = Math.max(1, Math.min(limits.maxColumns, Math.min(parsed.start.column, parsed.end.column)));
  const endColumn = Math.max(1, Math.min(limits.maxColumns, Math.max(parsed.start.column, parsed.end.column)));
  if (startRow > endRow || startColumn > endColumn) {
    throw new XlsxRangeAddressingError("invalid-range", "XLSX range does not intersect the bounded grid.");
  }
  const start = { row: startRow, column: startColumn };
  const end = { row: endRow, column: endColumn };
  const a1Start = `${columnNumberToLetters(start.column)}${start.row}`;
  const a1End = `${columnNumberToLetters(end.column)}${end.row}`;
  return freezeDeep({ kind: start.row === end.row && start.column === end.column ? "cell" : "range", start, end, a1: a1Start === a1End ? a1Start : `${a1Start}:${a1End}` });
}

/** Named parser alias for stage callers that distinguish parsing from normalization. */
export const parseXlsxRange = normalizeXlsxRange;

/** Resolve absent selection to document scope; present selection to range scope. */
export function resolveXlsxSelection(
  workbook: XlsxWorkbookIdentity,
  sheet: XlsxSheetIdentity,
  input?: XlsxSelectionInput | null,
  bounds: XlsxGridBounds = {},
): XlsxSelection {
  assertIdentity(workbook, sheet);
  if (input?.merged) throw new XlsxRangeAddressingError("unsupported-merged-cells", "Merged-cell selections are not supported in XLSX T2.");
  if (input && input.areaCount !== undefined && input.areaCount !== 1) {
    throw new XlsxRangeAddressingError("unsupported-multi-area", "Only one contiguous XLSX selection is supported.");
  }
  if (input?.range != null) {
    return freezeDeep({ scope: "range", workbook: { ...workbook }, sheet: { ...sheet }, range: normalizeXlsxRange(input.range, bounds) });
  }
  return freezeDeep({ scope: "document", workbook: { ...workbook }, sheet: { ...sheet }, range: null });
}

export function createXlsxLocalEditRequest(input: {
  readonly workbook: XlsxWorkbookIdentity;
  readonly sheet: XlsxSheetIdentity;
  readonly selection?: XlsxSelectionInput | null;
  readonly bounds?: XlsxGridBounds;
  readonly instruction: string;
  readonly actionReference?: XlsxActionReference;
}): XlsxLocalEditRequest {
  const selection = resolveXlsxSelection(input.workbook, input.sheet, input.selection, input.bounds);
  const instruction = input.instruction.trim();
  if (!instruction) throw new XlsxRangeAddressingError("invalid-instruction", "An edit instruction is required.");
  const actionReference = input.actionReference ?? { id: "xlsx.edit.local", version: "v1" };
  if (!actionReference || typeof actionReference.id !== "string" || !actionReference.id.trim()
    || typeof actionReference.version !== "string" || !actionReference.version.trim()) {
    throw new XlsxRangeAddressingError("invalid-action", "A versioned action reference is required.");
  }
  return freezeDeep({
    workbook: { ...selection.workbook },
    sheet: { ...selection.sheet },
    range: selection.range,
    instruction,
    actionReference: { ...actionReference },
  });
}
