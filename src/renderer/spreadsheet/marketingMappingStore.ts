import type { SpreadsheetPlannedColumn } from "../../shared/types";

interface StoredMarketingMapping {
  version: 1;
  schemaFingerprint: string;
  columns: SpreadsheetPlannedColumn[];
  confirmedAt: string;
}

function storageKey(filePath: string): string {
  return `officedex.spreadsheet.mapping.v1:${filePath}`;
}

export function loadMarketingMapping(filePath: string, schemaFingerprint: string): StoredMarketingMapping | undefined {
  if (!filePath || typeof localStorage === "undefined") return undefined;
  try {
    const raw = localStorage.getItem(storageKey(filePath));
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as Partial<StoredMarketingMapping>;
    if (parsed.version !== 1 || parsed.schemaFingerprint !== schemaFingerprint || !Array.isArray(parsed.columns)) return undefined;
    return parsed as StoredMarketingMapping;
  } catch {
    return undefined;
  }
}

export function saveMarketingMapping(filePath: string, schemaFingerprint: string, columns: SpreadsheetPlannedColumn[]): void {
  if (!filePath || typeof localStorage === "undefined") return;
  const value: StoredMarketingMapping = {
    version: 1,
    schemaFingerprint,
    columns: columns.map((column) => ({ ...column })),
    confirmedAt: new Date().toISOString(),
  };
  try {
    localStorage.setItem(storageKey(filePath), JSON.stringify(value));
  } catch {
    // The mapping remains valid for the current session even when app storage
    // is unavailable. It must never fall back to writing into the workbook.
  }
}
