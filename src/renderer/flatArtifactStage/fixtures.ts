import { createFlatArtifactEditRequest, createFlatArtifactSelection, type FlatArtifactDescriptor } from "./contract";

export const flatArtifactImageFixture: FlatArtifactDescriptor = Object.freeze({
  artifactId: "artifact-image-hero",
  artifactPath: "/fixtures/hero.png",
  kind: "image",
  width: 1600,
  height: 900,
  frameCount: 1,
});

export const flatArtifactGifFixture: FlatArtifactDescriptor = Object.freeze({
  artifactId: "artifact-gif-loop",
  artifactPath: "/fixtures/loop.gif",
  kind: "gif",
  width: 640,
  height: 360,
  frameCount: 12,
});

export const flatArtifactRegionFixture = Object.freeze({ x: 0.125, y: 0.2, width: 0.5, height: 0.4 });

export const flatArtifactDocumentSelectionFixture = createFlatArtifactSelection(flatArtifactImageFixture);
export const flatArtifactGifSelectionFixture = createFlatArtifactSelection(flatArtifactGifFixture, {
  region: flatArtifactRegionFixture,
  frameSelection: { kind: "range", start: 3, end: 7 },
});

export const flatArtifactDocumentEditFixture = createFlatArtifactEditRequest({
  instruction: "Remove the background clutter",
  artifact: flatArtifactImageFixture,
});

export const flatArtifactRegionEditFixture = createFlatArtifactEditRequest({
  instruction: "Brighten the selected subject",
  artifact: flatArtifactGifFixture,
  region: flatArtifactRegionFixture,
  frameSelection: { kind: "range", start: 3, end: 7 },
});
