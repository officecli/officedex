#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractFacts } from "../lib/facts.mjs";
import { distillFromFacts } from "../lib/distill.mjs";
import { applyFills } from "../lib/fill.mjs";
import { completeJson } from "../lib/llm.mjs";
import { exportMopDirectory } from "../../../../presentation/tools/lib/mop-converter-client.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TEMPLATE = path.join(ROOT, "work/template");
const OUT = path.join(ROOT, "work/generate-shimo");
const BRIEF = `Fill this company-intro template for 石墨文档 (Shimo Docs).
Company: 石墨文档. Tagline: 实时协作的云端办公套件.
Presenter: 林晓. Date: 2026.09.
About: 多人同时编辑文档/表格/幻灯片，企业知识沉淀。
Services: 在线文档、智能表格、幻灯片、知识库.
Team: 林晓 产品负责人; 周可 设计负责人; 韩牧 工程负责人.
Keep every fill within maxChars. Chinese copy. Same brand.name 石墨文档 on every brand slot.
Do not invent extra pages. Return JSON {fills:[{slotId,text}]}.`;

const mop = JSON.parse(await fs.readFile(path.join(TEMPLATE, "source.mop/content.json"), "utf8"));
const facts = extractFacts(mop);
const handbook = distillFromFacts(facts).handbook;
await fs.rm(OUT, { recursive: true, force: true });
await fs.mkdir(OUT, { recursive: true });

const pages = handbook.pages;
const batches = [];
for (let i = 0; i < pages.length; i += 7) batches.push(pages.slice(i, i + 7));

const fills = [];
for (const [bi, batch] of batches.entries()) {
  const slots = [];
  for (const page of batch) {
    for (const slot of page.slots || []) {
      if (slot.role === "brand.name") continue;
      slots.push({
        slotId: slot.slotId,
        role: slot.role,
        fillWith: slot.fillWith,
        maxChars: slot.maxChars,
        sample: slot.sample,
      });
    }
  }
  console.log("batch", bi + 1, "slots", slots.length, "slides", batch.map((p) => p.index).join(","));
  const result = await completeJson(
    JSON.stringify({ brief: BRIEF, globals: handbook.globals, slides: batch.map((p) => ({ index: p.index, pageKind: p.pageKind, purpose: p.purpose, modules: p.modules })), slots }),
    "Return JSON {fills:[{slotId,text}]} only. Chinese text. Respect maxChars. English field names in the prompt are instructions, output copy is Chinese.",
  );
  const part = Array.isArray(result.fills) ? result.fills : [];
  console.log("  got", part.length, "fills");
  fills.push(...part);
}

for (const id of handbook.globals?.[0]?.slotIds || []) {
  fills.push({ slotId: id, text: "石墨文档" });
}

await fs.writeFile(path.join(OUT, "fills.json"), JSON.stringify({ fills }, null, 2));
const destMop = path.join(OUT, "filled.mop");
await fs.cp(path.join(TEMPLATE, "source.mop"), destMop, { recursive: true });
const filled = JSON.parse(await fs.readFile(path.join(destMop, "content.json"), "utf8"));
applyFills(filled, fills);
await fs.writeFile(path.join(destMop, "content.json"), JSON.stringify(filled, null, 2));
const pptx = path.join(OUT, "shimo-company-intro.pptx");
console.log("exporting", pptx);
await exportMopDirectory(destMop, pptx);
console.log("done fills", fills.length, "pptx", pptx);
