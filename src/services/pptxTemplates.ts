import type { DesktopAPI } from "../shared/types";
import type { PptxTemplatePort } from "../shared/uiPort";
import { readPptxTemplateCatalog, writePptxTemplateCatalog, upsertPptxTemplate, removePptxTemplate } from "../shared/pptxTemplates";
import { translate } from "../renderer/i18n";

/** Keep the original catalogue key so templates imported by the old UI reappear. */
export function createPptxTemplateService(api: DesktopAPI): PptxTemplatePort {
  return {
    async list() { return readPptxTemplateCatalog().templates; },
    async import(onProgress) {
      if (!api.importPptxTemplate) throw new Error(translate("pptTemplate.unavailable"));
      const sourcePath = await api.openFileDialog({ filters: [{ name: "PowerPoint", extensions: ["pptx"] }] });
      if (!sourcePath) return null;
      const unsubscribe = api.onPptxTemplateProgress?.(onProgress);
      try {
        const result = await api.importPptxTemplate({ sourcePath });
        const template = { ...result, supportedPageTypes: [] };
        writePptxTemplateCatalog(upsertPptxTemplate(readPptxTemplateCatalog(), template));
        return template;
      } finally { unsubscribe?.(); }
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
