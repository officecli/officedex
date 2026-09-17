#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractFacts } from "../lib/facts.mjs";
import { distillFromFacts } from "../lib/distill.mjs";
import { completeJson } from "../lib/llm.mjs";
import { mergeHandbook, renderHandbookMarkdown } from "../lib/handbook.mjs";
import { importPptxFile } from "../../../../presentation/tools/lib/mop-converter-client.mjs";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const WORK = path.resolve(ROOT, "../work/selftest");
const PPTX = process.argv[2] || "/Users/luyang/Downloads/公司简介模版.pptx";

await fs.rm(WORK, { recursive: true, force: true });
await fs.mkdir(path.join(WORK, "source.mop"), { recursive: true });
await fs.copyFile(PPTX, path.join(WORK, "source.pptx"));
console.log("converting", PPTX);
await importPptxFile(path.join(WORK, "source.pptx"), path.join(WORK, "source.mop"));
const mop = JSON.parse(await fs.readFile(path.join(WORK, "source.mop", "content.json"), "utf8"));
const facts = extractFacts(mop);
const distilled = distillFromFacts(facts);
await fs.mkdir(path.join(WORK, "skill"), { recursive: true });
await fs.writeFile(path.join(WORK, "skill", "SKILL.local.md"), distilled.skillMarkdown);
await fs.writeFile(path.join(WORK, "handbook.local.json"), JSON.stringify(distilled.handbook, null, 2));
console.log("local handbook pages", distilled.handbook.pages.length, "globals", distilled.handbook.globals?.length);
console.log("kinds", distilled.handbook.pages.map((p) => `${p.index}:${p.pageKind}`).join(", "));

const catalog = (facts.slides || []).map((slide) => ({
  index: slide.index,
  texts: (slide.texts || []).map((box) => ({
    slotId: box.slotId, role: box.role, replaceable: box.replaceable,
    maxChars: box.maxChars, sample: box.text, top: Math.round(box.top), left: Math.round(box.left), sizePt: box.sizePt,
  })),
}));
console.log("calling LLM distill…");
const result = await completeJson(
  JSON.stringify({ catalog, globalsHint: distilled.handbook.globals, localHandbook: distilled.handbook }),
  "All output MUST be English. Return JSON {handbook:{globals:[{id,fillWith,slotIds}],pages:[{index,pageKind,purpose,modules:[{id,kind,items:[{index,titleSlot,bodySlot}]}],slots:[{slotId,role,fillWith,dataKind}]}]}}. pageKind in cover|section-divider|parallel-3|parallel-4|parallel-6|team|partners|pricing|kpi|split-image|closing|content. Keep every replaceable slotId. No DO/DONT.",
);
const merged = mergeHandbook(distilled.handbook, result.handbook || result);
const md = renderHandbookMarkdown(merged);
await fs.writeFile(path.join(WORK, "skill", "SKILL.md"), md);
await fs.writeFile(path.join(WORK, "handbook.json"), JSON.stringify(merged, null, 2));
console.log("wrote", path.join(WORK, "skill", "SKILL.md"));
console.log("kinds after llm", merged.pages.map((p) => `${p.index}:${p.pageKind}`).join(", "));
const issues = [];
if (/DO:|DON'T:|不要|应填数据/.test(md)) issues.push("non-english or do/dont leaked");
if (!merged.globals?.length) issues.push("missing globals");
const kinds = new Set(merged.pages.map((p) => p.pageKind));
if (!kinds.has("cover")) issues.push("missing cover");
if (![...kinds].some((k) => String(k).includes("parallel") || k === "team")) issues.push("no parallel/team modules");
const slide13 = merged.pages.find((p) => p.index === 13);
if (slide13 && !(slide13.modules || []).some((m) => m.kind === "card-grid" || (m.items || []).length >= 3)) {
  issues.push("slide 13 has no card grid");
}
console.log("issues", issues.length ? issues.join("; ") : "none");
