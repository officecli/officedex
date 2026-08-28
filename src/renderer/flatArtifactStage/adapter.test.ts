import { describe, expect, it } from "vitest";
import { createFlatArtifactStageIntent, flatArtifactStageAdapter, getFlatArtifactIntentCost } from "./adapter";
import { createFlatArtifactSelection } from "./contract";
import { flatArtifactGifFixture, flatArtifactImageFixture, flatArtifactRegionFixture } from "./fixtures";

describe("flat artifact stage adapter", () => {
  it("defaults an unselected artifact to a document-heavy action", () => {
    const selection = createFlatArtifactSelection(flatArtifactImageFixture);
    const scopes = flatArtifactStageAdapter.getScopes(selection);
    expect(scopes).toHaveLength(1);
    expect(scopes[0]).toMatchObject({ id: "document", cost: "heavy" });
    expect(flatArtifactStageAdapter.getCost(scopes[0])).toBe("heavy");
    expect(getFlatArtifactIntentCost("document")).toBe("heavy");
  });

  it("offers a metered region action when a region is selected", () => {
    const selection = createFlatArtifactSelection(flatArtifactGifFixture, { region: flatArtifactRegionFixture });
    const scopes = flatArtifactStageAdapter.getScopes(selection);
    expect(scopes.map((scope) => scope.id)).toEqual(["document", "region"]);
    expect(flatArtifactStageAdapter.getCost(scopes[1])).toBe("metered");
    expect(getFlatArtifactIntentCost("region")).toBe("metered");
  });

  it("keeps adapter requests deterministic and free of execution side effects", () => {
    const request = flatArtifactStageAdapter.createEditRequest({
      instruction: "Repair the selected area",
      artifact: flatArtifactGifFixture,
      region: flatArtifactRegionFixture,
      frameSelection: { kind: "range", start: 3, end: 7 },
    });
    expect(request.action).toBe("redraw");
    expect(request.artifact.artifactPath).toBe("/fixtures/loop.gif");
    expect(request.scope.kind).toBe("region");
    expect(request.frameSelection).toEqual({ kind: "range", start: 3, end: 7 });
  });

  it("maps region and GIF frames into the shared stage protocol", () => {
    const selection = createFlatArtifactSelection(flatArtifactGifFixture, {
      region: flatArtifactRegionFixture,
      frameSelection: { kind: "range", start: 3, end: 7 },
    });
    expect(createFlatArtifactStageIntent({
      selection,
      instruction: "Brighten the subject",
    })).toEqual(expect.objectContaining({
      version: 1,
      costClass: "metered",
      target: expect.objectContaining({ documentType: "gif" }),
      scope: expect.objectContaining({
        kind: "region",
        frames: { kind: "range", start: 3, end: 7, frameCount: 12 },
      }),
    }));
  });
});
