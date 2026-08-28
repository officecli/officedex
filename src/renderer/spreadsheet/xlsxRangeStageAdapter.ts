import {
  createXlsxLocalEditRequest,
  type XlsxActionReference,
  type XlsxGridBounds,
  type XlsxLocalEditRequest,
  type XlsxSelection,
  type XlsxSelectionInput,
  type XlsxSheetIdentity,
  type XlsxWorkbookIdentity,
} from "./xlsxRangeAddressing";
import {
  createArtifactStageEditIntent,
  type ArtifactStageEditIntent,
} from "../../shared/artifactStageProtocol";

export type XlsxActionId = "inspect" | "rewrite";
export type XlsxActionCost = "free" | "metered" | "heavy";

export interface XlsxStageActionOption {
  readonly id: XlsxActionId;
  readonly label: "Inspect selection" | "Rewrite selection";
  readonly cost: XlsxActionCost;
  readonly freeOperation?: "read-only-preview";
}

export interface XlsxRangeStageAdapter {
  readonly capabilityTier: "T2";
  readonly getActions: (selection: XlsxSelection) => readonly XlsxStageActionOption[];
  readonly getCost: (selection: XlsxSelection, action: XlsxActionId) => XlsxActionCost;
  readonly createEditRequest: (input: {
    readonly workbook: XlsxWorkbookIdentity;
    readonly sheet: XlsxSheetIdentity;
    readonly selection?: XlsxSelectionInput | null;
    readonly bounds?: XlsxGridBounds;
    readonly instruction: string;
    readonly actionReference?: XlsxActionReference;
  }) => XlsxLocalEditRequest;
}

export function getXlsxActionCost(scope: XlsxSelection["scope"], action: XlsxActionId): XlsxActionCost {
  if (action === "inspect") return "free";
  return scope === "range" ? "metered" : "heavy";
}

export const xlsxRangeStageAdapter: XlsxRangeStageAdapter = {
  capabilityTier: "T2",
  getActions: (selection) => [
    { id: "inspect", label: "Inspect selection", cost: "free", freeOperation: "read-only-preview" },
    { id: "rewrite", label: "Rewrite selection", cost: getXlsxActionCost(selection.scope, "rewrite") },
  ],
  getCost: (selection, action) => getXlsxActionCost(selection.scope, action),
  createEditRequest: createXlsxLocalEditRequest,
};

export function createXlsxArtifactStageIntent(input: {
  readonly artifactPath: string;
  readonly selection: XlsxSelection;
  readonly instruction: string;
}): ArtifactStageEditIntent {
  return createArtifactStageEditIntent({
    action: "rewrite",
    instruction: input.instruction,
    target: {
      artifactId: input.selection.workbook.workbookId,
      artifactPath: input.artifactPath,
      documentType: "xlsx",
    },
    scope: input.selection.scope === "range"
      ? { kind: "range", sheetId: input.selection.sheet.sheetId, sheetName: input.selection.sheet.sheetName, a1: input.selection.range.a1 }
      : { kind: "document" },
  });
}
