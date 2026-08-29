import type { DocumentType, ImageRatio } from "../shared/types";
import { fileExtension } from "./utils/path";

export interface HomeTaskIntake {
  prompt: string;
  sourceFile?: string;
  referenceDirectory?: string;
  referenceImages?: string[];
  imageRatio?: ImageRatio;
  fps?: number;
  documentType?: DocumentType;
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

  if (isCatalogCleanupIntent(prompt)) {
    if (!sourceFile) return { kind: "needs_source", documentType: "xlsx" };
    if (extension === "xlsx") return { kind: "catalog_cleanup", documentType: "xlsx", sourceFile };
    return { kind: "generate", documentType: "xlsx", sourceFile };
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
