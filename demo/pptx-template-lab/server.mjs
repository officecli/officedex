#!/usr/bin/env node
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractFacts } from "./lib/facts.mjs";
import { distillFromFacts } from "./lib/distill.mjs";
import { handbookFromFacts, mergeHandbook, renderHandbookMarkdown } from "./lib/handbook.mjs";
import { applyFills, applyPageNumbers, overflowWarnings } from "./lib/fill.mjs";
import { completeJson, loadLabLlmConfig } from "./lib/llm.mjs";
import { pageTypesFromHandbook, remapSlots } from "./lib/page-types.mjs";
import { mapOutlineToPages } from "./lib/map-outline.mjs";
import { cloneMappedSlides } from "./lib/clone.mjs";
import { buildFallbackSlide } from "./lib/fallback.mjs";
import { exportMopDirectory, importPptxFile } from "../../../presentation/tools/lib/mop-converter-client.mjs";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, "public");
const WORK = path.join(ROOT, "work");
const PORT = Number(process.env.PPTX_LAB_PORT || 4177);

const session = {
  template: null,
  generate: null,
};

function nowIso() {
  return new Date().toISOString();
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function listMedia(mopDir) {
  const mediaDir = path.join(mopDir, "media");
  try {
    const names = await fs.readdir(mediaDir);
    const out = [];
    for (const name of names) {
      const st = await fs.stat(path.join(mediaDir, name));
      if (st.isFile()) out.push({ name, size: st.size, url: `/api/file?path=${encodeURIComponent(path.join("template", "source.mop", "media", name))}` });
    }
    return out;
  } catch {
    return [];
  }
}

function publicSession() {
  return {
    template: session.template,
    generate: session.generate,
  };
}

const routes = {
  "GET /api/status": async () => {
    const llm = await loadLabLlmConfig();
    return { ok: true, llm: { ready: llm.ready, model: llm.model, baseUrl: llm.baseUrl }, session: publicSession() };
  },

  "POST /api/import/upload": async (req) => {
    await fs.rm(WORK, { recursive: true, force: true });
    await fs.mkdir(path.join(WORK, "template"), { recursive: true });
    const filename = decodeURIComponent(String(req.headers["x-filename"] || "source.pptx"));
    const dest = path.join(WORK, "template", "source.pptx");
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const buf = Buffer.concat(chunks);
    if (!buf.length) throw Object.assign(new Error("empty upload"), { status: 400 });
    await fs.writeFile(dest, buf);
    session.template = {
      name: filename.replace(/\.pptx$/iu, ""),
      sourceFileName: filename,
      bytes: buf.length,
      dir: path.join(WORK, "template"),
      steps: { upload: { status: "done", at: nowIso(), detail: `${buf.length} bytes` } },
    };
    session.generate = null;
    return { ok: true, session: publicSession() };
  },

  "POST /api/import/convert": async () => {
    if (!session.template) throw Object.assign(new Error("upload a PPTX first"), { status: 400 });
    const mopDir = path.join(session.template.dir, "source.mop");
    await fs.rm(mopDir, { recursive: true, force: true });
    const started = Date.now();
    await importPptxFile(path.join(session.template.dir, "source.pptx"), mopDir);
    session.template.steps.convert = { status: "done", at: nowIso(), elapsedMs: Date.now() - started, detail: mopDir };
    return { ok: true, session: publicSession() };
  },

  "POST /api/import/facts": async () => {
    if (!session.template?.steps.convert) throw Object.assign(new Error("convert first"), { status: 400 });
    const mopDir = path.join(session.template.dir, "source.mop");
    const started = Date.now();
    const root = await readJson(path.join(mopDir, "content.json"));
    const facts = extractFacts(root);
    const distilled = distillFromFacts(facts);
    await writeJson(path.join(session.template.dir, "template-facts.json"), facts);
    await writeJson(path.join(session.template.dir, "visual-profile.json"), distilled.visualProfile);
    await writeJson(path.join(session.template.dir, "layout-library.json"), { version: 1, layouts: distilled.layouts });
    await writeJson(path.join(session.template.dir, "slots.json"), { version: 1, slides: facts.slides.map((slide) => ({ index: slide.index, slots: slide.texts || [] })) });
    await fs.mkdir(path.join(session.template.dir, "skill"), { recursive: true });
    await writeJson(path.join(session.template.dir, "skill", "handbook.json"), distilled.handbook);
    await writeJson(path.join(session.template.dir, "page-types.json"), pageTypesFromHandbook(distilled.handbook));
    await fs.writeFile(path.join(session.template.dir, "skill", "SKILL.md"), distilled.skillMarkdown);
    const media = await listMedia(mopDir);
    session.template.facts = facts;
    session.template.distilled = distilled;
    session.template.media = media;
    session.template.steps.facts = {
      status: "done",
      at: nowIso(),
      elapsedMs: Date.now() - started,
      detail: `${facts.pageCount} pages, ${facts.textCount} texts, ${facts.palette.length} colors`,
    };
    return { ok: true, session: publicSession() };
  },

  "POST /api/import/distill-llm": async () => {
    if (!session.template?.facts) throw Object.assign(new Error("extract facts first"), { status: 400 });
    const started = Date.now();
    const facts = session.template.facts;
    const distilled = session.template.distilled;
    const base = distilled.handbook || handbookFromFacts(facts);
    const catalog = (facts.slides || []).map((slide) => ({
      index: slide.index,
      slots: (slide.texts || []).filter((box) => box.replaceable).map((box) => ({
        slotId: box.slotId, role: box.role, maxChars: box.maxChars, sample: box.text,
      })),
    }));
    const result = await completeJson(
      JSON.stringify({ catalog }),
      "All handbook text MUST be English. Return JSON {handbook:{globals:[{id,fillWith,slotIds}],pages:[{index,pageKind,purpose,modules:[{id,kind,items:[{index,titleSlot,bodySlot}]}],slots:[{slotId,role,fillWith,dataKind}]}]}}. pageKind is cover|section-divider|parallel-3|parallel-4|parallel-6|team|partners|pricing|kpi|split-image|content. role uses names like cover.title, card[1].title, brand.name. Keep every slotId. No DO/DONT rules.",
    );
    distilled.handbook = mergeHandbook(base, result.handbook || result);
    distilled.skillMarkdown = renderHandbookMarkdown(distilled.handbook);
    distilled.source = "llm";
    await writeJson(path.join(session.template.dir, "skill", "handbook.json"), distilled.handbook);
    await fs.writeFile(path.join(session.template.dir, "skill", "SKILL.md"), distilled.skillMarkdown);
    session.template.steps.distillLlm = { status: "done", at: nowIso(), elapsedMs: Date.now() - started };
    return { ok: true, session: publicSession() };
  },

  "POST /api/generate/outline": async (_req, body) => {
    if (!session.template?.distilled?.handbook) throw Object.assign(new Error("import a template first"), { status: 400 });
    const prompt = String(body.prompt || "").trim();
    if (!prompt) throw Object.assign(new Error("prompt is required"), { status: 400 });
    const started = Date.now();
    const outline = body.outline || await completeJson(
      `User request: ${prompt}\nReturn JSON {title,brandName,slides:[{purpose,bullets:[]}]}. One slide per outline item. English keys, Chinese values. Do not match template page count.`,
      "Return JSON {title,brandName,slides}.",
    );
    session.generate = {
      prompt,
      outline,
      steps: { outline: { status: "done", at: nowIso(), elapsedMs: Date.now() - started, detail: `${outline.slides?.length || 0} outline slides` } },
    };
    await writeJson(path.join(WORK, "generate", "outline.json"), outline);
    return { ok: true, session: publicSession() };
  },

  "POST /api/generate/map": async () => {
    if (!session.generate?.outline) throw Object.assign(new Error("outline first"), { status: 400 });
    const started = Date.now();
    const pageTypes = pageTypesFromHandbook(session.template.distilled.handbook);
    const mapped = mapOutlineToPages(session.generate.outline, pageTypes);
    session.generate.mapping = mapped.mapping;
    session.generate.mapWarnings = mapped.warnings;
    session.generate.steps.map = { status: "done", at: nowIso(), elapsedMs: Date.now() - started, detail: mapped.mapping.map((row) => row.pageKind).join(" → ") };
    await writeJson(path.join(WORK, "generate", "mapping.json"), mapped);
    return { ok: true, session: publicSession() };
  },

  "POST /api/generate/clone": async () => {
    if (!session.generate?.mapping) throw Object.assign(new Error("map first"), { status: 400 });
    const started = Date.now();
    const mop = await readJson(path.join(session.template.dir, "source.mop", "content.json"));
    const extras = [];
    for (const [index, row] of session.generate.mapping.entries()) {
      if (row.jsFallback) {
        extras[index] = await buildFallbackSlide(session.template.distilled.visualProfile, { ...row, ...session.generate.outline.slides[index] }, path.join(WORK, "generate"));
      }
    }
    cloneMappedSlides(mop, session.generate.mapping, extras);
    const dest = path.join(WORK, "generate", "cloned.mop");
    await fs.rm(dest, { recursive: true, force: true });
    await fs.cp(path.join(session.template.dir, "source.mop"), dest, { recursive: true });
    await writeJson(path.join(dest, "content.json"), mop);
    session.generate.clonedPages = assembled.length;
    session.generate.steps.clone = { status: "done", at: nowIso(), elapsedMs: Date.now() - started, detail: `${assembled.length} cloned slides` };
    return { ok: true, session: publicSession() };
  },

  "POST /api/generate/plan": async () => {
    if (!session.generate?.steps.clone) throw Object.assign(new Error("clone first"), { status: 400 });
    const started = Date.now();
    const handbook = session.template.distilled.handbook;
    const catalog = session.generate.mapping.map((row, i) => {
      const srcPage = handbook.pages.find((page) => page.index === row.sourceSlide);
      return { newIndex: i + 1, ...row, slots: remapSlots(srcPage || { index: row.sourceSlide, slots: [] }, i + 1) };
    });
    const result = await completeJson(
      JSON.stringify({ brief: session.generate.prompt, brandName: session.generate.outline.brandName, catalog }),
      "Return JSON {fills:[{slotId,text}]}. Chinese copy. slotId uses the NEW index. Fill EVERY slot. Respect maxChars/maxLines. Do not invent partners or prices not in the brief. Combined cards need title plus short features. Never copy placeholders.",
    );
    const fills = Array.isArray(result.fills) ? result.fills : [];
    const brand = session.generate.outline.brandName || "";
    if (brand) {
      for (const page of catalog) {
        for (const slot of page.slots || []) {
          if (slot.role === "brand.name") fills.push({ slotId: slot.slotId, text: brand });
        }
      }
    }
    const overflow = overflowWarnings(fills, catalog.flatMap((page) => page.slots || []));
    session.generate.fills = fills;
    session.generate.warnings = [...(session.generate.mapWarnings || []), ...overflow];
    session.generate.steps.plan = { status: "done", at: nowIso(), elapsedMs: Date.now() - started, detail: `${fills.length} fills` };
    await writeJson(path.join(WORK, "generate", "fills.json"), { fills, warnings: session.generate.warnings, catalog });
    return { ok: true, session: publicSession() };
  },

  "POST /api/generate/write-mjs": async () => {
    if (!session.generate?.fills) throw Object.assign(new Error("fills first"), { status: 400 });
    const started = Date.now();
    const dest = path.join(WORK, "generate", "cloned.mop");
    const mop = await readJson(path.join(dest, "content.json"));
    applyFills(mop, session.generate.fills);
    applyPageNumbers(mop);
    await writeJson(path.join(dest, "content.json"), mop);
    session.generate.steps.writeMjs = { status: "done", at: nowIso(), elapsedMs: Date.now() - started, detail: "filled cloned mop" };
    return { ok: true, session: publicSession() };
  },

  "POST /api/generate/execute": async () => {
    if (!session.generate?.steps.writeMjs) throw Object.assign(new Error("apply fills first"), { status: 400 });
    const started = Date.now();
    const outPath = path.join(WORK, "generate", "filled.pptx");
    await exportMopDirectory(path.join(WORK, "generate", "cloned.mop"), outPath);
    session.generate.pptxUrl = "/api/file?path=" + encodeURIComponent(path.join("generate", "filled.pptx"));
    session.generate.steps.execute = { status: "done", at: nowIso(), elapsedMs: Date.now() - started, detail: `${session.generate.clonedPages} page deck` };
    return { ok: true, session: publicSession() };
  },
};

function send(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(body);
}

function mimeFor(filePath) {
  if (filePath.endsWith(".png")) return "image/png";
  if (filePath.endsWith(".jpg") || filePath.endsWith(".jpeg")) return "image/jpeg";
  if (filePath.endsWith(".svg")) return "image/svg+xml";
  if (filePath.endsWith(".pptx")) return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
  if (filePath.endsWith(".json")) return "application/json; charset=utf-8";
  if (filePath.endsWith(".md") || filePath.endsWith(".mjs")) return "text/plain; charset=utf-8";
  return "application/octet-stream";
}

async function serveFile(req, res) {
  const url = new URL(req.url, "http://127.0.0.1");
  const rel = url.searchParams.get("path") || "";
  const abs = path.resolve(WORK, rel);
  if (!abs.startsWith(WORK)) {
    send(res, 400, { error: "invalid path" });
    return;
  }
  try {
    const data = await fs.readFile(abs);
    res.writeHead(200, { "content-type": mimeFor(abs), "content-disposition": rel.endsWith(".pptx") ? `attachment; filename="${path.basename(abs)}"` : "inline" });
    res.end(data);
  } catch {
    send(res, 404, { error: "not found" });
  }
}

async function serveStatic(req, res) {
  const url = new URL(req.url, "http://127.0.0.1");
  let rel = url.pathname === "/" ? "/index.html" : url.pathname;
  const abs = path.resolve(PUBLIC, rel.slice(1));
  if (!abs.startsWith(PUBLIC)) {
    res.writeHead(400);
    res.end("invalid");
    return;
  }
  try {
    const data = await fs.readFile(abs);
    const type = abs.endsWith(".html") ? "text/html; charset=utf-8" : abs.endsWith(".css") ? "text/css" : "text/plain";
    res.writeHead(200, { "content-type": type });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end("not found");
  }
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  return raw ? JSON.parse(raw) : {};
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://127.0.0.1");
    if (req.method === "GET" && url.pathname === "/api/file") {
      await serveFile(req, res);
      return;
    }
    const key = `${req.method} ${url.pathname}`;
    if (routes[key]) {
      const body = req.method === "POST" && url.pathname !== "/api/import/upload" ? await readBody(req) : {};
      const value = await routes[key](req, body);
      send(res, 200, value);
      return;
    }
    if (req.method === "GET") {
      await serveStatic(req, res);
      return;
    }
    send(res, 404, { error: "not found" });
  } catch (error) {
    send(res, error.status || 500, { error: error.message || String(error) });
  }
});

await fs.mkdir(WORK, { recursive: true });
server.listen(PORT, "127.0.0.1", () => {
  console.log(`PPT template lab: http://127.0.0.1:${PORT}`);
});
