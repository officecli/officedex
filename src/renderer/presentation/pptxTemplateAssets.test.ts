import { describe, expect, it } from "vitest";
import {
  EMPTY_PPTX_TEMPLATE_CATALOG,
  normalizePptxTemplateCatalog,
  nextPptxTemplateVersion,
  removePptxTemplate,
  upsertPptxTemplate,
} from "./pptxTemplateAssets";

const template = {
  id: "tpl-company",
  name: "Company brand",
  sourceFileName: "brand.pptx",
  localAssetDir: "/local/ppt-templates/tpl-company",
  status: "ready" as const,
  version: 2,
  supportedPageTypes: ["cover", "parallel"],
  assetCounts: { logo: 1, icons: 3, images: 2, decorative: 1 },
  warnings: [],
  createdAt: "2026-09-14T00:00:00.000Z",
  updatedAt: "2026-09-14T00:00:00.000Z",
};

describe("pptx template asset catalog", () => {
  it("normalizes malformed persisted records without throwing", () => {
    const catalog = normalizePptxTemplateCatalog({ templates: [template, null, { id: "missing" }] });
    expect(catalog.version).toBe(1);
    expect(catalog.templates).toHaveLength(1);
    expect(catalog.templates[0].status).toBe("ready");
    expect(catalog.templates[0].assetCounts).toEqual(template.assetCounts);
  });

  it("upserts by id and increments the local version", () => {
    const first = upsertPptxTemplate(EMPTY_PPTX_TEMPLATE_CATALOG, template);
    const updated = upsertPptxTemplate(first, { ...template, name: "Updated", version: 3 });
    expect(updated.templates).toHaveLength(1);
    expect(updated.templates[0].name).toBe("Updated");
    expect(nextPptxTemplateVersion(updated, template.id)).toBe(4);
  });

  it("removes only the requested local template", () => {
    const catalog = upsertPptxTemplate(
      upsertPptxTemplate(EMPTY_PPTX_TEMPLATE_CATALOG, template),
      { ...template, id: "tpl-school", name: "School", localAssetDir: "/local/ppt-templates/tpl-school" },
    );
    expect(removePptxTemplate(catalog, "tpl-company").templates.map((item) => item.id)).toEqual(["tpl-school"]);
  });
});

