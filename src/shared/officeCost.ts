import type { OfficeProductType } from "./officeProduct";

export type OfficeOperation = "generate" | "modify" | "refresh" | "image";

export interface OfficeCostInput {
  operation: OfficeOperation;
  outputType: OfficeProductType;
  pages?: number;
  rows?: number;
  images?: number;
}

export interface OfficeCostEstimate {
  credits: number;
  unit: string;
  refundableOnFailure: boolean;
}

export function estimateOfficeCost(input: OfficeCostInput): OfficeCostEstimate {
  const pages = Math.max(1, input.pages ?? 1);
  const rows = Math.max(1, input.rows ?? 1);
  const images = Math.max(0, input.images ?? 0);
  let credits = input.operation === "image" ? 4 : input.operation === "modify" ? 2 : input.operation === "refresh" ? 2 : 3;
  if (input.outputType === "presentation") credits += Math.ceil(pages / 10);
  if (input.outputType === "document") credits += Math.ceil(pages / 20);
  if (input.outputType === "spreadsheet" || input.outputType === "html-app") credits += Math.ceil(rows / 500);
  credits += images;
  return { credits, unit: "Credit", refundableOnFailure: true };
}
