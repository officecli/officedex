import type { GenerateInput } from "../shared/types";

export const defaultGenerateInput: Partial<GenerateInput> = {
  documentType: "pptx",
  mode: "fast",
  runtimeMode: "hosted",
  enableImages: true,
};
