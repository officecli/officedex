import { describe, expect, it } from "vitest";
import {
  FLAT_ARTIFACT_MIN_REGION_AREA,
  FlatArtifactContractError,
  clampNormalizedRegion,
  createFlatArtifactEditRequest,
  createFlatArtifactSelection,
  normalizedToPixelRegion,
  pixelToNormalizedRegion,
  validateNormalizedRegion,
} from "./contract";
import { flatArtifactGifFixture, flatArtifactImageFixture } from "./fixtures";

function expectContractError(run: () => unknown, code: FlatArtifactContractError["code"]): void {
  expect(run).toThrowError(FlatArtifactContractError);
  try {
    run();
  } catch (error) {
    expect(error).toMatchObject({ code });
  }
}

describe("flat artifact contract", () => {
  it("converts pixels to normalized coordinates and back", () => {
    const normalized = pixelToNormalizedRegion({ x: 160, y: 90, width: 800, height: 450 }, flatArtifactImageFixture);
    expect(normalized).toEqual({ x: 0.1, y: 0.1, width: 0.5, height: 0.5 });
    expect(normalizedToPixelRegion(normalized, flatArtifactImageFixture)).toEqual({ x: 160, y: 90, width: 800, height: 450 });
  });

  it("clamps regions at the canvas boundary", () => {
    expect(clampNormalizedRegion({ x: -0.2, y: 0.25, width: 0.7, height: 1 })).toMatchObject({ x: 0, y: 0.25, height: 0.75 });
    expect(clampNormalizedRegion({ x: -0.2, y: 0.25, width: 0.7, height: 1 }).width).toBeCloseTo(0.5);
  });

  it("rejects a clamped region below the minimum area", () => {
    expectContractError(
      () => validateNormalizedRegion({ x: 0.5, y: 0.5, width: 0.009, height: 0.009 }),
      "region-too-small",
    );
    expect(FLAT_ARTIFACT_MIN_REGION_AREA).toBe(0.0001);
  });

  it("models document and region scopes separately", () => {
    expect(createFlatArtifactSelection(flatArtifactImageFixture).scope).toEqual({ kind: "document" });
    expect(createFlatArtifactSelection(flatArtifactImageFixture, { region: { x: 0, y: 0, width: 0.1, height: 0.1 } }).scope).toEqual({
      kind: "region",
      region: { x: 0, y: 0, width: 0.1, height: 0.1 },
    });
  });

  it("allows a single image frame and a GIF inclusive range", () => {
    expect(createFlatArtifactSelection(flatArtifactImageFixture).frameSelection).toEqual({ kind: "single", index: 0 });
    expect(createFlatArtifactSelection(flatArtifactGifFixture, { frameSelection: { kind: "range", start: 2, end: 5 } }).frameSelection).toEqual({
      kind: "range", start: 2, end: 5,
    });
  });

  it("rejects invalid GIF ranges and ranges on IMG", () => {
    expectContractError(() => createFlatArtifactSelection(flatArtifactGifFixture, { frameSelection: { kind: "range", start: 5, end: 2 } }), "invalid-frame-range");
    expectContractError(() => createFlatArtifactSelection(flatArtifactGifFixture, { frameSelection: { kind: "range", start: 0, end: 12 } }), "invalid-frame-range");
    expectContractError(() => createFlatArtifactSelection(flatArtifactImageFixture, { frameSelection: { kind: "range", start: 0, end: 0 } }), "invalid-frame-range");
  });

  it("creates a deeply immutable identity-only edit request", () => {
    const request = createFlatArtifactEditRequest({
      instruction: "  Remove the object  ",
      artifact: flatArtifactImageFixture,
    });
    expect(request).toEqual({
      action: "redraw",
      instruction: "Remove the object",
      artifact: { artifactId: "artifact-image-hero", artifactPath: "/fixtures/hero.png", kind: "image" },
      scope: { kind: "document" },
      frameSelection: { kind: "single", index: 0 },
    });
    expect(Object.isFrozen(request)).toBe(true);
    expect(Object.isFrozen(request.artifact)).toBe(true);
    expect(JSON.stringify(request)).not.toContain("content");
    expect(JSON.stringify(request)).not.toContain("bytes");
  });

  it("rejects missing identity, dimensions, region, and instruction", () => {
    expectContractError(() => createFlatArtifactEditRequest({ instruction: "x", artifact: { ...flatArtifactImageFixture, artifactPath: "" } }), "invalid-artifact");
    expectContractError(() => createFlatArtifactEditRequest({ instruction: "x", artifact: { ...flatArtifactImageFixture, width: 0 } }), "invalid-dimensions");
    expectContractError(() => createFlatArtifactEditRequest({ instruction: "x", artifact: flatArtifactImageFixture, region: { x: 1.1, y: 0, width: 0.1, height: 0.1 } }), "invalid-region");
    expectContractError(() => createFlatArtifactEditRequest({ instruction: " ", artifact: flatArtifactImageFixture }), "invalid-instruction");
  });
});
