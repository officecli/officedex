import type { ImagePromptTemplate } from "../shared/types";
import type { OfficeImageAsset } from "../shared/officeProduct";

export function imageAssetFromTemplate(input: { projectId: string; template: ImagePromptTemplate; title?: string; filePath?: string; version?: number; workbookId?: string; viewIds?: string[] }): OfficeImageAsset {
  return {
    id: `image:${input.projectId}:${input.template.slug}:${Date.now().toString(36)}`,
    projectId: input.projectId,
    type: "image",
    mode: "template",
    templateId: String(input.template.id),
    title: input.title || input.template.title,
    filePath: input.filePath,
    version: input.version ?? 1,
    status: "succeeded",
    lineage: input.workbookId ? { workbookId: input.workbookId, viewIds: input.viewIds ?? [], sourceIds: [], workbookFingerprint: "", capturedAt: new Date().toISOString() } : undefined,
    updatedAt: new Date().toISOString(),
  };
}
