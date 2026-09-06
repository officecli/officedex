import type { WorkbookDataSnapshot, WorkbookSheetData } from "./types";

export interface HtmlAppSpec {
  kind: "html-app";
  slug: string;
  title: string;
  refreshMode: "live";
  source: { fingerprint: string; sheetName: string; fieldIds: string[] };
  components: Array<
    | { type: "table"; id: string; columns: string[] }
    | { type: "kpi"; id: string; fieldId: string }
  >;
}

function numericFields(sheet: WorkbookSheetData): string[] {
  return sheet.fields.filter((field) => field.kind === "number").map((field) => field.id);
}

/** Builds a deterministic, serialisable contract consumed by the Vite HTML
 * renderer. It deliberately contains no React or editor state so the same
 * workbook snapshot can drive a preview, a local Vite app, or a future export.
 */
export function buildHtmlAppSpec(snapshot: WorkbookDataSnapshot, sheetName?: string, title = "Data application"): HtmlAppSpec | undefined {
  const sheet = snapshot.sheets.find((item) => item.name === sheetName) ?? snapshot.sheets[0];
  if (!sheet) return undefined;
  const numeric = numericFields(sheet);
  return {
    kind: "html-app",
    slug: title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "data-app",
    title,
    refreshMode: "live",
    source: { fingerprint: snapshot.fingerprint, sheetName: sheet.name, fieldIds: sheet.fields.map((field) => field.id) },
    components: [
      ...(numeric.slice(0, 4).map((fieldId) => ({ type: "kpi" as const, id: `kpi-${fieldId}`, fieldId }))),
      { type: "table", id: "data-table", columns: sheet.fields.map((field) => field.id) },
    ],
  };
}
