import {
  createFlatArtifactEditRequest,
  type FlatArtifactEditInput,
  type FlatArtifactEditRequest,
  type FlatArtifactSelection,
  type FlatArtifactScope,
  type NormalizedRegion,
} from "./contract";
import {
  createArtifactStageEditIntent,
  type ArtifactStageEditIntent,
} from "../../shared/artifactStageProtocol";

export type FlatArtifactIntentCost = "metered" | "heavy";

export interface FlatArtifactScopeOption {
  readonly id: "document" | "region";
  readonly label: "Whole document" | "Selected region";
  readonly cost: FlatArtifactIntentCost;
  readonly scope: FlatArtifactScope;
}

/** Pure adapter surface for the generic ArtifactStageShell. */
export interface FlatArtifactStageAdapter {
  readonly capabilityTier: "T1";
  readonly getScopes: (selection: FlatArtifactSelection) => readonly FlatArtifactScopeOption[];
  readonly getCost: (scope: FlatArtifactScopeOption) => FlatArtifactIntentCost;
  readonly createEditRequest: (input: FlatArtifactEditInput) => FlatArtifactEditRequest;
}

export const flatArtifactStageAdapter: FlatArtifactStageAdapter = {
  capabilityTier: "T1",
  getScopes: (selection) => {
    const document: FlatArtifactScopeOption = { id: "document", label: "Whole document", cost: "heavy", scope: { kind: "document" } };
    if (selection.scope.kind !== "region") return [document];
    return [
      document,
      { id: "region", label: "Selected region", cost: "metered", scope: selection.scope },
    ];
  },
  getCost: (scope) => scope.cost,
  createEditRequest: createFlatArtifactEditRequest,
};

export function getFlatArtifactIntentCost(scope: "document" | "region"): FlatArtifactIntentCost {
  return scope === "region" ? "metered" : "heavy";
}

export function scopeForRegion(region: NormalizedRegion): FlatArtifactScope {
  return { kind: "region", region };
}

export function createFlatArtifactStageIntent(input: {
  readonly selection: FlatArtifactSelection;
  readonly instruction: string;
}): ArtifactStageEditIntent {
  const { artifact, scope, frameSelection } = input.selection;
  return createArtifactStageEditIntent({
    action: "redraw",
    instruction: input.instruction,
    target: {
      artifactId: artifact.artifactId,
      artifactPath: artifact.artifactPath,
      documentType: artifact.kind === "image" ? "img" : "gif",
    },
    scope: scope.kind === "region"
      ? { kind: "region", ...scope.region, frames: { ...frameSelection, frameCount: artifact.frameCount } }
      : { kind: "document" },
  });
}
