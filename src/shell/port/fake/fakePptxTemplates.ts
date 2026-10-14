import type { PptxTemplateAssetSummary } from "../../../shared/pptxTemplates";
import type { PptxTemplateProgress } from "../../../shared/types";
import type { PptxTemplatePort } from "../../../shared/uiPort";

/**
 * PPT templates without a desktop: an in-memory catalogue whose learning walks
 * the desktop's five stages on a timer. For the dev fixture and tests only —
 * nothing is read, converted or analysed.
 *
 * `pickNext` is what the next "Choose file" returns; tests set it (or null for
 * a cancelled picker). `failNext` makes the next learning fail at analysis.
 */
export interface FakePptxTemplates {
  port: PptxTemplatePort;
  pickNext: { path: string; fileName: string } | null;
  failNext: boolean;
  /** Milliseconds per stage; 0 learns at once. */
  stepMs: number;
}

const STAGES: PptxTemplateProgress["stage"][] = ["copy", "convert", "extract", "analyze", "skill"];

export function createFakePptxTemplates(seed: PptxTemplateAssetSummary[] = []): FakePptxTemplates {
  let templates = seed.map((template) => ({ ...template }));
  let counter = 0;
  const fake: FakePptxTemplates = {
    pickNext: { path: "/Users/demo/Templates/Quarterly review.pptx", fileName: "Quarterly review.pptx" },
    failNext: false,
    stepMs: 0,
    port: {
      async list() {
        return templates.map((template) => ({ ...template }));
      },
      async pick() {
        return fake.pickNext ? { ...fake.pickNext } : null;
      },
      async learn(input, onProgress) {
        counter += 1;
        const id = `tpl-fake-${counter}`;
        const sourceFileName = input.sourcePath.split(/[\\/]/).pop() ?? input.sourcePath;
        const localAssetDir = `/fake/ppt-templates/${id}`;
        const fail = fake.failNext;
        fake.failNext = false;
        for (const [index, stage] of STAGES.entries()) {
          if (fake.stepMs) await new Promise((resolve) => setTimeout(resolve, fake.stepMs));
          onProgress({ id, name: input.name, sourceFileName, localAssetDir, status: "analyzing", stage, step: index + 1, steps: STAGES.length });
          if (fail && stage === "analyze") {
            onProgress({ id, name: input.name, sourceFileName, localAssetDir, status: "failed", stage: "failed", step: index + 1, steps: STAGES.length, error: "The style could not be learned." });
            throw new Error("The style could not be learned.");
          }
        }
        const now = new Date().toISOString();
        const template: PptxTemplateAssetSummary = {
          id,
          name: input.name,
          sourceFileName,
          localAssetDir,
          status: "ready",
          version: 1,
          pageCount: 12,
          supportedPageTypes: [],
          assetCounts: { logo: 1, icons: 4, images: 6, decorative: 3 },
          warnings: [],
          createdAt: now,
          updatedAt: now,
        };
        templates = [template, ...templates];
        return { ...template };
      },
      async rename(id, name) {
        templates = templates.map((template) => (template.id === id ? { ...template, name } : template));
      },
      async remove(id) {
        templates = templates.filter((template) => template.id !== id);
      },
    },
  };
  return fake;
}
