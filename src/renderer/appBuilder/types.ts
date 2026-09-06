export type AppBuilderAccess = "private" | "workspace" | "organization";

/** Product-facing name for the workbook-backed app. The legacy aliases below
 * remain source-compatible while the UI migrates from “app builder” wording
 * to HTML data applications. */
export type WorkbookOutputKind = "html-app";

export interface WorkbookAppField {
  id: string;
  label: string;
  columnIndex: number;
  kind: "text" | "number" | "date" | "boolean" | "mixed";
}

export interface WorkbookAppRow {
  id: string;
  values: Record<string, string | number | boolean>;
}

export interface WorkbookSheetData {
  name: string;
  fields: WorkbookAppField[];
  rows: WorkbookAppRow[];
}

export interface WorkbookDataSnapshot {
  fingerprint: string;
  sheets: WorkbookSheetData[];
  loadedAt: string;
}

export interface WorkbookAppConfig {
  name: string;
  slug: string;
  prompt: string;
  sheetName: string;
  fieldIds: string[];
  access: AppBuilderAccess;
  allowCreate: boolean;
  allowUpdate: boolean;
  outputKind?: WorkbookOutputKind;
  refreshMode?: "snapshot" | "live";
}

export interface PublishedWorkbookApp {
  id: string;
  sourceFileName: string;
  config: WorkbookAppConfig;
  publishedAt: string;
  outputKind?: WorkbookOutputKind;
  htmlSpec?: {
    kind: "html-app";
    slug: string;
    title: string;
    refreshMode: "live";
    source: { fingerprint: string; sheetName: string; fieldIds: string[] };
    components: Array<{ type: "table" | "kpi"; id: string; columns?: string[]; fieldId?: string }>;
  };
  materializedFiles?: string[];
  version?: number;
}
