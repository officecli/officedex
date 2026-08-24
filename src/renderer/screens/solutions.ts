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
  // ── recurring jobs
  { id: "weekly", kind: "scenario", documentType: "pptx", icon: "trending_up", estimateMinutes: 2, runs: 24,
    keywords: ["weekly", "week", "周报"] },
  { id: "qbr", kind: "scenario", documentType: "pptx", icon: "insert_chart", estimateMinutes: 5, runs: 6,
    keywords: ["quarterly business", "qbr", "季度经营"] },
  { id: "report", kind: "scenario", documentType: "report", icon: "assessment", estimateMinutes: 4, runs: 18,
    keywords: ["analysis report", "quarterly analysis", "分析报告"] },
  { id: "compete", kind: "scenario", documentType: "docx", icon: "compare_arrows", estimateMinutes: 3, runs: 11,
    keywords: ["competitive", "competitor", "one-pager", "竞品"] },
  { id: "pptx", kind: "scenario", documentType: "pptx", icon: "rocket_launch", estimateMinutes: 3, runs: 9,
    keywords: ["kickoff", "启动"] },
  { id: "xlsx", kind: "scenario", documentType: "xlsx", icon: "grid_on", estimateMinutes: 1, runs: 7,
    keywords: ["comparison table", "对比表"] },
];

export const creationSolutions = solutions.filter((solution) => solution.kind === "creation");
export const scenarioSolutions = solutions.filter((solution) => solution.kind === "scenario");

/**
 * Picks the solution a typed intent belongs to. Scenarios win over the generic
 * starts, so "weekly review deck" opens the weekly review rather than a blank
 * deck. Falls back to a deck, which is what most requests turn out to be.
 */
export function matchSolution(intent: string): Solution {
  const text = intent.toLowerCase();
  const ordered = [...scenarioSolutions, ...creationSolutions];
  return (
    ordered.find((solution) => solution.keywords.some((keyword) => text.includes(keyword.toLowerCase()))) ??
    creationSolutions[0]
  );
}
