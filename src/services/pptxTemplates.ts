import type { DesktopAPI } from "../shared/types";
import type { PptxTemplatePort } from "../shared/uiPort";
import { readPptxTemplateCatalog, writePptxTemplateCatalog, upsertPptxTemplate, removePptxTemplate } from "../shared/pptxTemplates";
import { translate } from "../renderer/i18n";

/**
 * The desktop's PPT template library. The catalogue keeps its original key so
 * templates imported by the old UI reappear.
 *
 * The desktop learns `.pptx` only; the picker offers what it can learn and the
 * import refuses anything else, so a PPT or PDF is never silently accepted and
 * then lost (`docs/not-implemented.md`).
 */
export function createPptxTemplateService(api: DesktopAPI): PptxTemplatePort {
  return {
    async list() { return readPptxTemplateCatalog().templates; },
    async pick() {
      const path = await api.openFileDialog({ filters: [{ name: "PowerPoint", extensions: ["pptx"] }] });
      if (!path) return null;
      return { path, fileName: path.split(/[\\/]/).pop() ?? path };
    },
    async learn(input, onProgress) {
      if (!api.importPptxTemplate) throw new Error(translate("pptTemplate.unavailable"));
      const unsubscribe = api.onPptxTemplateProgress?.(onProgress);
      try {
        const result = await api.importPptxTemplate({ sourcePath: input.sourcePath, name: input.name });
        const template = { ...result, supportedPageTypes: [] };
        writePptxTemplateCatalog(upsertPptxTemplate(readPptxTemplateCatalog(), template));
        return template;
      } finally { unsubscribe?.(); }
    },
    async rename(id, name) {
      const catalog = readPptxTemplateCatalog();
      // In place: renaming is not a reason to move a template to the top.
      writePptxTemplateCatalog({
        ...catalog,
        templates: catalog.templates.map(item => item.id === id ? { ...item, name, updatedAt: new Date().toISOString() } : item),
      });
    },
    async remove(id) {
      const catalog = readPptxTemplateCatalog();
      const template = catalog.templates.find(item => item.id === id);
      if (!template) return;
      if (!api.deletePptxTemplate) throw new Error(translate("pptTemplate.unavailable"));
      await api.deletePptxTemplate(template.localAssetDir);
      writePptxTemplateCatalog(removePptxTemplate(readPptxTemplateCatalog(), id));
    },
  };
}
