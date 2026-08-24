import type { DocumentType } from "../../shared/types";

/**
 * The scenario catalog shown on the new-chat home screen. Picking one is the
 * entry point into its workflow: it preselects the document type and prefills
 * the topic and prompt, so the user confirms rather than composes from scratch.
 *
 * Titles and descriptions live in i18n under `dialogue.preset.<id>.*`.
 */
export interface Solution {
  readonly id: string;
  readonly documentType: DocumentType;
  readonly icon: string;
  readonly estimateMinutes: number;
}

export const solutions: readonly Solution[] = [
  { id: "weekly", documentType: "pptx", icon: "trending_up", estimateMinutes: 2 },
  { id: "qbr", documentType: "pptx", icon: "insert_chart", estimateMinutes: 5 },
  { id: "report", documentType: "report", icon: "analytics", estimateMinutes: 4 },
  { id: "compete", documentType: "docx", icon: "compare_arrows", estimateMinutes: 3 },
  { id: "pptx", documentType: "pptx", icon: "present_to_all", estimateMinutes: 3 },
  { id: "xlsx", documentType: "xlsx", icon: "table_chart", estimateMinutes: 1 },
];
