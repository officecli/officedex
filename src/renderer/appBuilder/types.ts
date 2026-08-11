export type AppBuilderAccess = "private" | "workspace" | "organization";

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
}

export interface PublishedWorkbookApp {
  id: string;
  sourceFileName: string;
  config: WorkbookAppConfig;
  publishedAt: string;
}

