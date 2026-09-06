import type { OfficeOutputRef } from "../shared/officeProduct";

const outputTypes = new Set<OfficeOutputRef["type"]>(["spreadsheet", "presentation", "document", "html-app", "image"]);
const statuses = new Set<OfficeOutputRef["status"]>(["queued", "running", "awaiting_input", "succeeded", "failed", "cancelled", "needs_repair"]);

export interface OfficeOutputDTO {
  id: string; projectId: string; outputType: string; title: string; filePath?: string; version: number; status: string;
  workbookId?: string; viewIds?: string[]; sourceIds?: string[]; workbookFingerprint?: string; lineageCapturedAt?: string; manuallyEdited: boolean; updatedAt: string;
}

export function decodeOfficeOutput(input: OfficeOutputDTO): OfficeOutputRef | undefined {
  if (!outputTypes.has(input.outputType as OfficeOutputRef["type"]) || !statuses.has(input.status as OfficeOutputRef["status"])) return undefined;
  return {
    id: input.id,
    projectId: input.projectId,
    type: input.outputType as OfficeOutputRef["type"],
    title: input.title,
    filePath: input.filePath,
    version: input.version,
    status: input.status as OfficeOutputRef["status"],
    manuallyEdited: input.manuallyEdited,
    lineage: input.workbookId ? { workbookId: input.workbookId, viewIds: input.viewIds ?? [], sourceIds: input.sourceIds ?? [], workbookFingerprint: input.workbookFingerprint ?? "", capturedAt: input.lineageCapturedAt ?? input.updatedAt } : undefined,
    updatedAt: input.updatedAt,
  };
}

export function decodeOfficeOutputs(inputs: OfficeOutputDTO[]): OfficeOutputRef[] {
  return inputs.flatMap((input) => { const decoded = decodeOfficeOutput(input); return decoded ? [decoded] : []; });
}
