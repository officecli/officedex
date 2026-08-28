import type { ArtifactStageEditIntent } from "../../shared/artifactStageProtocol";

export type ArtifactStageExecutionRoute = "artifact_stage_edit.v1";

export class ArtifactStageExecutionUnsupportedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ArtifactStageExecutionUnsupportedError";
  }
}

/**
 * Current released OfficeCLI accepts only whole-file office.modify requests.
 * Addressed edits must fail before transport until the runtime advertises a
 * native block/range/region contract; encoding selection into prompt text
 * would be ambiguous and could charge Credits for the wrong scope.
 */
export function resolveArtifactStageExecutionRoute(
  intent: ArtifactStageEditIntent,
): ArtifactStageExecutionRoute {
  return "artifact_stage_edit.v1";
}
