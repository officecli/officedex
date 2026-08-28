import type { DocumentType } from "../../shared/types";

/**
 * What the home screen offers instead of a blank document. Both groups enter the
 * same workflow — picking one preselects the document type and prefills the
 * topic and prompt, leaving the user to confirm rather than compose.
 *
 * `creation` covers "write me a deck" style starts; `scenario` covers the
 * recurring jobs that already know where their material comes from.
 *
 * Titles and descriptions live in i18n under `dialogue.preset.<id>.*`.
 */
export interface Solution {
  readonly id: string;
  readonly kind: "creation" | "scenario";
  readonly documentType: DocumentType;
  readonly icon: string;
  readonly estimateMinutes: number;
  /** How often this has been run, so a card says whether it is a trodden path. */
  readonly runs: number;
  /** Words that route a typed intent here, matched case-insensitively. */
  readonly keywords: readonly string[];
}

export const solutions: readonly Solution[] = [
  // ── one-line starts
  { id: "deck", kind: "creation", documentType: "pptx", icon: "present_to_all", estimateMinutes: 3, runs: 41,
    keywords: ["deck", "slides", "presentation", "ppt", "pptx", "演示", "幻灯"] },
  { id: "doc", kind: "creation", documentType: "docx", icon: "description", estimateMinutes: 2, runs: 22,
    keywords: ["word", "docx", "document", "文档"] },
  { id: "sheet", kind: "creation", documentType: "xlsx", icon: "table_chart", estimateMinutes: 1, runs: 15,
    keywords: ["spreadsheet", "excel", "xlsx", "sheet", "表格"] },
  { id: "research", kind: "creation", documentType: "report", icon: "analytics", estimateMinutes: 6, runs: 12,
    keywords: ["research", "study", "调研", "研究"] },
  { id: "picture", kind: "creation", documentType: "img", icon: "image", estimateMinutes: 1, runs: 33,
    keywords: ["image", "picture", "illustration", "配图", "图片"] },
  // ── homepage templates
  { id: "weekly", kind: "scenario", documentType: "pptx", icon: "trending_up", estimateMinutes: 2, runs: 24,
    keywords: ["weekly", "week", "周报"] },
  { id: "qbr", kind: "scenario", documentType: "pptx", icon: "insert_chart", estimateMinutes: 5, runs: 6,
    keywords: ["quarterly business", "qbr", "季度经营"] },
  { id: "pptx", kind: "scenario", documentType: "pptx", icon: "rocket_launch", estimateMinutes: 3, runs: 9,
    keywords: ["kickoff", "project launch", "启动会", "项目启动"] },
  { id: "product-images", kind: "scenario", documentType: "img", icon: "photo_library", estimateMinutes: 3, runs: 28,
    keywords: ["product images", "product pack", "商品主图", "商品套图", "白底图"] },
  { id: "launch-poster", kind: "scenario", documentType: "img", icon: "campaign", estimateMinutes: 2, runs: 17,
    keywords: ["launch poster", "campaign poster", "活动海报", "新品海报"] },
  { id: "social-cards", kind: "scenario", documentType: "img", icon: "collections", estimateMinutes: 2, runs: 21,
    keywords: ["social cards", "social images", "社交媒体", "社媒配图"] },
  { id: "compete", kind: "scenario", documentType: "docx", icon: "compare_arrows", estimateMinutes: 3, runs: 11,
    keywords: ["competitive", "competitor", "one-pager", "竞品"] },
  { id: "meeting-notes", kind: "scenario", documentType: "docx", icon: "event_note", estimateMinutes: 2, runs: 19,
    keywords: ["meeting notes", "minutes", "会议纪要", "会议记录"] },
  { id: "project-proposal", kind: "scenario", documentType: "docx", icon: "article", estimateMinutes: 4, runs: 13,
    keywords: ["project proposal", "proposal", "项目方案", "方案文档"] },
  { id: "project-schedule", kind: "scenario", documentType: "xlsx", icon: "calendar_month", estimateMinutes: 1, runs: 23,
    keywords: ["project schedule", "timeline sheet", "项目排期", "排期表"] },
  { id: "sales-pipeline", kind: "scenario", documentType: "xlsx", icon: "conversion_path", estimateMinutes: 2, runs: 16,
    keywords: ["sales pipeline", "sales tracker", "销售跟进", "客户跟进"] },
  { id: "budget-plan", kind: "scenario", documentType: "xlsx", icon: "account_balance_wallet", estimateMinutes: 2, runs: 14,
    keywords: ["budget plan", "budget sheet", "预算明细", "费用预算"] },
];

export const creationSolutions = solutions.filter((solution) => solution.kind === "creation");
export const scenarioSolutions = solutions.filter((solution) => solution.kind === "scenario");

/** Returns an explicit keyword match without guessing a fallback output type. */
export function findMatchingSolution(intent: string): Solution | undefined {
  const text = intent.toLowerCase();
  const ordered = [...scenarioSolutions, ...creationSolutions];
  return ordered.find((solution) => solution.keywords.some((keyword) => text.includes(keyword.toLowerCase())));
}

/**
 * Picks the solution a typed intent belongs to. Scenarios win over the generic
 * starts, so "weekly review deck" opens the weekly review rather than a blank
 * deck. Falls back to a deck, which is what most requests turn out to be.
 */
export function matchSolution(intent: string): Solution {
  return findMatchingSolution(intent) ?? creationSolutions[0];
}
