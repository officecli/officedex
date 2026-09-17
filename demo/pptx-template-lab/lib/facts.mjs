const EMU_PER_PT = 12700;
const MAX_TEXT_BOXES = 12;
const MAX_TEXT_CHARS = 80;
const MAX_PICTURES = 8;

export function extractFacts(root) {
  const facts = {
    version: 1,
    pageCount: 0,
    canvas: { widthPt: 0, heightPt: 0 },
    theme: { colors: {}, majorFont: "", minorFont: "" },
    palette: [],
    fonts: [],
    textCount: 0,
    slides: [],
    warnings: [],
  };
  const blocks = Array.isArray(root?.blocks) ? root.blocks : [];
  let slides = [];
  for (const block of blocks) {
    if (block.type === "presentation") {
      const size = asMap(asMap(block.attrs).slideSize);
      facts.canvas = { widthPt: emuToPt(num(size.width)), heightPt: emuToPt(num(size.height)) };
    } else if (block.type === "themes") {
      facts.theme = themeFromBlock(block);
    } else if (block.type === "slides") {
      slides = Array.isArray(block.data) ? block.data : [];
    }
  }
  facts.slides = slides
    .filter((slide) => !slide.type || slide.type === "slide")
    .map((slide, index) => slideFact(index + 1, slide, facts.theme));
  facts.pageCount = facts.slides.length;
  facts.palette = palette(facts);
  facts.fonts = fonts(facts);
  facts.textCount = facts.slides.reduce((n, slide) => n + slide.texts.length, 0);
  if (!facts.pageCount) facts.warnings.push("page-count-not-detected");
  if (!facts.palette.length) facts.warnings.push("palette-empty");
  if (!facts.textCount) facts.warnings.push("no-text-extracted");
  return facts;
}

function slideFact(index, slide, theme) {
  const attrs = asMap(slide.attrs);
  const fact = {
    index,
    id: str(attrs.logicalId),
    layoutRef: str(attrs.layoutRef),
    texts: [],
    pictures: [],
  };
  walk(asArray(slide.data), { left: 0, top: 0, width: 0, height: 0 }, theme, fact);
  classifySlideTexts(fact);
  fact.pictures = fact.pictures.slice(0, MAX_PICTURES);
  return fact;
}

function walk(nodes, box, theme, slide) {
  for (const node of nodes) {
    const attrs = asMap(node.attrs);
    let next = box;
    const xf = asMap(attrs.transform);
    if (Object.keys(xf).length) next = transformFrom(xf);
    if (node.type === "picture") {
      const pic = {
        name: str(attrs.name),
        digest: digestFrom(attrs),
        left: next.left,
        top: next.top,
        width: next.width,
        height: next.height,
        logo: false,
      };
      pic.logo = looksLikeLogo(pic);
      slide.pictures.push(pic);
      continue;
    }
    if (node.type === "shape") {
      const text = collectText(node);
      if (text) {
        const run = firstRunProps(node);
        slide.texts.push({
          name: str(attrs.name),
          slotId: `s${slide.index}-t${slide.texts.length}`,
          left: next.left,
          top: next.top,
          width: next.width,
          height: next.height,
          sizePt: fontSizePt(run),
          font: fontFrom(run, theme),
          color: colorFrom(run, attrs, theme),
          align: alignFrom(node),
          text: clip(text, 200),
        });
      }
      continue;
    }
    walk(asArray(node.data), next, theme, slide);
  }
}

function collectText(node) {
  const parts = [];
  const visit = (n) => {
    if (n.type === "text") {
      if (typeof n.data === "string" && n.data.trim()) parts.push(n.data.trim());
      return;
    }
    for (const child of asArray(n.data)) visit(child);
  };
  visit(node);
  return parts.join(" ").trim();
}

function firstRunProps(node) {
  let found = null;
  const visit = (n) => {
    if (found) return;
    if (n.type === "run") {
      const props = asMap(asMap(n.attrs).runProperties);
      if (Object.keys(props).length) {
        found = props;
        return;
      }
    }
    for (const child of asArray(n.data)) visit(child);
  };
  visit(node);
  return found || {};
}

function themeFromBlock(block) {
  const theme = { colors: {}, majorFont: "", minorFont: "" };
  const visit = (n) => {
    const attrs = asMap(n.attrs);
    if (n.type === "colorScheme") {
      for (const [name, raw] of Object.entries(asMap(attrs.colors))) {
        const hex = colorValue(asMap(raw), null);
        if (hex) theme.colors[name] = hex;
      }
    }
    if (n.type === "fontScheme") {
      if (!theme.majorFont) theme.majorFont = schemeTypeface(asMap(attrs.majorFont));
      if (!theme.minorFont) theme.minorFont = schemeTypeface(asMap(attrs.minorFont));
    }
    for (const child of asArray(n.data)) visit(child);
  };
  for (const item of asArray(block.data)) visit(item);
  return theme;
}

function transformFrom(xf) {
  const off = asMap(xf.offset);
  const ext = asMap(xf.extent);
  return {
    left: emuToPt(num(off.x)),
    top: emuToPt(num(off.y)),
    width: emuToPt(num(ext.cx)),
    height: emuToPt(num(ext.cy)),
  };
}

function digestFrom(attrs) {
  return str(asMap(attrs.resource).digest).replace(/^sha256:/u, "");
}

function fontSizePt(run) {
  const size = num(run.fontSize);
  if (size <= 0) return 0;
  return size > 200 ? size / 100 : size;
}

function fontFrom(run, theme) {
  for (const key of ["eastAsianFont", "latinFont"]) {
    const name = typeface(asMap(run[key]));
    if (name) return name;
  }
  return theme.minorFont || theme.majorFont || "";
}

function colorFrom(run, shapeAttrs, theme) {
  return colorValue(asMap(run.fill), theme.colors) || colorValue(asMap(shapeAttrs.fill), theme.colors);
}

function colorValue(fill, scheme) {
  const color = asMap(fill.color);
  const src = Object.keys(color).length ? color : fill;
  const kind = str(src.colorKind);
  const value = str(src.value);
  if (kind === "srgb" && value) return "#" + value.replace(/^#/u, "").toUpperCase();
  if (value && scheme) return schemeColor(value, scheme);
  return "";
}

function schemeColor(name, scheme) {
  const aliases = { tx1: "dark1", tx2: "dark2", bg1: "light1", bg2: "light2", dk1: "dark1", dk2: "dark2", lt1: "light1", lt2: "light2" };
  const key = aliases[name.toLowerCase()] || name;
  return scheme[key] || "";
}

function schemeTypeface(font) {
  return typeface(asMap(font.eastAsianFont)) || typeface(asMap(font.latinFont)) || typeface(font);
}

function typeface(font) {
  const name = str(font.typeface);
  return !name || name.startsWith("+") ? "" : name;
}

function alignFrom(node) {
  let align = "";
  const visit = (n) => {
    if (align) return;
    const attrs = asMap(n.attrs);
    const body = asMap(attrs.bodyProperties);
    align = normalizeAlign(str(body.anchor) || str(attrs.paragraphAlignment));
    if (align) return;
    for (const child of asArray(n.data)) visit(child);
  };
  visit(node);
  return align;
}

function normalizeAlign(value) {
  const v = value.toLowerCase();
  if (v === "ctr" || v === "center") return "center";
  if (v === "r" || v === "right") return "right";
  if (v === "l" || v === "left") return "left";
  return "";
}

function looksLikeLogo(pic) {
  if (pic.name.toLowerCase().includes("logo")) return true;
  return pic.top < 80 && pic.left < 120 && pic.width > 0 && pic.width < 220 && pic.height > 0 && pic.height < 80;
}

function palette(facts) {
  const seen = new Set();
  const out = [];
  const add = (hex) => {
    hex = String(hex || "").trim().toUpperCase();
    if (!hex) return;
    if (!hex.startsWith("#")) hex = "#" + hex;
    if (seen.has(hex)) return;
    seen.add(hex);
    out.push(hex);
  };
  for (const key of ["dark1", "accent1", "accent2", "light1", "hyperlink"]) add(facts.theme.colors[key]);
  for (const hex of Object.values(facts.theme.colors)) add(hex);
  for (const slide of facts.slides) {
    for (const text of slide.texts) add(text.color);
  }
  return out.sort();
}

function fonts(facts) {
  const seen = new Set();
  const out = [];
  const add = (name) => {
    name = String(name || "").trim();
    if (!name || seen.has(name)) return;
    seen.add(name);
    out.push(name);
  };
  add(facts.theme.majorFont);
  add(facts.theme.minorFont);
  for (const slide of facts.slides) {
    for (const text of slide.texts) add(text.font);
  }
  return out.sort();
}

function emuToPt(value) {
  return value ? value / EMU_PER_PT : 0;
}

function asMap(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function str(value) {
  return typeof value === "string" ? value.trim() : "";
}

function num(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function classifySlideTexts(slide) {
  const pageH = 540;
  slide.texts.forEach((box, index) => {
    box.slotId = box.slotId || `s${slide.index}-t${index}`;
    const sample = String(box.text || "").trim();
    const size = box.sizePt < 10 ? 12 : box.sizePt;
    const cjk = /[\u3400-\u9fff]/.test(sample);
    box.maxChars = Math.min(160, Math.max(8, Math.round((box.width || 120) / size * (cjk ? 1.7 : 2.2))));
    if (/汇报人|姓名/.test(sample)) {
      box.role = "presenter";
      box.replaceable = true;
      return;
    }
    if (/^(page\s*)?\d+(\s*\/\s*\d+)?$/i.test(sample) || (box.top < 40 && box.left < 50 && box.width < 40 && /^\d+$/.test(sample))) {
      box.role = "page-number";
      box.replaceable = false;
      return;
    }
    if (box.top > pageH * 0.9 && size < 12) {
      box.role = "footer";
      box.replaceable = false;
      return;
    }
    if (sample === "公司名字" || (box.top < 50 && box.left < 90 && box.width < 90 && size <= 18 && sample.length <= 8)) {
      box.role = "brand";
      box.replaceable = true;
      return;
    }
    box.role = "body";
    box.replaceable = [...sample].length >= 2;
  });
  const candidates = slide.texts.filter((box) => box.replaceable && box.role !== "brand" && box.role !== "presenter");
  const bySize = [...candidates].sort((a, b) => (b.sizePt || 0) - (a.sizePt || 0));
  if (bySize[0] && bySize[0].sizePt >= 24) bySize[0].role = "title";
  if (bySize[1] && bySize[1].sizePt >= 18 && bySize[1].sizePt < (bySize[0].sizePt || 0) - 4) {
    bySize[1].role = "subtitle";
  }
}

function clip(text, limit) {
  const runes = [...String(text).replace(/\s+/gu, " ").trim()];
  return runes.length <= limit ? runes.join("") : runes.slice(0, limit).join("") + "…";
}
