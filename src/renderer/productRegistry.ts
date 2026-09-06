import type { OfficeImageAsset, OfficeOutputRef, OfficeProjectRef, WorkbookSourceRef, WorkbookViewRef } from "../shared/officeProduct";

export interface OfficeProductRegistry {
  projects: OfficeProjectRef[];
  sources: WorkbookSourceRef[];
  views: WorkbookViewRef[];
  outputs: OfficeOutputRef[];
  images: OfficeImageAsset[];
}

export const emptyOfficeProductRegistry = (): OfficeProductRegistry => ({
  projects: [],
  sources: [],
  views: [],
  outputs: [],
  images: [],
});

export function upsertOutput(registry: OfficeProductRegistry, output: OfficeOutputRef): OfficeProductRegistry {
  return {
    ...registry,
    outputs: [output, ...registry.outputs.filter((item) => item.id !== output.id)],
  };
}

export function outputsForWorkbook(registry: OfficeProductRegistry, workbookId: string): OfficeOutputRef[] {
  return registry.outputs.filter((output) => output.lineage?.workbookId === workbookId);
}

export function affectedOutputs(registry: OfficeProductRegistry, viewId: string): OfficeOutputRef[] {
  return registry.outputs.filter((output) => output.lineage?.viewIds.includes(viewId));
}

export function registerImageAsset(registry: OfficeProductRegistry, image: OfficeImageAsset): OfficeProductRegistry {
  return {
    ...registry,
    images: [image, ...registry.images.filter((item) => item.id !== image.id)],
  };
}
