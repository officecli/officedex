/**
 * Local-only catalog for PPT template assets.
 *
 * The catalog deliberately stores metadata only. Large files (source PPTX,
 * MOP packages and extracted media) belong in the desktop-managed asset
 * directory and are referenced by `localAssetDir`.
 */

export const PPTX_TEMPLATE_CATALOG_KEY = "officedex:pptx-template-assets:v1";

export type PptxTemplateStatus =
  | "uploaded"
  | "imported"
  | "assets_extracted"
  | "analyzing"
  | "ready"
  | "failed";

export interface PptxTemplateAssetSummary {
  id: string;
  name: string;
  sourceFileName: string;
  sourceSha256?: string;
  localAssetDir: string;
  status: PptxTemplateStatus;
  version: number;
  previewPath?: string;
  pageCount?: number;
  supportedPageTypes: string[];
  assetCounts: {
    logo: number;
    icons: number;
    images: number;
    decorative: number;
  };
  warnings: string[];
  createdAt: string;
  updatedAt: string;
}

export interface PptxTemplateCatalog {
  version: 1;
  templates: PptxTemplateAssetSummary[];
}

export const EMPTY_PPTX_TEMPLATE_CATALOG: PptxTemplateCatalog = {
  version: 1,
  templates: [],
};

const VALID_STATUSES = new Set<PptxTemplateStatus>([
  "uploaded",
  "imported",
  "assets_extracted",
  "analyzing",
  "ready",
  "failed",
]);

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function asNonNegativeInteger(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : 0;
}

function normalizeTemplate(raw: unknown): PptxTemplateAssetSummary | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const value = raw as Record<string, unknown>;
  const id = asString(value.id);
  const name = asString(value.name);
  const sourceFileName = asString(value.sourceFileName);
  const localAssetDir = asString(value.localAssetDir);
  if (!id || !name || !sourceFileName || !localAssetDir) return undefined;

  const counts = value.assetCounts && typeof value.assetCounts === "object"
    ? value.assetCounts as Record<string, unknown>
    : {};
  const status = VALID_STATUSES.has(value.status as PptxTemplateStatus)
    ? value.status as PptxTemplateStatus
    : "failed";
  const now = new Date().toISOString();
  return {
    id,
    name,
    sourceFileName,
    sourceSha256: asString(value.sourceSha256),
    localAssetDir,
    status,
    version: asNonNegativeInteger(value.version) || 1,
    previewPath: asString(value.previewPath),
    pageCount: asNonNegativeInteger(value.pageCount) || undefined,
    supportedPageTypes: Array.isArray(value.supportedPageTypes)
      ? value.supportedPageTypes.filter((item): item is string => typeof item === "string")
      : [],
    assetCounts: {
      logo: asNonNegativeInteger(counts.logo),
      icons: asNonNegativeInteger(counts.icons),
      images: asNonNegativeInteger(counts.images),
      decorative: asNonNegativeInteger(counts.decorative),
    },
    warnings: Array.isArray(value.warnings)
      ? value.warnings.filter((item): item is string => typeof item === "string")
      : [],
    createdAt: asString(value.createdAt) ?? now,
    updatedAt: asString(value.updatedAt) ?? now,
  };
}

export function normalizePptxTemplateCatalog(raw: unknown): PptxTemplateCatalog {
  if (!raw || typeof raw !== "object") return { ...EMPTY_PPTX_TEMPLATE_CATALOG };
  const value = raw as Record<string, unknown>;
  const templates = Array.isArray(value.templates)
    ? value.templates.map(normalizeTemplate).filter((item): item is PptxTemplateAssetSummary => Boolean(item))
    : [];
  return { version: 1, templates };
}

export function readPptxTemplateCatalog(storage: Pick<Storage, "getItem"> = localStorage): PptxTemplateCatalog {
  try {
    const raw = storage.getItem(PPTX_TEMPLATE_CATALOG_KEY);
    return raw ? normalizePptxTemplateCatalog(JSON.parse(raw)) : { ...EMPTY_PPTX_TEMPLATE_CATALOG };
  } catch {
    return { ...EMPTY_PPTX_TEMPLATE_CATALOG };
  }
}

export function writePptxTemplateCatalog(
  catalog: PptxTemplateCatalog,
  storage: Pick<Storage, "setItem"> = localStorage,
): void {
  storage.setItem(PPTX_TEMPLATE_CATALOG_KEY, JSON.stringify(normalizePptxTemplateCatalog(catalog)));
}

export function upsertPptxTemplate(
  catalog: PptxTemplateCatalog,
  template: PptxTemplateAssetSummary,
): PptxTemplateCatalog {
  const templates = catalog.templates.filter((item) => item.id !== template.id);
  return { version: 1, templates: [template, ...templates] };
}

export function removePptxTemplate(catalog: PptxTemplateCatalog, templateId: string): PptxTemplateCatalog {
  return { version: 1, templates: catalog.templates.filter((item) => item.id !== templateId) };
}

export function nextPptxTemplateVersion(
  catalog: PptxTemplateCatalog,
  templateId: string,
): number {
  const current = catalog.templates.find((item) => item.id === templateId);
  return (current?.version ?? 0) + 1;
}


export function renamePptxTemplate(catalog: PptxTemplateCatalog, templateId: string, name: string): PptxTemplateCatalog {
  const nextName = name.trim();
  if (!nextName) return catalog;
  return { version: 1, templates: catalog.templates.map((item) => item.id === templateId ? { ...item, name: nextName, updatedAt: new Date().toISOString() } : item) };
}

export function updatePptxTemplateStatus(catalog: PptxTemplateCatalog, templateId: string, status: PptxTemplateStatus, warnings?: string[]): PptxTemplateCatalog {
  return { version: 1, templates: catalog.templates.map((item) => item.id === templateId ? { ...item, status, warnings: warnings ?? item.warnings, updatedAt: new Date().toISOString() } : item) };
}
