export type ArtifactStageCostClass = "metered" | "heavy";

export interface ArtifactStageTarget {
  readonly artifactId: string;
  /** Resolver reference only. File bytes never cross this contract. */
  readonly artifactPath: string;
  readonly documentType: "pptx" | "docx" | "xlsx" | "img" | "gif";
}

export type ArtifactStageEditScope =
  | { readonly kind: "document" }
  | { readonly kind: "slide"; readonly slideNumber: number }
  | { readonly kind: "tail"; readonly fromSlide: number }
  | { readonly kind: "block"; readonly blockId: string; readonly blockKind: string; readonly path: readonly number[]; readonly textSha256: string; readonly paragraphHint: number }
  | { readonly kind: "range"; readonly sheetId: string; readonly sheetName?: string; readonly a1: string }
  | {
      readonly kind: "region";
      readonly x: number;
      readonly y: number;
      readonly width: number;
      readonly height: number;
      readonly frames?:
        | { readonly kind: "single"; readonly index: number; readonly frameCount: number }
        | { readonly kind: "range"; readonly start: number; readonly end: number; readonly frameCount: number };
    };

export interface ArtifactStageEditIntent {
  readonly version: 1;
  readonly action: "rewrite" | "redraw";
  readonly instruction: string;
  readonly target: ArtifactStageTarget;
  readonly scope: ArtifactStageEditScope;
  /** UI classification only. The trusted backend remains authoritative for Credits. */
  readonly costClass: ArtifactStageCostClass;
}

export class ArtifactStageProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ArtifactStageProtocolError";
  }
}

export function costClassForArtifactScope(
  scope: ArtifactStageEditScope,
): ArtifactStageCostClass {
  return scope.kind === "document" || scope.kind === "tail"
    ? "heavy"
    : "metered";
}

export function createArtifactStageEditIntent(input: Omit<ArtifactStageEditIntent, "version" | "costClass">): ArtifactStageEditIntent {
  const artifactId = input.target.artifactId.trim();
  const artifactPath = input.target.artifactPath.trim();
  const instruction = input.instruction.trim();
  if (!artifactId || !artifactPath) {
    throw new ArtifactStageProtocolError("Artifact identity and path reference are required.");
  }
  if (!instruction) {
    throw new ArtifactStageProtocolError("An edit instruction is required.");
  }
  validateArtifactScope(input.target.documentType, input.scope);
  return deepFreeze({
    version: 1,
    action: input.action,
    instruction,
    target: { ...input.target, artifactId, artifactPath },
    scope: cloneScope(input.scope),
    costClass: costClassForArtifactScope(input.scope),
  });
}

function validateArtifactScope(
  documentType: ArtifactStageTarget["documentType"],
  scope: ArtifactStageEditScope,
): void {
  if (scope.kind === "document") return;
  if (scope.kind === "slide" || scope.kind === "tail") {
    const slide = scope.kind === "slide" ? scope.slideNumber : scope.fromSlide;
    if (documentType !== "pptx" || !Number.isInteger(slide) || slide < 1) {
      throw new ArtifactStageProtocolError("Slide and tail scopes require a positive PPTX slide number.");
    }
    return;
  }
  if (scope.kind === "block") {
    if (documentType !== "docx" || !scope.blockId.trim() || !scope.blockKind.trim() || scope.path.length === 0 || !/^[a-f0-9]{64}$/i.test(scope.textSha256) || scope.paragraphHint < 1) {
      throw new ArtifactStageProtocolError("Block scope requires a DOCX block id.");
    }
    return;
  }
  if (scope.kind === "range") {
    if (documentType !== "xlsx" || !scope.sheetId.trim() || !/^[A-Z]+[1-9]\d*(?::[A-Z]+[1-9]\d*)?$/.test(scope.a1)) {
      throw new ArtifactStageProtocolError("Range scope requires one bounded XLSX A1 rectangle.");
    }
    return;
  }
  if (documentType !== "img" && documentType !== "gif") {
    throw new ArtifactStageProtocolError("Region scope is only available for image and GIF artifacts.");
  }
  if (![scope.x, scope.y, scope.width, scope.height].every(Number.isFinite)
    || scope.x < 0 || scope.y < 0 || scope.width <= 0 || scope.height <= 0
    || scope.x + scope.width > 1 || scope.y + scope.height > 1) {
    throw new ArtifactStageProtocolError("Region scope must be a positive normalized rectangle.");
  }
  if (scope.frames?.kind === "single") {
    if (!Number.isInteger(scope.frames.index) || scope.frames.index < 0) {
      throw new ArtifactStageProtocolError("Frame index must be a non-negative integer.");
    }
  } else if (scope.frames) {
    if (!Number.isInteger(scope.frames.start) || !Number.isInteger(scope.frames.end)
      || scope.frames.start < 0 || scope.frames.end < scope.frames.start) {
      throw new ArtifactStageProtocolError("Frame range must be an ordered inclusive range.");
    }
  }
  if (documentType === "img" && scope.frames && (scope.frames.kind !== "single" || scope.frames.index !== 0)) {
    throw new ArtifactStageProtocolError("A still image may only address frame zero.");
  }
}

function cloneScope(scope: ArtifactStageEditScope): ArtifactStageEditScope {
  if (scope.kind !== "region") return { ...scope };
  return { ...scope, ...(scope.frames ? { frames: { ...scope.frames } } : {}) };
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  return value;
}
