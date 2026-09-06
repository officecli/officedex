import { describe, expect, it } from "vitest";
import { imageAssetFromTemplate } from "./imageAssetLineage";

describe("image asset lineage", () => {
  it("retains template identity and optional workbook context", () => {
    const asset = imageAssetFromTemplate({ projectId: "p", template: { id: 4, slug: "cover", title: "Cover", description: "", promptPreset: "cover", sortOrder: 1, enabled: true }, workbookId: "book", viewIds: ["view"] });
    expect(asset).toMatchObject({ type: "image", mode: "template", templateId: "4", lineage: { workbookId: "book", viewIds: ["view"] } });
  });
});
