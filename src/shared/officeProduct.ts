/**
 * Canonical product model shared by the renderer and bridge adapters.
 *
 * Excel is the source of record. Other outputs are projections of a
 * particular workbook/view version and keep their lineage so a refresh can be
 * explicit and reviewable instead of silently overwriting user edits.
 */

export type OfficeProductType = "spreadsheet" | "presentation" | "document" | "html-app" | "image";
export type OfficeAssetMode = "standalone" | "template" | "contextual";
export type OfficeRunStatus = "queued" | "running" | "awaiting_input" | "succeeded" | "failed" | "cancelled" | "needs_repair";
export type WorkbookLayer = "raw" | "model" | "view";

export interface OfficeProjectRef {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface WorkbookSourceRef {
  id: string;
  workbookId: string;
  name: string;
  kind: "local-file" | "txt" | "csv" | "json" | "jira" | "shopify" | "manual" | "other";
  location?: string;
  lastImportedAt?: string;
  lastError?: string;
}

export interface WorkbookViewRef {
  id: string;
  workbookId: string;
  sheetName: string;
  layer: WorkbookLayer;
  range?: string;
  fingerprint: string;
  updatedAt: string;
}

export interface OfficeLineageRef {
  workbookId: string;
  viewIds: string[];
  sourceIds: string[];
  workbookFingerprint: string;
  capturedAt: string;
}

export interface OfficeOutputRef {
  id: string;
  projectId: string;
  type: OfficeProductType;
  title: string;
  filePath?: string;
  version: number;
  status: OfficeRunStatus;
  lineage?: OfficeLineageRef;
  manuallyEdited?: boolean;
  updatedAt: string;
}

export interface OfficeImageAsset extends OfficeOutputRef {
  type: "image";
  mode: OfficeAssetMode;
  templateId?: string;
  width?: number;
  height?: number;
  contentType?: string;
}

export interface OfficeRefreshPlan {
  outputId: string;
  changedViews: string[];
  strategy: "data-only" | "charts" | "content" | "full";
  preserveManualEdits: boolean;
  requiresApproval: boolean;
}

export function createLineage(input: {
  workbookId: string;
  viewIds?: string[];
  sourceIds?: string[];
  workbookFingerprint: string;
  capturedAt?: string;
}): OfficeLineageRef {
  return {
    workbookId: input.workbookId,
    viewIds: [...new Set(input.viewIds ?? [])],
    sourceIds: [...new Set(input.sourceIds ?? [])],
    workbookFingerprint: input.workbookFingerprint,
    capturedAt: input.capturedAt ?? new Date().toISOString(),
  };
}

export function lineageChanged(output: OfficeOutputRef, next: OfficeLineageRef): boolean {
  return output.lineage?.workbookFingerprint !== next.workbookFingerprint
    || output.lineage?.workbookId !== next.workbookId;
}

export function planRefresh(output: OfficeOutputRef, next: OfficeLineageRef): OfficeRefreshPlan {
  const changed = lineageChanged(output, next);
  const strategy: OfficeRefreshPlan["strategy"] = !changed
    ? "data-only"
    : output.type === "html-app" || output.type === "presentation"
      ? "charts"
      : output.type === "document"
        ? "content"
        : "full";
  return {
    outputId: output.id,
    changedViews: next.viewIds.filter((id) => !output.lineage?.viewIds.includes(id)),
    strategy,
    preserveManualEdits: Boolean(output.manuallyEdited),
    requiresApproval: Boolean(output.manuallyEdited && changed),
  };
}
