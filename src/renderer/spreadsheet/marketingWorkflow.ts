import type {
  ImageRatio,
  SpreadsheetFieldRole,
  SpreadsheetPlannedColumn,
} from "../../shared/types";

export type MarketingAssetKind =
  "marketplace-main" | "lifestyle" | "social-poster";

export type CampaignChannel =
  "shopify.product-media" | "shopify.collection-image" | "shopify.theme-banner";

export interface MarketingCampaignSettings {
  name: string;
  market: string;
  language: string;
  offer: string;
  cta: string;
  channels: CampaignChannel[];
}

export interface MarketingSheetRow {
  rowIndex: number;
  productName: string;
  prompt: string;
  referenceImages: string[];
  ratio?: ImageRatio;
  campaignChannel?: CampaignChannel;
}

export interface MarketingBatchDraft {
  sheetId: string;
  sheetName: string;
  rows: MarketingSheetRow[];
  outputColumn: number;
  statusColumn: number;
  headerRowIndex: number;
  outputTitle: string;
  assetKind: MarketingAssetKind;
  mapping: MarketingFieldMapping;
  source: MarketingSelectionSource;
}

export interface MarketingSelectionSource {
  headers: string[];
  rows: string[][];
  firstRowIndex: number;
  existingColumnCount: number;
}

export interface MarketingColumnMapping extends SpreadsheetPlannedColumn {
  header: string;
  status: "suggested" | "confirmed";
}

export interface MarketingFieldMapping {
  sheetId: string;
  sheetName: string;
  headerRowIndex: number;
  schemaFingerprint: string;
  source: "rules" | "ai" | "saved";
  confirmed: boolean;
  summary: string;
  confidence: "high" | "medium" | "low";
  warnings: string[];
  columns: MarketingColumnMapping[];
}

export interface MarketingSelectionInput {
  sheetId: string;
  sheetName: string;
  headers: string[];
  rows: string[][];
  firstRowIndex: number;
  existingColumnCount: number;
  headerRowIndex: number;
  assetKind: MarketingAssetKind;
  plannedColumns?: SpreadsheetPlannedColumn[];
  mappingSource?: MarketingFieldMapping["source"];
  mappingConfirmed?: boolean;
  mappingSummary?: string;
  mappingConfidence?: MarketingFieldMapping["confidence"];
  mappingWarnings?: string[];
}

const HEADER_ALIASES = {
  product: [
    "商品名称",
    "产品名称",
    "商品名",
    "产品名",
    "商品",
    "productname",
    "product",
    "name",
    "title",
  ],
  sellingPoints: [
    "商品卖点",
    "产品卖点",
    "核心卖点",
    "卖点",
    "sellingpoints",
    "features",
    "highlights",
  ],
  description: [
    "商品描述",
    "产品描述",
    "描述",
    "description",
    "detail",
    "details",
  ],
  reference: [
    "参考图 / 素材链接",
    "参考图",
    "商品主图",
    "产品图",
    "原图",
    "主图",
    "referenceimage",
    "referenceimages",
    "image",
    "images",
  ],
  output: [
    "营销图",
    "生成图片",
    "生成图",
    "结果图",
    "outputimage",
    "generatedimage",
    "resultimage",
  ],
  status: [
    "状态",
    "生成状态",
    "任务状态",
    "status",
    "generationstatus",
    "officedex生成状态",
    "officedexstatus",
  ],
} as const;

const PROMPT_ALIASES: Record<MarketingAssetKind, readonly string[]> = {
  "marketplace-main": [
    "主图提示词",
    "平台主图提示词",
    "生图提示词",
    "图片提示词",
    "提示词",
    "prompt",
    "imageprompt",
  ],
  lifestyle: [
    "场景图提示词",
    "生活方式场景图提示词",
    "生活方式提示词",
    "生图提示词",
    "图片提示词",
    "提示词",
    "prompt",
    "imageprompt",
  ],
  "social-poster": [
    "社媒提示词",
    "社媒图提示词",
    "社交媒体提示词",
    "海报提示词",
    "生图提示词",
    "图片提示词",
    "提示词",
    "prompt",
    "imageprompt",
  ],
};

const RATIO_ALIASES: Record<MarketingAssetKind, readonly string[]> = {
  "marketplace-main": ["主图比例", "比例"],
  lifestyle: ["场景图比例", "生活方式场景图比例", "比例"],
  "social-poster": ["社媒图比例", "社媒比例", "海报比例", "比例"],
};

const OUTPUT_ALIASES: Record<MarketingAssetKind, readonly string[]> = {
  "marketplace-main": [
    "主图结果",
    "主图生成结果",
    "主图图片",
    "OfficeDex主图",
    ...HEADER_ALIASES.output,
  ],
  lifestyle: [
    "场景图结果",
    "场景图生成结果",
    "场景图图片",
    "OfficeDex场景图",
    ...HEADER_ALIASES.output,
  ],
  "social-poster": [
    "社媒图结果",
    "社媒图生成结果",
    "社媒图图片",
    "OfficeDex社媒图",
    ...HEADER_ALIASES.output,
  ],
};

const OUTPUT_TITLES: Record<MarketingAssetKind, string> = {
  "marketplace-main": "OfficeDex主图",
  lifestyle: "OfficeDex场景图",
  "social-poster": "OfficeDex社媒图",
};

function normalizeHeader(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s_\-（）()【】\[\]：:]/g, "");
}

function findColumn(headers: string[], aliases: readonly string[]): number {
  const normalizedAliases = new Set(aliases.map(normalizeHeader));
  return headers.findIndex((header) =>
    normalizedAliases.has(normalizeHeader(header)),
  );
}

function findPreferredColumn(
  headers: string[],
  aliases: readonly string[],
): number {
  const normalizedHeaders = headers.map(normalizeHeader);
  for (const alias of aliases) {
    const index = normalizedHeaders.indexOf(normalizeHeader(alias));
    if (index >= 0) return index;
  }
  return -1;
}

function roleColumn(
  plannedColumns: SpreadsheetPlannedColumn[] | undefined,
  role: SpreadsheetFieldRole,
): number {
  return plannedColumns?.find((column) => column.role === role)?.column ?? -1;
}

function hashText(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export const MARKETING_FIELD_ROLE_OPTIONS: Array<{
  value: SpreadsheetFieldRole;
  label: string;
}> = [
  { value: "ignored", label: "不参与生图" },
  { value: "sku", label: "SKU / 商品编号" },
  { value: "productName", label: "商品名称" },
  { value: "sellingPoints", label: "核心卖点" },
  { value: "description", label: "商品描述" },
  { value: "referenceImages", label: "参考素材" },
  { value: "marketplaceMainPrompt", label: "主图提示词" },
  { value: "marketplaceMainRatio", label: "主图比例" },
  { value: "lifestylePrompt", label: "场景图提示词" },
  { value: "lifestyleRatio", label: "场景图比例" },
  { value: "socialPosterPrompt", label: "社媒提示词" },
  { value: "socialPosterRatio", label: "社媒比例" },
  { value: "generationCount", label: "生成数量" },
  { value: "generatedImage", label: "已有生成结果" },
  { value: "generationStatus", label: "OfficeDex 状态" },
];

export function marketingFieldRoleLabel(role: SpreadsheetFieldRole): string {
  return (
    MARKETING_FIELD_ROLE_OPTIONS.find((option) => option.value === role)
      ?.label ?? role
  );
}

function marketingSchemaFingerprint(
  sheetName: string,
  headerRowIndex: number,
  headers: string[],
): string {
  return hashText(
    `${sheetName}\u0000${headerRowIndex}\u0000${headers.map(normalizeHeader).join("\u0001")}`,
  );
}

function parseImageRatio(value: string | undefined): ImageRatio | undefined {
  const normalized = value?.trim().toLowerCase().replaceAll("：", ":");
  if (!normalized) return undefined;
  if (["1:1", "square", "正方形"].includes(normalized)) return "square";
  if (["16:9", "3:2", "landscape", "横图", "横版"].includes(normalized))
    return "landscape";
  if (
    ["4:5", "3:4", "2:3", "9:16", "portrait", "竖图", "竖版"].includes(
      normalized,
    )
  )
    return "portrait";
  return undefined;
}

export function findMarketingHeaderRow(
  rows: string[][],
  assetKind: MarketingAssetKind,
): number {
  let bestIndex = -1;
  let bestScore = 0;
  rows.forEach((row, index) => {
    const hasProduct = findColumn(row, HEADER_ALIASES.product) >= 0;
    if (!hasProduct) return;
    const score =
      5 +
      (findPreferredColumn(row, PROMPT_ALIASES[assetKind]) >= 0 ? 4 : 0) +
      (findColumn(row, HEADER_ALIASES.sellingPoints) >= 0 ? 1 : 0) +
      (findColumn(row, HEADER_ALIASES.description) >= 0 ? 1 : 0) +
      (findColumn(row, HEADER_ALIASES.reference) >= 0 ? 1 : 0);
    if (score > bestScore) {
      bestIndex = index;
      bestScore = score;
    }
  });
  return bestIndex;
}

function isReferenceImageLocation(value: string): boolean {
  const normalized = value.trim();
  if (!normalized) return false;

  // The spreadsheet bridge accepts local paths and HTTP(S) URLs. Template
  // cells often contain instructions such as "请插入：正面白底图……"; passing
  // that prose through as a path makes OfficeCLI fail before generation starts.
  return (
    /^https?:\/\//i.test(normalized) ||
    normalized.startsWith("/") ||
    normalized.startsWith("\\\\") ||
    /^[a-z]:[\\/]/i.test(normalized)
  );
}

function splitReferenceImages(value: string): string[] {
  return value
    .split(/[;；\n]+/)
    .map((item) => item.trim())
    .filter(isReferenceImageLocation);
}

function firstUsefulValue(row: string[]): string {
  return row.map((value) => value.trim()).find(Boolean) ?? "";
}

export function buildMarketingPrompt(
  input: {
    productName: string;
    sellingPoints?: string;
    description?: string;
    customPrompt?: string;
  },
  assetKind: MarketingAssetKind,
): string {
  if (input.customPrompt?.trim()) {
    return input.customPrompt.trim();
  }

  const useCase =
    assetKind === "marketplace-main"
      ? "电商平台商品主图，主体居中突出，干净高转化构图，背景简洁，适合商品列表和详情页首屏"
      : assetKind === "lifestyle"
        ? "电商生活方式场景图，在真实使用场景中突出商品价值，光线自然，具有品牌广告质感"
        : "社交媒体营销海报，视觉冲击力强，留出营销文案空间，适合信息流和社媒传播";
  const details = [
    `商品：${input.productName}`,
    input.sellingPoints?.trim()
      ? `核心卖点：${input.sellingPoints.trim()}`
      : "",
    input.description?.trim() ? `商品描述：${input.description.trim()}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  return [
    `生成一张${useCase}。`,
    details,
    "如提供参考图，必须保持商品外形、颜色、材质、Logo 和关键细节一致，不得虚构商品结构。",
    "画面专业、清晰、可直接作为电商营销素材；除非参考图中已有文字，否则不要生成不可控文字或水印。",
  ].join("\n");
}

export function parseMarketingSelection(
  input: MarketingSelectionInput,
): MarketingBatchDraft {
  const productColumn = input.plannedColumns
    ? roleColumn(input.plannedColumns, "productName")
    : findColumn(input.headers, HEADER_ALIASES.product);
  const sellingPointsColumn = input.plannedColumns
    ? roleColumn(input.plannedColumns, "sellingPoints")
    : findColumn(input.headers, HEADER_ALIASES.sellingPoints);
  const descriptionColumn = input.plannedColumns
    ? roleColumn(input.plannedColumns, "description")
    : findColumn(input.headers, HEADER_ALIASES.description);
  const referenceColumn = input.plannedColumns
    ? roleColumn(input.plannedColumns, "referenceImages")
    : findColumn(input.headers, HEADER_ALIASES.reference);
  const promptRole: Record<MarketingAssetKind, SpreadsheetFieldRole> = {
    "marketplace-main": "marketplaceMainPrompt",
    lifestyle: "lifestylePrompt",
    "social-poster": "socialPosterPrompt",
  };
  const ratioRole: Record<MarketingAssetKind, SpreadsheetFieldRole> = {
    "marketplace-main": "marketplaceMainRatio",
    lifestyle: "lifestyleRatio",
    "social-poster": "socialPosterRatio",
  };
  const promptColumn = input.plannedColumns
    ? roleColumn(input.plannedColumns, promptRole[input.assetKind])
    : findPreferredColumn(input.headers, PROMPT_ALIASES[input.assetKind]);
  const adjacentRatioColumn =
    promptColumn >= 0 &&
    normalizeHeader(input.headers[promptColumn + 1] ?? "") ===
      normalizeHeader("比例")
      ? promptColumn + 1
      : -1;
  const mappedRatioColumn = roleColumn(
    input.plannedColumns,
    ratioRole[input.assetKind],
  );
  const ratioColumn = input.plannedColumns
    ? mappedRatioColumn
    : adjacentRatioColumn >= 0
      ? adjacentRatioColumn
      : findPreferredColumn(input.headers, RATIO_ALIASES[input.assetKind]);
  const mappedOutputColumn = roleColumn(input.plannedColumns, "generatedImage");
  const mappedStatusColumn = roleColumn(
    input.plannedColumns,
    "generationStatus",
  );
  const outputColumn =
    mappedOutputColumn >= 0
      ? mappedOutputColumn
      : findPreferredColumn(input.headers, OUTPUT_ALIASES[input.assetKind]);
  const statusColumn =
    mappedStatusColumn >= 0
      ? mappedStatusColumn
      : findColumn(input.headers, HEADER_ALIASES.status);
  if (outputColumn < 0) {
    throw new Error(
      `模板缺少“${OUTPUT_TITLES[input.assetKind]}”图片结果列。请先在模板现有列中预留图片位置。`,
    );
  }
  if (statusColumn < 0) {
    throw new Error("模板缺少“状态”列。OfficeDex 不会自动新增状态列。");
  }

  const rows = input.rows.flatMap((row, offset): MarketingSheetRow[] => {
    const productName =
      productColumn >= 0 ? row[productColumn]?.trim() : firstUsefulValue(row);
    const customPrompt = promptColumn >= 0 ? row[promptColumn]?.trim() : "";
    if (!productName && !customPrompt) return [];
    return [
      {
        rowIndex: input.firstRowIndex + offset,
        productName:
          productName || `第 ${input.firstRowIndex + offset + 1} 行商品`,
        prompt: buildMarketingPrompt(
          {
            productName:
              productName || `第 ${input.firstRowIndex + offset + 1} 行商品`,
            sellingPoints:
              sellingPointsColumn >= 0 ? row[sellingPointsColumn] : undefined,
            description:
              descriptionColumn >= 0 ? row[descriptionColumn] : undefined,
            customPrompt,
          },
          input.assetKind,
        ),
        referenceImages:
          referenceColumn >= 0
            ? splitReferenceImages(row[referenceColumn] ?? "")
            : [],
        ratio: ratioColumn >= 0 ? parseImageRatio(row[ratioColumn]) : undefined,
      },
    ];
  });

  const plannedColumns =
    input.plannedColumns ?? buildRuleBasedColumns(input.headers);
  const mapping: MarketingFieldMapping = {
    sheetId: input.sheetId,
    sheetName: input.sheetName,
    headerRowIndex: input.headerRowIndex,
    schemaFingerprint: marketingSchemaFingerprint(
      input.sheetName,
      input.headerRowIndex,
      input.headers,
    ),
    source: input.mappingSource ?? "rules",
    confirmed: input.mappingConfirmed ?? false,
    summary: input.mappingSummary ?? "OfficeDex 已根据表头生成字段映射建议。",
    confidence: input.mappingConfidence ?? "medium",
    warnings: input.mappingWarnings ?? [],
    columns: plannedColumns.map((column) => ({
      ...column,
      header: input.headers[column.column] ?? "",
      status: input.mappingConfirmed ? "confirmed" : "suggested",
    })),
  };

  return {
    sheetId: input.sheetId,
    sheetName: input.sheetName,
    rows,
    outputColumn,
    statusColumn,
    headerRowIndex: input.headerRowIndex,
    outputTitle: OUTPUT_TITLES[input.assetKind],
    assetKind: input.assetKind,
    mapping,
    source: {
      headers: [...input.headers],
      rows: input.rows.map((row) => [...row]),
      firstRowIndex: input.firstRowIndex,
      existingColumnCount: input.existingColumnCount,
    },
  };
}

function buildRuleBasedColumns(headers: string[]): SpreadsheetPlannedColumn[] {
  const roles = new Map<number, SpreadsheetFieldRole>();
  const set = (column: number, role: SpreadsheetFieldRole) => {
    if (column >= 0 && !roles.has(column)) roles.set(column, role);
  };
  set(findColumn(headers, HEADER_ALIASES.product), "productName");
  set(
    findColumn(headers, [
      "SKU",
      "商品编号",
      "产品编号",
      "货号",
      "itemid",
      "productid",
    ]),
    "sku",
  );
  set(findColumn(headers, HEADER_ALIASES.sellingPoints), "sellingPoints");
  set(findColumn(headers, HEADER_ALIASES.description), "description");
  set(findColumn(headers, HEADER_ALIASES.reference), "referenceImages");
  set(
    findPreferredColumn(headers, PROMPT_ALIASES["marketplace-main"]),
    "marketplaceMainPrompt",
  );
  set(
    findPreferredColumn(headers, PROMPT_ALIASES.lifestyle),
    "lifestylePrompt",
  );
  set(
    findPreferredColumn(headers, PROMPT_ALIASES["social-poster"]),
    "socialPosterPrompt",
  );
  const mappedPrompts: Array<[SpreadsheetFieldRole, SpreadsheetFieldRole]> = [
    ["marketplaceMainPrompt", "marketplaceMainRatio"],
    ["lifestylePrompt", "lifestyleRatio"],
    ["socialPosterPrompt", "socialPosterRatio"],
  ];
  for (const [promptRole, ratioRole] of mappedPrompts) {
    const promptColumn =
      [...roles.entries()].find(([, role]) => role === promptRole)?.[0] ?? -1;
    if (
      promptColumn >= 0 &&
      normalizeHeader(headers[promptColumn + 1] ?? "") ===
        normalizeHeader("比例")
    ) {
      set(promptColumn + 1, ratioRole);
    }
  }
  set(
    findColumn(headers, [
      "生成数量",
      "图片数量",
      "数量",
      "count",
      "imagecount",
    ]),
    "generationCount",
  );
  set(
    findPreferredColumn(headers, [
      ...OUTPUT_ALIASES["marketplace-main"],
      ...OUTPUT_ALIASES.lifestyle,
      ...OUTPUT_ALIASES["social-poster"],
    ]),
    "generatedImage",
  );
  set(findColumn(headers, HEADER_ALIASES.status), "generationStatus");
  return headers.map((header, column) => ({
    column,
    role: roles.get(column) ?? "ignored",
    confidence: roles.has(column) ? 0.82 : 0,
    reason: roles.has(column)
      ? `根据表头“${header}”匹配`
      : "未参与当前生图工作流",
  }));
}

export function rebuildMarketingBatch(
  batch: MarketingBatchDraft,
  plannedColumns: SpreadsheetPlannedColumn[],
  options: {
    source: MarketingFieldMapping["source"];
    confirmed: boolean;
    summary: string;
    confidence: MarketingFieldMapping["confidence"];
    warnings?: string[];
  },
): MarketingBatchDraft {
  return parseMarketingSelection({
    sheetId: batch.sheetId,
    sheetName: batch.sheetName,
    headers: batch.source.headers,
    rows: batch.source.rows,
    firstRowIndex: batch.source.firstRowIndex,
    existingColumnCount: batch.source.existingColumnCount,
    headerRowIndex: batch.headerRowIndex,
    assetKind: batch.assetKind,
    plannedColumns,
    mappingSource: options.source,
    mappingConfirmed: options.confirmed,
    mappingSummary: options.summary,
    mappingConfidence: options.confidence,
    mappingWarnings: options.warnings,
  });
}

export function recommendedRatio(assetKind: MarketingAssetKind): ImageRatio {
  if (assetKind === "social-poster") return "portrait";
  return "square";
}
