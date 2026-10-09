import type { DocumentType, ImageRatio } from "../shared/types";
import { fileExtension } from "./utils/path";

export interface HomeTaskIntake {
  pptxWorkflow?: "design" | "animation";
  prompt: string;
  sourceFile?: string;
  referenceDirectory?: string;
  referenceImages?: string[];
  referenceTextFiles?: string[];
  imageRatio?: ImageRatio;
  fps?: number;
  documentType?: DocumentType;
  /** When enabled, pause for an AI plan and user decisions before generation. */
  advancedMode?: boolean;
  templateId?: string;
  templateVersion?: number;
  templateAssetDir?: string;
}

export interface HomeTaskAnalysis extends HomeTaskIntake {
  kind: "catalog_cleanup" | "generate";
  documentType: DocumentType;
  nextStep: "configure" | "plan" | "execute";
}

export type HomeTaskRoute =
  | { kind: "catalog_cleanup"; documentType: "xlsx"; sourceFile: string }
  | { kind: "generate"; documentType: DocumentType; sourceFile?: string }
  | { kind: "needs_source"; documentType: "xlsx" }
  /**
   * The words ask for a file this product does not make (a .txt, a PDF…) and
   * name no type it does. Refused rather than quietly made as the default:
   * "save it as a text file" used to come back as a deck.
   */
  | { kind: "unsupported_format"; format: string };

const CATALOG_SUBJECT = /(shopify|supplier|catalog|product|sku|供应商|商品|产品|货品)/i;
const CATALOG_ACTION = /(clean|cleanup|validate|normalize|import|convert|csv|清洗|校验|规范|整理|导入|转换)/i;

function isCatalogCleanupIntent(prompt: string) {
  if (/(image|illustration|poster|banner|图片|插画|海报|封面|配图)/i.test(prompt)) return false;
  return CATALOG_SUBJECT.test(prompt) && CATALOG_ACTION.test(prompt);
}

export function inferHomeTaskRoute(input: HomeTaskIntake, fallback: DocumentType = "pptx"): HomeTaskRoute {
  const prompt = positiveFormatIntent(input.prompt.trim());
  const sourceFile = input.sourceFile?.trim() || undefined;
  const extension = fileExtension(sourceFile);
  const hasPptxTemplate = Boolean(input.templateId || input.templateAssetDir);

  // A local PPT template is an explicit slide request. Prompt words such as
  // 「方案」or "proposal" otherwise match the Word heuristic and would drop
  // the template binding on the way to generate.
  if (hasPptxTemplate) {
    return { kind: "generate", documentType: "pptx", sourceFile };
  }

  /*
   * Catalog cleanup is a route of its own, not a type — and it still outranks a
   * stated type whenever there is really a catalog to clean.
   *
   * The guard used to be unconditional, which was harmless while the only
   * caller was Home's picker and harmful once the composer grew an output
   * control: "make me a document about tidying up the supplier list" with no
   * file attached hit `needs_source` and came back as "that request needs a
   * file to work from" — a refusal, in answer to a request that needed no file
   * at all. Cleanup now needs something to clean: a workbook the user pointed
   * at, or their own word that a workbook is what they want.
   */
  const cleanUpCatalog =
    isCatalogCleanupIntent(prompt)
    && (!input.documentType || input.documentType === "xlsx" || extension === "xlsx");
  if (cleanUpCatalog) {
    if (sourceFile) {
      if (extension === "xlsx") return { kind: "catalog_cleanup", documentType: "xlsx", sourceFile };
      return { kind: "generate", documentType: "xlsx", sourceFile };
    }
    /*
     * Nothing to clean.
     *
     * The stated type is what keeps docx and pptx out of this branch, but
     * `xlsx` walks straight in — and the composer sets that type exactly when
     * the user picked "New workbook", which clears the active file as it does.
     * So 「帮我整理一份产品清单表」with New workbook selected came back as
     * "that request needs a file to work from", about a file the user had just
     * said they did not have. A stated workbook with no source is a workbook to
     * make; only an inferred one is still a question.
     */
    if (input.documentType) return { kind: "generate", documentType: "xlsx" };
    return { kind: "needs_source", documentType: "xlsx" };
  }

  // The output-type control is the user's choice. Keyword matching only fills
  // in when they did not make one — otherwise 「方案」turns a selected PPT into
  // a Word document.
  if (input.documentType) {
    return { kind: "generate", documentType: input.documentType, sourceFile };
  }

  // An explicit output suffix wins over incidental mentions of input formats.
  const output = /(?:生成|新建|创建|另存为|保存为|输出为|create|generate|save(?: it)? as|output(?: as)?)[^。\n;；]{0,100}?\.?(txt|markdown|rtf|html?|pdf)\b/i.exec(prompt);
  const named = requestedFileName(prompt);
  const unsupported = unsupportedOutputFormat(named ?? output?.[1] ?? "");
  if (unsupported) return { kind: "unsupported_format", format: unsupported };

  if (/(gif|动图|动画图)/i.test(prompt)) return { kind: "generate", documentType: "gif", sourceFile };
  if (/(slides?|pptx?|presentation|deck|演示|幻灯片|路演)/i.test(prompt)) return { kind: "generate", documentType: "pptx", sourceFile };
  if (/(image|poster|banner|illustration|图片|海报|封面|配图)/i.test(prompt)) return { kind: "generate", documentType: "img", sourceFile };
  if (/(report|analysis|研究报告|分析报告|调研报告)/i.test(prompt)) {
    return { kind: "generate", documentType: extension === "xlsx" ? "report" : "docx", sourceFile };
  }
  if (/(spreadsheet|workbook|excel|xlsx|csv|table|表格|工作簿|数据表)/i.test(prompt) || extension === "csv") {
    return { kind: "generate", documentType: "xlsx", sourceFile };
  }
  if (/(word|docx|document|proposal|memo|文档|方案|合同|纪要)/i.test(prompt)) {
    return { kind: "generate", documentType: "docx", sourceFile };
  }

  // No type the product makes was named. Before falling back to the default,
  // check whether a type it does *not* make was — that is a refusal, not a
  // guess.
  const unsupportedFallback = unsupportedOutputFormat(prompt);
  if (unsupportedFallback) return { kind: "unsupported_format", format: unsupportedFallback };

  return { kind: "generate", documentType: fallback, sourceFile };
}

/**
 * Formats a request can name that nothing here produces, as they read in a
 * refusal. Only checked once every supported keyword has missed, so "turn this
 * PDF into slides" is still slides; it is "turn this into a PDF" that stops.
 */
const UNSUPPORTED_OUTPUT_FORMATS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\.txt\b|\btxt\b|纯文本|文本文件|记事本|text file/i, label: "TXT" },
  { pattern: /\.md\b|\bmarkdown\b|markdown ?文件/i, label: "Markdown" },
  { pattern: /\.rtf\b|\brtf\b/i, label: "RTF" },
  { pattern: /\.html?\b|\bhtml\b|网页文件|网页格式/i, label: "HTML" },
  { pattern: /\.pdf\b|\bpdf\b/i, label: "PDF" },
  { pattern: /\.json\b|\bjson\b/i, label: "JSON" },
  { pattern: /\.xml\b|\bxml\b/i, label: "XML" },
  { pattern: /\.epub\b|\bepub\b/i, label: "EPUB" },
];

/** The unsupported output format a prompt names, or null when it names none. */
export function unsupportedOutputFormat(prompt: string): string | null {
  for (const { pattern, label } of UNSUPPORTED_OUTPUT_FORMATS) {
    if (pattern.test(prompt)) return label;
  }
  return null;
}

/**
 * The file name the user asked for, when they asked for one.
 *
 * Two shapes: a name with an extension anywhere in the text ("call it
 * Q3-review.pptx"), or a naming phrase followed by the name ("文件名叫 季度复盘",
 * "name it launch plan"). The runtime has no field for this yet, so the
 * caller can only pass it on as the topic and spell it out in the prompt.
 */
const NAMED_FILE = /([^\s"'“”「」『』《》:：,，。;；()（）]+\.(?:pptx?|docx?|xlsx?|png|jpe?g|gif|txt|md|pdf|html?))(?=$|[\s"'“”」』》,，。;；)）])/i;
const NAMING_PHRASE =
  /(?:文件名(?:叫|为|是|：|:)?|命名为|取名(?:为|叫)?|名字叫|叫做|保存为|存为|另存为|存成|file ?name(?: is| should be|:)?|named?(?: it| the file)?(?: as)?|call(?: it| the file)|save(?: it)? as)\s*[:：]?\s*["'“「『《]?([^"'”」』》\n,，。;；]{1,80})["'”」』》]?/i;

/**
 * "一个叫 X 的 Word": a bare 叫 is too loose on its own ("叫张三的人"), so
 * this shape is only read when what follows 的 is the document being asked
 * for. The name itself stops at the first space, quote, punctuation or 的.
 */
const NAMED_DOCUMENT_ZH =
  /叫\s*["'“「『《]?([^"'”」』》\s,，。;；的]{1,80})["'”」』》]?\s*的\s*(?:word|docx?|pptx?|ppt|xlsx?|excel|文档|文件|文稿|幻灯片|演示文稿|演示|表格|工作簿|报告|方案)/i;

export function requestedFileName(prompt: string): string | null {
  const explicit = NAMED_FILE.exec(prompt);
  if (explicit) return explicit[1].trim();
  const phrased = NAMING_PHRASE.exec(prompt);
  if (phrased) {
    const name = phrased[1].trim();
    if (name && !/^(?:a|an|the|一个|一份|个|份)$/i.test(name)) return name;
  }
  const named = NAMED_DOCUMENT_ZH.exec(prompt);
  if (named) return named[1].trim();
  return null;
}

/** Extensions a requested name may carry; officecli adds the real one from the document type. */
const KNOWN_OUTPUT_EXTENSION = /\.(?:pptx?|docx?|xlsx?|png|jpe?g|gif|txt|md|pdf|html?)$/i;

/** The longest stem officecli keeps before it falls back to the slug. */
const OUTPUT_FILE_STEM_MAX = 80;

/**
 * What goes on the wire as `outputFileName`: the requested name as a stem.
 *
 * The extension comes off here as well as in officecli — officecli strips
 * only the one that matches the document type, and "save it as plan.pdf" for
 * a deck would otherwise become `plan.pdf.pptx`. Anything that is not clearly
 * a name after that (empty, over the limit, punctuation only) is dropped
 * rather than guessed: a wrong name is worse than the slug.
 */
export function outputFileStem(requested: string | null): string | null {
  if (!requested) return null;
  const stem = requested.trim().replace(KNOWN_OUTPUT_EXTENSION, "").trim();
  if (!stem || [...stem].length > OUTPUT_FILE_STEM_MAX) return null;
  if (!/[\p{L}\p{N}]/u.test(stem)) return null;
  return stem;
}

/** Ignore explicitly excluded output formats while inferring a new file's type. */
function positiveFormatIntent(prompt: string): string {
  return prompt.replace(/(?:不要|不需要|禁止|无需|别|do not|don't|without|no)\s*(?:生成|创建|新建|制作|输出|generate|create|make)?\s*(?:(?:a|an|any)\s+)?(?:pptx?|slides?|presentations?|decks?|演示文稿|幻灯片|docx?|word|xlsx?|excel|pdf|txt)(?=$|[\s,，。.;；!！?？])/gi, "");
}

/** A new deliverable must not silently mutate the file left open from the last run. */
export function requestsNewFile(prompt: string): boolean {
  return /(?:新建|创建|生成|另做|另外做|再做|另存为|保存为|输出为)[^。\n]{0,80}(?:文档|文件|报告|演示|幻灯片|表格|工作簿|docx?|pptx?|xlsx?|txt|markdown|pdf|html|rtf)|(?:create|generate|make|write)\s+(?:(?:me|a|an|another|new|separate|fresh)\s+)+(?:[^.\n]{0,70}\s)?(?:document|file|report|deck|slides?|presentation|spreadsheet|workbook|docx?|pptx?|xlsx?|txt|markdown|pdf|html|rtf)\b|\b(?:new|another|separate)\s+(?:docx?|pptx?|xlsx?|document|file|deck|spreadsheet)\b/i.test(positiveFormatIntent(prompt));
}
