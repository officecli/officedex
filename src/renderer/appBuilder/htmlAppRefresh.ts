import type { OfficeOutputRef, OfficeRefreshPlan } from "../../shared/officeProduct";
import type { WorkbookDataSnapshot } from "./types";
import { buildHtmlAppFiles, htmlAppFilesAsBytes } from "./htmlAppRuntime";
import { buildHtmlAppSpec } from "./htmlAppModel";

export interface HtmlAppWriter { write(input: { root: string; files: Record<string, Uint8Array> }): Promise<string[]>; }

export async function refreshHtmlApp(output: OfficeOutputRef, plan: OfficeRefreshPlan, snapshot: WorkbookDataSnapshot, writer: HtmlAppWriter): Promise<OfficeOutputRef> {
  if (output.type !== "html-app") throw new Error("HTML refresh requires an html-app output");
  if (!output.filePath) throw new Error("HTML output has no materialized path");
  const spec = buildHtmlAppSpec(snapshot, snapshot.sheets[0]?.name, output.title);
  if (!spec) throw new Error("Workbook contains no sheet for HTML refresh");
  const files = await writer.write({ root: output.filePath.replace(/[/\\][^/\\]+$/, ""), files: htmlAppFilesAsBytes(buildHtmlAppFiles(spec, snapshot)) });
  return { ...output, version: output.version + 1, status: "succeeded", filePath: files[0] ?? output.filePath, lineage: { workbookId: output.lineage?.workbookId ?? "", viewIds: plan.changedViews, sourceIds: output.lineage?.sourceIds ?? [], workbookFingerprint: snapshot.fingerprint, capturedAt: new Date().toISOString() }, updatedAt: new Date().toISOString() };
}
