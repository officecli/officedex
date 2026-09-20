import type { DocumentType, ImageRatio } from "../shared/types";
import { fileExtension } from "./utils/path";

export interface HomeTaskIntake {
  pptxWorkflow?: "design" | "animation";
  prompt: string;
  sourceFile?: string;
  referenceDirectory?: string;
  referenceImages?: string[];
  referenceTextFiles?: string[];
  imageRatio?: ImageRatio;
  fps?: number;
  documentType?: DocumentType;
  /** When enabled, pause for an AI plan and user decisions before generation. */
  advancedMode?: boolean;
  templateId?: string;
  templateVersion?: number;
  templateAssetDir?: string;
}

export interface HomeTaskAnalysis extends HomeTaskIntake {
  kind: "catalog_cleanup" | "generate";
  documentType: DocumentType;
  nextStep: "configure" | "plan" | "execute";
}

export type HomeTaskRoute =
  | { kind: "catalog_cleanup"; documentType: "xlsx"; sourceFile: string }
  | { kind: "generate"; documentType: DocumentType; sourceFile?: string }
  | { kind: "needs_source"; documentType: "xlsx" };

const CATALOG_SUBJECT = /(shopify|supplier|catalog|product|sku|供应商|商品|产品|货品)/i;
const CATALOG_ACTION = /(clean|cleanup|validate|normalize|import|convert|csv|清洗|校验|规范|整理|导入|转换)/i;

function isCatalogCleanupIntent(prompt: string) {
  if (/(image|illustration|poster|banner|图片|插画|海报|封面|配图)/i.test(prompt)) return false;
  return CATALOG_SUBJECT.test(prompt) && CATALOG_ACTION.test(prompt);
}

export function inferHomeTaskRoute(input: HomeTaskIntake, fallback: DocumentType = "pptx"): HomeTaskRoute {
  const prompt = input.prompt.trim();
  const sourceFile = input.sourceFile?.trim() || undefined;
  const extension = fileExtension(sourceFile);
  const hasPptxTemplate = Boolean(input.templateId || input.templateAssetDir);

  // A local PPT template is an explicit slide request. Prompt words such as
  // 「方案」or "proposal" otherwise match the Word heuristic and would drop
  // the template binding on the way to generate.
  if (hasPptxTemplate) {
    return { kind: "generate", documentType: "pptx", sourceFile };
  }

  /*
   * Catalog cleanup is a route of its own, not a type — and it still outranks a
   * stated type whenever there is really a catalog to clean.
   *
   * The guard used to be unconditional, which was harmless while the only
   * caller was Home's picker and harmful once the composer grew an output
   * control: "make me a document about tidying up the supplier list" with no
   * file attached hit `needs_source` and came back as "that request needs a
   * file to work from" — a refusal, in answer to a request that needed no file
   * at all. Cleanup now needs something to clean: a workbook the user pointed
   * at, or their own word that a workbook is what they want.
   */
  const cleanUpCatalog =
    isCatalogCleanupIntent(prompt)
    && (!input.documentType || input.documentType === "xlsx" || extension === "xlsx");
  if (cleanUpCatalog) {
    if (sourceFile) {
      if (extension === "xlsx") return { kind: "catalog_cleanup", documentType: "xlsx", sourceFile };
      return { kind: "generate", documentType: "xlsx", sourceFile };
    }
    /*
     * Nothing to clean.
     *
     * The stated type is what keeps docx and pptx out of this branch, but
     * `xlsx` walks straight in — and the composer sets that type exactly when
     * the user picked "New workbook", which clears the active file as it does.
     * So 「帮我整理一份产品清单表」with New workbook selected came back as
     * "that request needs a file to work from", about a file the user had just
     * said they did not have. A stated workbook with no source is a workbook to
     * make; only an inferred one is still a question.
     */
    if (input.documentType) return { kind: "generate", documentType: "xlsx" };
    return { kind: "needs_source", documentType: "xlsx" };
  }

  // The output-type control is the user's choice. Keyword matching only fills
  // in when they did not make one — otherwise 「方案」turns a selected PPT into
  // a Word document.
  if (input.documentType) {
    return { kind: "generate", documentType: input.documentType, sourceFile };
  }

  if (/(gif|动图|动画图)/i.test(prompt)) return { kind: "generate", documentType: "gif", sourceFile };
  if (/(slides?|pptx?|presentation|deck|演示|幻灯片|路演)/i.test(prompt)) return { kind: "generate", documentType: "pptx", sourceFile };
  if (/(image|poster|banner|illustration|图片|海报|封面|配图)/i.test(prompt)) return { kind: "generate", documentType: "img", sourceFile };
  if (/(report|analysis|研究报告|分析报告|调研报告)/i.test(prompt)) {
    return { kind: "generate", documentType: extension === "xlsx" ? "report" : "docx", sourceFile };
  }
  if (/(spreadsheet|workbook|excel|xlsx|csv|table|表格|工作簿|数据表)/i.test(prompt) || extension === "csv") {
    return { kind: "generate", documentType: "xlsx", sourceFile };
  }
  if (/(word|docx|document|proposal|memo|文档|方案|合同|纪要)/i.test(prompt)) {
    return { kind: "generate", documentType: "docx", sourceFile };
  }

  return { kind: "generate", documentType: fallback, sourceFile };
}
