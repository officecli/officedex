import {
  createArtifactStageEditIntent,
  type ArtifactStageEditIntent,
} from "../../shared/artifactStageProtocol";
import type { DocxSelection } from "./docxBlockAddressing";

export function createDocxArtifactStageIntent(input: {
  readonly artifactId: string;
  readonly artifactPath: string;
  readonly selection?: DocxSelection | null;
  readonly block?: { readonly id: string; readonly kind: string; readonly path: readonly number[]; readonly textSha256: string; readonly paragraphHint: number };
  readonly instruction: string;
}): ArtifactStageEditIntent {
  return createArtifactStageEditIntent({
    action: "rewrite",
    instruction: input.instruction,
    target: {
      artifactId: input.artifactId,
      artifactPath: input.artifactPath,
      documentType: "docx",
    },
    scope: input.selection?.blockId && input.block
      ? { kind: "block", blockId: input.block.id, blockKind: input.block.kind, path: input.block.path, textSha256: input.block.textSha256, paragraphHint: input.block.paragraphHint }
      : { kind: "document" },
  });
}
