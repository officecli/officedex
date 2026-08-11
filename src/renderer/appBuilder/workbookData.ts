import * as XLSX from "xlsx";
import type { BinaryFileData } from "../../shared/types";
import type { WorkbookAppField, WorkbookAppRow, WorkbookDataSnapshot, WorkbookSheetData } from "./types";

const MAX_FIELDS = 16;
const MAX_ROWS = 500;

function cellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  return String(value).trim();
}

function fieldKind(values: unknown[]): WorkbookAppField["kind"] {
  const populated = values.filter((value) => value !== "" && value !== null && value !== undefined);
  if (!populated.length) return "text";
  if (populated.every((value) => typeof value === "number")) return "number";
  if (populated.every((value) => typeof value === "boolean")) return "boolean";
  if (populated.every((value) => value instanceof Date || /^\d{4}[-/]\d{1,2}[-/]\d{1,2}/.test(cellText(value)))) return "date";
  if (populated.every((value) => typeof value === "string")) return "text";
  return "mixed";
}

function fingerprint(bytes: Uint8Array): string {
  let hash = 2166136261;
  const stride = Math.max(1, Math.floor(bytes.length / 4096));
  for (let index = 0; index < bytes.length; index += stride) {
    hash ^= bytes[index];
    hash = Math.imul(hash, 16777619);
  }
  hash ^= bytes.length;
  return (hash >>> 0).toString(36);
}

export function toUint8Array(data: BinaryFileData): Uint8Array {
  return data instanceof Uint8Array ? data : new Uint8Array(data);
}

export function parseWorkbookSnapshot(data: BinaryFileData): WorkbookDataSnapshot {
  const bytes = toUint8Array(data);
  const workbook = XLSX.read(bytes, { type: "array", cellDates: true });
  const sheets = workbook.SheetNames.map((name) => parseSheet(name, workbook.Sheets[name])).filter(Boolean) as WorkbookSheetData[];
  return {
    fingerprint: fingerprint(bytes),
    sheets,
    loadedAt: new Date().toISOString(),
  };
}

function parseSheet(name: string, sheet: XLSX.WorkSheet | undefined): WorkbookSheetData | null {
  if (!sheet) return null;
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: "",
    raw: true,
  });
  const headerIndex = matrix.findIndex((row) => row.some((value) => cellText(value)));
  if (headerIndex < 0) return { name, fields: [], rows: [] };

  const header = matrix[headerIndex].slice(0, MAX_FIELDS);
  const dataRows = matrix.slice(headerIndex + 1, headerIndex + 1 + MAX_ROWS);
  const fields = header.map((value, columnIndex) => ({
    id: `column-${columnIndex}`,
    label: cellText(value) || `Column ${columnIndex + 1}`,
    columnIndex,
    kind: fieldKind(dataRows.map((row) => row[columnIndex])),
  }));
  const rows: WorkbookAppRow[] = dataRows
    .filter((row) => row.some((value) => cellText(value)))
    .map((row, rowIndex) => ({
      id: `row-${headerIndex + rowIndex + 2}`,
      values: fields.reduce<Record<string, string | number | boolean>>((result, field) => {
        const value = row[field.columnIndex];
        result[field.id] = normalizeValue(value);
        return result;
      }, {}),
    }));
  return { name, fields, rows };
}

function normalizeValue(value: unknown): string | number | boolean {
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (value instanceof Date) return value.toLocaleDateString();
  return cellText(value);
}

export function defaultSelectedFieldIds(sheet: WorkbookSheetData | undefined): string[] {
  return sheet?.fields.slice(0, 8).map((field) => field.id) ?? [];
}

export function findSemanticField(sheet: WorkbookSheetData, kind: "title" | "status" | "owner" | "date"): WorkbookAppField | undefined {
  const patterns: Record<typeof kind, RegExp> = {
    title: /任务|标题|名称|name|title|task|项目/i,
    status: /状态|阶段|进度|status|stage|state/i,
    owner: /负责人|成员|所有者|owner|assignee|member/i,
    date: /截止|日期|时间|due|date|time/i,
  };
  return sheet.fields.find((field) => patterns[kind].test(field.label));
}

