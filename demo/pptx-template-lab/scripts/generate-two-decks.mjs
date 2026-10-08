#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { extractFacts } from "../lib/facts.mjs";
import { distillFromFacts } from "../lib/distill.mjs";
import { pageTypesFromHandbook, remapSlots, remapPictureSlots } from "../lib/page-types.mjs";
import { mapOutlineToPages } from "../lib/map-outline.mjs";
import { cloneMappedSlides } from "../lib/clone.mjs";
import { applyFills, applyPageNumbers, overflowWarnings } from "../lib/fill.mjs";
import { completeJson } from "../lib/llm.mjs";
import { FILL_SYSTEM, slotPayload, applyKnownFacts, missingSlots, leftoverPlaceholders, remapFillIds } from "../lib/fill-plan.mjs";
import { classifyPicture, replacePhotos } from "../lib/images.mjs";
import { exportMopDirectory } from "../../../../presentation/tools/lib/mop-converter-client.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TEMPLATE = path.join(ROOT, "work/template");
const BRAND = "石墨文档";
const FACTS = {
  brand: BRAND,
  presenter: "林晓",
  date: "2026.09",
  phone: "400-000-0000",
  address: "北京市海淀区",
  email: "hi@shimo.im",
  website: "shimo.im",
  closingKicker: "Thanks",
  closingMessage: "感谢观看",
  team: [
    { name: "林晓", role: "产品负责人" },
    { name: "周可", role: "设计负责人" },
    { name: "韩牧", role: "工程负责人" },
  ],
};
const BRIEF = `Fill cloned template slides for 石墨文档 (Shimo Docs).
Known facts only — do not invent partners, customers, prices, or metrics:
Company: 石墨文档. Tagline: 实时协作的云端办公套件.
Presenter: 林晓. Date: 2026.09. Phone: 400-000-0000. Address: 北京市海淀区.
Email: hi@shimo.im. Website: shimo.im.
Products: 在线文档、智能表格、幻灯片、知识库.
Team: 林晓 产品负责人; 周可 设计负责人; 韩牧 工程负责人.
Partners: none listed.
Prices: 免费版 / 专业版 / 企业版 (no fake currency amounts).
Same brand.name 石墨文档 on every brand slot.`;

const SHORT_OUTLINE = {
  title: "石墨文档",
  brandName: BRAND,
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

const LONG_OUTLINE = {
  title: "石墨文档",
  brandName: BRAND,
  slides: [
    { purpose: "cover", bullets: ["实时协作的云端办公套件"] },
    { purpose: "公司概况", bullets: ["云端办公套件", "服务企业知识协作"] },
    { purpose: "section: 关于我们", bullets: [] },
    { purpose: "图文 发展历程", bullets: ["2014 起步", "持续打磨协作"] },
    { purpose: "图文 产品理念", bullets: ["少打断", "多人同屏"] },
    { purpose: "图文 协作场景", bullets: ["会议纪要", "项目文档"] },
    { purpose: "三个核心价值", bullets: ["实时", "安全", "开放"] },
    { purpose: "图文介绍 里程碑", bullets: ["百万用户", "全平台覆盖"] },
    { purpose: "团队 产品", bullets: ["林晓"] },
    { purpose: "团队 设计", bullets: ["周可"] },
    { purpose: "团队 工程", bullets: ["韩牧"] },
    { purpose: "section: 我们的服务", bullets: [] },
    { purpose: "四项产品", bullets: ["在线文档", "智能表格", "幻灯片", "知识库"] },
    { purpose: "四项能力", bullets: ["实时协作", "权限", "搜索", "开放接口"] },
    { purpose: "协作说明", bullets: ["同文档共编", "变更可追溯"] },
    { purpose: "企业四项保障", bullets: ["权限", "审计", "备份", "合规"] },
    { purpose: "section: 我们的业务", bullets: [] },
    { purpose: "六项能力矩阵", bullets: ["文档", "表格", "幻灯片", "知识库", "协作", "安全"] },
    { purpose: "图文案例", bullets: ["制造研发", "咨询交付"] },
    { purpose: "三个使用场景", bullets: ["周会", "立项", "复盘"] },
    { purpose: "四套解决方案", bullets: ["研发", "销售", "人事", "管理层"] },
    { purpose: "合作伙伴 partners", bullets: ["生态伙伴"] },
    { purpose: "定价方案 pricing", bullets: ["免费版", "专业版", "企业版"] },
    { purpose: "section: 我们的目标", bullets: [] },
    { purpose: "愿景说明", bullets: ["成为默认办公底座", "让协作零摩擦"] },
    { purpose: "三个目标", bullets: ["体验", "安全", "生态"] },
    { purpose: "图文展望", bullets: ["AI 辅助写作", "知识自动沉淀"] },
    { purpose: "section: 更多能力", bullets: [] },
    { purpose: "安全合规四项", bullets: ["加密", "权限", "审计", "备份"] },
    { purpose: "三个行业方案", bullets: ["互联网", "制造", "金融"] },
    { purpose: "联系方式", bullets: ["商务合作", "技术支持"] },
    { purpose: "closing thanks", bullets: ["感谢观看"] },
  ],
};

const mop = JSON.parse(await fs.readFile(path.join(TEMPLATE, "source.mop/content.json"), "utf8"));
const templateFacts = extractFacts(mop);
const handbook = distillFromFacts(templateFacts).handbook;
const pageTypes = pageTypesFromHandbook(handbook);
const skipImages = process.argv.includes("--no-images");

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const only = process.argv.filter((arg) => !arg.startsWith("--"))[2];
  if (only === "map") {
    for (const [name, outline] of [["short-8", SHORT_OUTLINE], ["long-32", LONG_OUTLINE]]) {
      const { mapping, warnings } = mapOutlineToPages(outline, pageTypes);
      console.log(name, mapping.length, mapping.map((row) => `${row.outlineIndex}:${row.pageKind}<-${row.sourceSlide}`).join(" "));
      if (warnings.length) console.log("  warnings", warnings);
    }
  } else {
    if (!only || only === "short" || only === "short-reuse") {
      await generateDeck({
        name: "short-8",
        outDir: path.join(ROOT, "work/pair-short"),
        pptxName: "shimo-short-8.pptx",
        outline: SHORT_OUTLINE,
        expectedPages: 8,
        reuseFills: only === "short-reuse",
      });
    }
    if (!only || only === "long" || only === "long-reuse") {
      await generateDeck({
        name: "long-32",
        outDir: path.join(ROOT, "work/pair-long"),
        pptxName: "shimo-long-32.pptx",
        outline: LONG_OUTLINE,
        expectedPages: 32,
        reuseFills: only === "long-reuse",
      });
    }
  }
}

async function generateDeck({ name, outDir, pptxName, outline, expectedPages, reuseFills = false }) {
  const saved = reuseFills
    ? JSON.parse(await fs.readFile(path.join(outDir, "fills.json"), "utf8"))
    : null;
  const { mapping, warnings } = saved
    ? { mapping: saved.mapping, warnings: saved.warnings || [] }
    : mapOutlineToPages(outline, pageTypes);
  const summary = mapping.map((row) => `${row.outlineIndex}:${row.pageKind}<-${row.sourceSlide}`).join(" ");
  console.log(`\n[${name}] pages=${mapping.length} mapping ${summary}`);
  if (mapping.length !== expectedPages) {
    throw new Error(`[${name}] expected ${expectedPages} pages, got ${mapping.length}`);
  }
  if (mapping[0].pageKind !== "cover" || mapping[mapping.length - 1].pageKind !== "closing") {
    throw new Error(`[${name}] cover/closing mismatch: ${mapping.map((row) => row.pageKind).join(",")}`);
  }
  if (mapping.some((row) => row.jsFallback)) {
    throw new Error(`[${name}] unexpected js-fallback: ${JSON.stringify(mapping.filter((row) => row.jsFallback))}`);
  }

  const dest = path.join(outDir, "cloned.mop");
  await fs.rm(dest, { recursive: true, force: true });
  await fs.mkdir(outDir, { recursive: true });
  await fs.cp(path.join(TEMPLATE, "source.mop"), dest, { recursive: true });
  const cloned = JSON.parse(await fs.readFile(path.join(dest, "content.json"), "utf8"));
  cloneMappedSlides(cloned, mapping);
  await fs.writeFile(path.join(dest, "content.json"), JSON.stringify(cloned));

  const catalog = mapping.map((row, i) => {
    const srcPage = handbook.pages.find((page) => page.index === row.sourceSlide);
    return { newIndex: i + 1, ...row, slots: remapSlots(srcPage, i + 1) };
  });

  const allSlots = catalog.flatMap((page) => page.slots || []);
  let fills = Array.isArray(saved?.fills) ? saved.fills : [];
  if (!saved) {
    const batches = chunk(catalog, 6);
    for (const [bi, batch] of batches.entries()) {
      const slots = batch.flatMap((page) =>
        (page.slots || []).filter((slot) => slot.role !== "brand.name").map(slotPayload),
      );
      console.log(`[${name}] fill batch ${bi + 1}/${batches.length} slides ${batch.map((p) => p.newIndex).join(",")} slots ${slots.length}`);
      const result = await completeJson(
        JSON.stringify({
          brief: BRIEF,
          brandName: BRAND,
          pages: batch.map((page) => ({
            newIndex: page.newIndex,
            purpose: page.purpose,
            pageKind: page.pageKind,
            bullets: page.bullets,
            modules: (handbook.pages.find((item) => item.index === page.sourceSlide) || {}).modules,
          })),
          slots,
        }),
        FILL_SYSTEM,
      );
      const part = Array.isArray(result.fills) ? result.fills : [];
      console.log(`[${name}]   got ${part.length} fills`);
      fills.push(...part);
    }
    remapFillIds(fills, mapping);
    const missing = missingSlots(fills, allSlots);
    if (missing.length) {
      console.log(`[${name}] refill ${missing.length} missing slots`);
      const extra = await completeJson(JSON.stringify({ brief: BRIEF, slots: missing.map(slotPayload) }), FILL_SYSTEM);
      fills.push(...(Array.isArray(extra.fills) ? extra.fills : []));
    }
    const leftover = leftoverPlaceholders(fills);
    if (leftover.length) {
      console.log(`[${name}] rewrite ${leftover.length} leftover placeholders`);
      const extra = await completeJson(
        JSON.stringify({ brief: BRIEF, slots: leftover.map((fill) => slotPayload(allSlots.find((slot) => slot.slotId === fill.slotId) || fill)) }),
        FILL_SYSTEM,
      );
      const rewritten = new Map((Array.isArray(extra.fills) ? extra.fills : []).map((fill) => [fill.slotId, fill.text]));
      for (const fill of fills) {
        if (rewritten.has(fill.slotId)) fill.text = rewritten.get(fill.slotId);
      }
    }
  } else {
    console.log(`[${name}] reuse ${fills.length} fills`);
  }
  applyKnownFacts(fills, allSlots, FACTS);

  const overflow = overflowWarnings(fills, allSlots);
  await fs.writeFile(
    path.join(outDir, "fills.json"),
    JSON.stringify({ mapping, fills, warnings: [...warnings, ...overflow] }, null, 2),
  );

  const filled = JSON.parse(await fs.readFile(path.join(dest, "content.json"), "utf8"));
  applyFills(filled, fills);
  applyPageNumbers(filled);

  if (!skipImages) {
    const photoSlots = [];
    for (const [index, row] of mapping.entries()) {
      const srcFacts = templateFacts.slides[row.sourceSlide - 1];
      const pics = remapPictureSlots(srcFacts, index + 1)
        .map((pic, picIndex) => {
          const src = srcFacts?.pictures?.[picIndex];
          return {
            ...pic,
            kind: classifyPicture(src || pic, row.pageKind, templateFacts.canvas),
            pageKind: row.pageKind,
            purpose: row.purpose,
            bullets: row.bullets,
          };
        })
        .filter((pic) => pic.kind === "photo");
      const ordered = [...pics].sort((a, b) => (a.top || 0) - (b.top || 0) || (a.left || 0) - (b.left || 0));
      if (row.pageKind === "team") {
        ordered.forEach((pic, i) => { pic.person = FACTS.team[i % FACTS.team.length]; });
      } else {
        ordered.forEach((pic, i) => { pic.caption = (row.bullets || [])[i] || row.purpose; });
      }
      photoSlots.push(...pics);
    }
    console.log(`[${name}] replace ${photoSlots.length} photos`);
    await replacePhotos({
      mopRoot: filled,
      mopDir: dest,
      slots: photoSlots,
      facts: FACTS,
      cacheDir: path.join(ROOT, "work/image-cache"),
    });
  }

  await fs.writeFile(path.join(dest, "content.json"), JSON.stringify(filled));
  const pptx = path.join(outDir, pptxName);
  await exportMopDirectory(dest, pptx);
  const slideCount = filled.blocks.find((block) => block.type === "slides").data.length;
  console.log(`[${name}] pages ${slideCount} overflow ${overflow.length} pptx ${pptx}`);
  if (slideCount !== expectedPages) throw new Error(`[${name}] export page count ${slideCount}`);
}

function chunk(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
