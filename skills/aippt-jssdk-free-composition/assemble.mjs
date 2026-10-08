#!/usr/bin/env node
// Turn structured content + a Skill generation plan into a Host-runnable
// generated.mjs. Drawers paint each page; this file does not invent geometry.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { DRAWER_ALIASES, DRAWER_IDS, resolveDrawer } from "./painters.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));

export function itemsFromSlide(slide) {
  if (Array.isArray(slide.items) && slide.items.length) {
    return slide.items.map((item) =>
      Array.isArray(item) ? [String(item[0] || ""), String(item[1] || "")] : [String(item), ""],
    );
  }
  if (Array.isArray(slide.sections) && slide.sections.length) {
    return slide.sections.map((section) => [
      String(section.heading || section.title || ""),
      String(section.detail || section.body || ""),
    ]);
  }
  const bullets = slide.bullets || slide.points || [];
  if (Array.isArray(bullets) && bullets.length) {
    return bullets.map((bullet) => [String(bullet), ""]);
  }
  if (slide.content) return [[String(slide.title || ""), String(slide.content)]];
  return [[String(slide.title || ""), String(slide.subtitle || "")]];
}

export function pagesFromContent(content, plan) {
  const slides = content.pages || content.slides || [];
  const decisions = plan?.slides || [];
  return slides.map((slide, index) => {
    const decision = decisions[index] || {};
    const signature =
      slide.signature ||
      decision.variant_selected ||
      decision.visual_signature ||
      "editorial-grid";
    const { id } = resolveDrawer(signature);
    const items = itemsFromSlide(slide);
    if (items.length <= 1 && (slide.subtitle || "").split(/[·|｜]/).filter((part) => part.trim()).length >= 3) {
      const parts = slide.subtitle.split(/[·|｜]/).map((part) => part.trim()).filter(Boolean);
      items.splice(0, items.length, ...parts.slice(0, 4).map((part) => [part, ""]));
    }
    return {
      slide: index + 1,
      total: slides.length,
      signature: id,
      requestedSignature: signature,
      dark: Boolean(slide.dark) || index === 0,
      title: slide.title || content.title || "",
      subtitle: slide.subtitle || "",
      eyebrow: slide.eyebrow,
      items,
      chart: slide.chart || null,
      metrics: slide.metrics || null,
      source: slide.source || "",
    };
  });
}

export function buildProgram(pages) {
  const payload = JSON.stringify({ pages }, null, 2);
  return `const deck = ${payload};

export const generationMode = "free_composition";
export const family = "deck";
export const variant = "skill-free-composition-drawers";

export async function build(PowerPoint, data = {}, runtime = {}) {
  const { paintPage } = await import(new URL("./painters.mjs", import.meta.url));
  await PowerPoint.run(async (context) => {
    context.presentation.pageSetup.slideWidth = 960;
    context.presentation.pageSetup.slideHeight = 540;
    const count = context.presentation.slides.getCount();
    await context.sync();
    if (count.value !== 0) throw new Error("expected an empty presentation");
    for (let index = 0; index < deck.pages.length; index += 1) {
      context.presentation.slides.add();
    }
    await context.sync();
    for (const page of deck.pages) {
      const slide = context.presentation.slides.getItemAt(page.slide - 1);
      paintPage(slide, page);
    }
    await context.sync();
  });
}
`;
}

export async function assembleFreeDeck({ content, plan, outDir }) {
  const pages = pagesFromContent(content, plan);
  if (!pages.length) throw new Error("free-composition assemble: no pages");
  const source = buildProgram(pages);
  if (outDir) {
    await fs.mkdir(outDir, { recursive: true });
    await fs.writeFile(path.join(outDir, "generated.mjs"), source);
    await fs.writeFile(path.join(outDir, "content.json"), `${JSON.stringify({ pages }, null, 2)}\n`);
    await copySkillFiles(outDir);
  }
  return { pages, source, drawers: DRAWER_IDS, aliases: DRAWER_ALIASES };
}

async function copySkillFiles(outDir) {
  for (const relative of [
    "painters.mjs",
    "registry.json",
    "chart/trend-line-with-takeaway.mjs",
    "chart/kpi-plus-column.mjs",
    "chart/share-donut-with-callouts.mjs",
    "chart/dual-panel-chart-analysis.mjs",
  ]) {
    const from = path.join(HERE, relative);
    const to = path.join(outDir, relative);
    await fs.mkdir(path.dirname(to), { recursive: true });
    await fs.copyFile(from, to);
  }
}

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || !value) throw new Error(`invalid argument near ${key ?? "<end>"}`);
    values[key.slice(2)] = value;
  }
  return values;
}

const isMain = process.argv.includes("--content");
if (isMain) {
  const args = parseArgs(process.argv.slice(2));
  const content = JSON.parse(await fs.readFile(args.content, "utf8"));
  const plan = args.plan ? JSON.parse(await fs.readFile(args.plan, "utf8")) : { slides: [] };
  const outDir = args.out || path.join(process.cwd(), "build/aippt-free-composition");
  const result = await assembleFreeDeck({ content, plan, outDir });
  process.stdout.write(`${JSON.stringify({ outDir, slides: result.pages.length, signatures: result.pages.map((page) => page.signature) })}\n`);
}
