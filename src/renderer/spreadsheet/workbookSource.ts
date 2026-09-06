import type { WorkbookSourceRef } from "../../shared/officeProduct";

export type WorkbookImportKind = WorkbookSourceRef["kind"];

export function workbookSourceId(workbookId: string, kind: WorkbookImportKind, name: string): string {
  return `source:${workbookId}:${kind}:${name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
}

export function makeWorkbookSource(input: { workbookId: string; kind: WorkbookImportKind; name: string; location?: string; importedAt?: string; error?: string }): WorkbookSourceRef {
  return {
    id: workbookSourceId(input.workbookId, input.kind, input.name),
    workbookId: input.workbookId,
    name: input.name,
    kind: input.kind,
    location: input.location,
    lastImportedAt: input.importedAt,
    lastError: input.error,
  };
}

export function sourceAfterImport(source: WorkbookSourceRef, result: { importedAt: string; error?: string }): WorkbookSourceRef {
  return { ...source, lastImportedAt: result.importedAt, lastError: result.error };
}
