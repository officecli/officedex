#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractFacts } from "../lib/facts.mjs";
import { distillFromFacts } from "../lib/distill.mjs";
import { pageTypesFromHandbook, remapSlots } from "../lib/page-types.mjs";
import { mapOutlineToPages } from "../lib/map-outline.mjs";
import { cloneMappedSlides } from "../lib/clone.mjs";
import { applyFills, applyPageNumbers, overflowWarnings } from "../lib/fill.mjs";
import { completeJson } from "../lib/llm.mjs";
import { exportMopDirectory } from "../../../../presentation/tools/lib/mop-converter-client.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TEMPLATE = path.join(ROOT, "work/template");
const OUT = path.join(ROOT, "work/generate-8page");
const outline = {
  title: "石墨文档",
  brandName: "石墨文档",
  slides: [
    { purpose: "cover", bullets: ["实时协作的云端办公套件"] },
    { purpose: "section: about", bullets: [] },
    { purpose: "about us three points", bullets: ["多人同编", "云端存储", "知识沉淀"] },
    { purpose: "four services", bullets: ["在线文档", "智能表格", "幻灯片", "知识库"] },
    { purpose: "four more services", bullets: ["实时协作", "权限", "搜索", "开放接口"] },
    { purpose: "team", bullets: ["林晓", "周可", "韩牧"] },
    { purpose: "six capabilities", bullets: ["文档", "表格", "幻灯片", "知识库", "协作", "安全"] },
    { purpose: "closing thanks", bullets: ["感谢观看"] },
  ],
};

const mop = JSON.parse(await fs.readFile(path.join(TEMPLATE, "source.mop/content.json"), "utf8"));
const handbook = distillFromFacts(extractFacts(mop)).handbook;
const pageTypes = pageTypesFromHandbook(handbook);
const { mapping, warnings } = mapOutlineToPages(outline, pageTypes);
console.log("mapping", mapping.map((row) => `${row.outlineIndex}:${row.pageKind}<-${row.sourceSlide}`).join(" "));
if (mapping.length !== 8) throw new Error("expected 8 pages");
if (mapping[0].pageKind !== "cover" || mapping[mapping.length - 1].pageKind !== "closing") {
  throw new Error("cover/closing mismatch: " + mapping.map((row) => row.pageKind).join(","));
}
if (mapping[3].pageKind !== "parallel-4" || mapping[4].pageKind !== "parallel-4") {
  throw new Error("expected two parallel-4 instances, got " + mapping[3].pageKind + " " + mapping[4].pageKind);
}
if (mapping[3].sourceSlide === mapping[4].sourceSlide) {
  console.warn("same source slide reused for both parallel-4 (ok if only one type page)");
}

await fs.rm(OUT, { recursive: true, force: true });
const dest = path.join(OUT, "cloned.mop");
await fs.cp(path.join(TEMPLATE, "source.mop"), dest, { recursive: true });
const cloned = JSON.parse(await fs.readFile(path.join(dest, "content.json"), "utf8"));
cloneMappedSlides(cloned, mapping);
await fs.writeFile(path.join(dest, "content.json"), JSON.stringify(cloned));

const catalog = mapping.map((row, i) => {
  const srcPage = handbook.pages.find((page) => page.index === row.sourceSlide);
  return { newIndex: i + 1, ...row, slots: remapSlots(srcPage, i + 1) };
});
const result = await completeJson(
  JSON.stringify({ brief: "石墨文档产品介绍", brandName: "石墨文档", catalog }),
  "Return JSON {fills:[{slotId,text}]}. Chinese copy. NEW slot indexes. Respect maxChars.",
);
const fills = Array.isArray(result.fills) ? result.fills : [];
for (const page of catalog) {
  for (const slot of page.slots || []) {
    if (slot.role === "brand.name") fills.push({ slotId: slot.slotId, text: "石墨文档" });
  }
}
const overflow = overflowWarnings(fills, catalog.flatMap((page) => page.slots || []));
await fs.writeFile(path.join(OUT, "fills.json"), JSON.stringify({ mapping, fills, warnings: [...warnings, ...overflow] }, null, 2));
const filled = JSON.parse(await fs.readFile(path.join(dest, "content.json"), "utf8"));
applyFills(filled, fills);
applyPageNumbers(filled);
await fs.writeFile(path.join(dest, "content.json"), JSON.stringify(filled));
const pptx = path.join(OUT, "shimo-8page.pptx");
await exportMopDirectory(dest, pptx);
const slideCount = filled.blocks.find((block) => block.type === "slides").data.length;
console.log("pages", slideCount, "overflow", overflow.length, "pptx", pptx);
if (slideCount !== 8) throw new Error("export page count " + slideCount);
