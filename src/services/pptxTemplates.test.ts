import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DesktopAPI, PptxTemplateProgress } from "../shared/types";
import { PPTX_TEMPLATE_CATALOG_KEY } from "../shared/pptxTemplates";
import { createPptxTemplateService } from "./pptxTemplates";

const template = {
  id: "tpl", name: "Company", sourceFileName: "Company.pptx", localAssetDir: "/templates/tpl",
  status: "ready", version: 1, pageCount: 5, warnings: [], assetCounts: {},
};
beforeEach(() => localStorage.clear());

describe("PPT template library", () => {
  it("restores the old catalogue and persists newly imported templates", async () => {
    localStorage.setItem(PPTX_TEMPLATE_CATALOG_KEY, JSON.stringify({ version: 1, templates: [template] }));
    const off = vi.fn();
    const api = {
      openFileDialog: vi.fn().mockResolvedValue("/new.pptx"),
      onPptxTemplateProgress: vi.fn((callback: (event: PptxTemplateProgress) => void) => {
        callback({ stage: "convert", step: 2, steps: 5 } as PptxTemplateProgress);
        return off;
      }),
      importPptxTemplate: vi.fn().mockResolvedValue({ ...template, id: "new" }),
    } as unknown as DesktopAPI;
    const library = createPptxTemplateService(api);
    expect((await library.list())[0].name).toBe("Company");
    const progress = vi.fn();
    await library.import(progress);
    expect(api.importPptxTemplate).toHaveBeenCalledWith({ sourcePath: "/new.pptx" });
    expect(progress).toHaveBeenCalled();
    expect(off).toHaveBeenCalledOnce();
    expect((await createPptxTemplateService(api).list()).map(item => item.id)).toEqual(["new", "tpl"]);
  });
  it("does not record a failed import and always unsubscribes", async () => {
    const off = vi.fn();
    const api = { openFileDialog: async () => "/bad.pptx", onPptxTemplateProgress: () => off,
      importPptxTemplate: async () => { throw new Error("conversion failed"); } } as unknown as DesktopAPI;
    const library = createPptxTemplateService(api);
    await expect(library.import(vi.fn())).rejects.toThrow("conversion failed");
    expect(off).toHaveBeenCalledOnce();
    expect(await library.list()).toEqual([]);
  });
  it("keeps the catalogue when deletion fails", async () => {
    localStorage.setItem(PPTX_TEMPLATE_CATALOG_KEY, JSON.stringify({ templates: [template] }));
    const library = createPptxTemplateService({ deletePptxTemplate: async () => { throw new Error("denied"); } } as unknown as DesktopAPI);
    await expect(library.remove("tpl")).rejects.toThrow("denied");
    expect(await library.list()).toHaveLength(1);
  });
});
