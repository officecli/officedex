/**
 * Domain contract for the first flat-artifact (IMG/GIF) editing slice.
 *
 * This module intentionally carries references only. It never accepts or
 * produces local file bytes, blobs, model prompts, or credit mutations.
 */

export const FLAT_ARTIFACT_MIN_REGION_AREA = 0.0001;

export type FlatArtifactKind = "image" | "gif";

export interface FlatArtifactIdentity {
  readonly artifactId: string;
  /** A local path or other resolver reference; never file contents. */
  readonly artifactPath: string;
  readonly kind: FlatArtifactKind;
}

export interface FlatArtifactDescriptor extends FlatArtifactIdentity {
  readonly width: number;
  readonly height: number;
  readonly frameCount: number;
}

export interface NormalizedRegion {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface PixelRegion {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface FlatArtifactDocumentScope {
  readonly kind: "document";
}

export interface FlatArtifactRegionScope {
  readonly kind: "region";
  readonly region: NormalizedRegion;
}

export type FlatArtifactScope = FlatArtifactDocumentScope | FlatArtifactRegionScope;

export interface SingleFrameSelection {
  readonly kind: "single";
  readonly index: number;
}

export interface FrameRangeSelection {
  readonly kind: "range";
  /** Inclusive frame indexes. */
  readonly start: number;
  /** Inclusive frame indexes. */
  readonly end: number;
}

export type FlatArtifactFrameSelection = SingleFrameSelection | FrameRangeSelection;

export interface FlatArtifactSelection {
  readonly artifact: FlatArtifactDescriptor;
  readonly scope: FlatArtifactScope;
  readonly frameSelection: FlatArtifactFrameSelection;
}

export interface FlatArtifactEditRequest {
  readonly action: "redraw";
  readonly instruction: string;
  readonly artifact: FlatArtifactIdentity;
  readonly scope: FlatArtifactScope;
  readonly frameSelection: FlatArtifactFrameSelection;
}

export interface FlatArtifactEditInput {
  readonly instruction: string;
  readonly artifact: FlatArtifactDescriptor;
  readonly region?: NormalizedRegion | null;
  readonly frameSelection?: FlatArtifactFrameSelection;
}

export class FlatArtifactContractError extends Error {
  readonly code:
    | "invalid-artifact"
    | "invalid-dimensions"
    | "invalid-region"
    | "region-too-small"
    | "invalid-frame-range"
    | "invalid-instruction";

  constructor(code: FlatArtifactContractError["code"], message: string) {
    super(message);
    this.name = "FlatArtifactContractError";
    this.code = code;
  }
}

function isFiniteNumber(value: number): boolean {
  return Number.isFinite(value);
}

function assertDimensions(descriptor: Pick<FlatArtifactDescriptor, "width" | "height">): void {
  if (!isFiniteNumber(descriptor.width) || !isFiniteNumber(descriptor.height) || descriptor.width <= 0 || descriptor.height <= 0) {
    throw new FlatArtifactContractError("invalid-dimensions", "Artifact dimensions must be finite positive numbers.");
  }
}

function assertArtifact(descriptor: FlatArtifactDescriptor): void {
  if (!descriptor || typeof descriptor.artifactId !== "string" || !descriptor.artifactId.trim()
    || typeof descriptor.artifactPath !== "string" || !descriptor.artifactPath.trim()
    || (descriptor.kind !== "image" && descriptor.kind !== "gif")) {
    throw new FlatArtifactContractError("invalid-artifact", "An artifact id, path reference, and image kind are required.");
  }
  assertDimensions(descriptor);
  if (!Number.isInteger(descriptor.frameCount) || descriptor.frameCount < 1) {
    throw new FlatArtifactContractError("invalid-frame-range", "Artifact frameCount must be a positive integer.");
  }
  if (descriptor.kind === "image" && descriptor.frameCount !== 1) {
    throw new FlatArtifactContractError("invalid-frame-range", "A single image must declare exactly one frame.");
  }
}

function assertRegionShape(region: NormalizedRegion): void {
  if (!region || ![region.x, region.y, region.width, region.height].every(isFiniteNumber)
    || region.width <= 0 || region.height <= 0) {
    throw new FlatArtifactContractError("invalid-region", "Region coordinates and size must be finite, with positive size.");
  }
}

/** Clamp a positive region to the normalized [0, 1] x [0, 1] canvas. */
export function clampNormalizedRegion(region: NormalizedRegion): NormalizedRegion {
  assertRegionShape(region);
  const left = Math.max(0, Math.min(1, region.x));
  const top = Math.max(0, Math.min(1, region.y));
  const right = Math.max(0, Math.min(1, region.x + region.width));
  const bottom = Math.max(0, Math.min(1, region.y + region.height));
  const clamped = { x: left, y: top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
  if (clamped.width <= 0 || clamped.height <= 0) {
    throw new FlatArtifactContractError("invalid-region", "Region must intersect the artifact canvas.");
  }
  return clamped;
}

export function validateNormalizedRegion(region: NormalizedRegion, minimumArea = FLAT_ARTIFACT_MIN_REGION_AREA): NormalizedRegion {
  const clamped = clampNormalizedRegion(region);
  if (!isFiniteNumber(minimumArea) || minimumArea <= 0 || clamped.width * clamped.height < minimumArea) {
    throw new FlatArtifactContractError("region-too-small", "Region is smaller than the minimum editable area.");
  }
  return clamped;
}

export function pixelToNormalizedRegion(region: PixelRegion, dimensions: Pick<FlatArtifactDescriptor, "width" | "height">): NormalizedRegion {
  assertDimensions(dimensions);
  if (!region || ![region.x, region.y, region.width, region.height].every(isFiniteNumber)) {
    throw new FlatArtifactContractError("invalid-region", "Pixel region coordinates must be finite numbers.");
  }
  return clampNormalizedRegion({
    x: region.x / dimensions.width,
    y: region.y / dimensions.height,
    width: region.width / dimensions.width,
    height: region.height / dimensions.height,
  });
}

export function normalizedToPixelRegion(region: NormalizedRegion, dimensions: Pick<FlatArtifactDescriptor, "width" | "height">): PixelRegion {
  assertDimensions(dimensions);
  const normalized = clampNormalizedRegion(region);
  return {
    x: normalized.x * dimensions.width,
    y: normalized.y * dimensions.height,
    width: normalized.width * dimensions.width,
    height: normalized.height * dimensions.height,
  };
}

function resolveFrameSelection(descriptor: FlatArtifactDescriptor, selection?: FlatArtifactFrameSelection): FlatArtifactFrameSelection {
  const resolved = selection ?? { kind: "single", index: 0 };
  if (resolved.kind === "single") {
    if (!Number.isInteger(resolved.index) || resolved.index < 0 || resolved.index >= descriptor.frameCount) {
      throw new FlatArtifactContractError("invalid-frame-range", "Single frame index is outside the artifact frame range.");
    }
    return { kind: "single", index: resolved.index };
  }
  if (descriptor.kind !== "gif" || !Number.isInteger(resolved.start) || !Number.isInteger(resolved.end)
    || resolved.start < 0 || resolved.end < resolved.start || resolved.end >= descriptor.frameCount) {
    throw new FlatArtifactContractError("invalid-frame-range", "Only GIFs may use a valid inclusive frame range.");
  }
  return { kind: "range", start: resolved.start, end: resolved.end };
}

function freezeDeep<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value as Record<string, unknown>)) freezeDeep(child);
  return value;
}

/** Build a validated, immutable selection suitable for a future stage adapter. */
export function createFlatArtifactSelection(
  artifact: FlatArtifactDescriptor,
  options: { readonly region?: NormalizedRegion | null; readonly frameSelection?: FlatArtifactFrameSelection } = {},
): FlatArtifactSelection {
  assertArtifact(artifact);
  const scope: FlatArtifactScope = options.region == null
    ? { kind: "document" }
    : { kind: "region", region: validateNormalizedRegion(options.region) };
  return freezeDeep({
    artifact: { ...artifact },
    scope,
    frameSelection: resolveFrameSelection(artifact, options.frameSelection),
  });
}

/** Build an immutable edit request containing only artifact identity/path references. */
export function createFlatArtifactEditRequest(input: FlatArtifactEditInput): FlatArtifactEditRequest {
  assertArtifact(input.artifact);
  if (typeof input.instruction !== "string" || !input.instruction.trim()) {
    throw new FlatArtifactContractError("invalid-instruction", "An edit instruction is required.");
  }
  const selection = createFlatArtifactSelection(input.artifact, input);
  return freezeDeep({
    action: "redraw",
    instruction: input.instruction.trim(),
    artifact: {
      artifactId: input.artifact.artifactId,
      artifactPath: input.artifact.artifactPath,
      kind: input.artifact.kind,
    },
    scope: selection.scope,
    frameSelection: selection.frameSelection,
  });
}
