import path from "node:path";
import type { GenerateInput } from "../shared/types.js";

export function desktopWorkspaceDir(userDataDir: string): string {
  return path.join(userDataDir, "workspace");
}

export function withDefaultOutputDir(input: GenerateInput, workspaceDir: string): GenerateInput {
  if (input.outputDir?.trim()) {
    return input;
  }
  return { ...input, outputDir: workspaceDir };
}
