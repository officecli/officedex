import type { DocumentType, GenerateInput } from "../shared/types";
import { DOCUMENT_TYPES, getCapability } from "../shared/types";

export type NavKey = "dialogue" | "tasks" | "settings" | "login";

export const defaultGenerateInput: Partial<GenerateInput> = {
  documentType: "pptx",
  mode: "fast",
  runtimeMode: "hosted",
  enableImages: true,
};

export const documentTypeOptions: Array<{ value: DocumentType; label: string; icon: string }> = DOCUMENT_TYPES.map((type) => {
  const capability = getCapability(type);
  return { value: capability.type, label: capability.label, icon: capability.icon };
});
