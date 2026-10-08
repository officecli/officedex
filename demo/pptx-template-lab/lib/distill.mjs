import { handbookFromFacts, renderHandbookMarkdown } from "./handbook.mjs";

export function distillFromFacts(facts) {
  const visualProfile = profileFromFacts(facts);
  const layouts = layoutsFromFacts(facts);
  const distilled = {
    visualProfile,
    layouts,
    skillRules: {
      version: 1,
      status: "inferred",
      source: "mop-facts",
    },
    capabilities: {
      supported: ["text", "basic-shape", "image"],
      fallback: ["chart", "smartart"],
      warnings: facts.warnings || [],
    },
    source: "mop-facts",
    handbook: handbookFromFacts(facts),
    warnings: facts.warnings || [],
  };
  distilled.skillMarkdown = renderHandbookMarkdown(distilled.handbook);
  return distilled;
}

function profileFromFacts(facts) {
  const color = (...keys) => {
    for (const key of keys) {
      if (facts.theme?.colors?.[key]) return facts.theme.colors[key];
    }
    return facts.palette?.[0] || "";
  };
  const titleFont = facts.theme?.majorFont || facts.fonts?.[0] || "";
  const bodyFont = facts.theme?.minorFont || titleFont;
  const { title, body } = typicalSizes(facts);
  return {
    version: 1,
    source: "mop-facts",
    confidence: "observed",
    primary: color("accent1", "dark1"),
    secondary: color("accent2", "accent3"),
    text: color("dark1", "dark2"),
    background: color("light1", "light2"),
    palette: facts.palette,
    fonts: {
      title: { name: titleFont, sizePt: title },
      body: { name: bodyFont, sizePt: body },
    },
    fontFamilies: facts.fonts,
    pageCount: facts.pageCount,
    canvas: facts.canvas,
  };
}

function typicalSizes(facts) {
  const sizes = [];
  for (const slide of facts.slides || []) {
    for (const text of slide.texts || []) {
      if (text.sizePt > 0) sizes.push(text.sizePt);
    }
  }
  if (!sizes.length) return { title: 28, body: 14 };
  sizes.sort((a, b) => a - b);
  const body = sizes[Math.floor(sizes.length / 2)];
  const title = Math.max(sizes[sizes.length - 1], body);
  return { title, body };
}

function layoutsFromFacts(facts) {
  const groups = new Map();
  for (const slide of facts.slides || []) {
    const key = `${bucket(slide.texts.length)}:${bucket(slide.pictures.length)}`;
    if (!groups.has(key)) groups.set(key, { texts: bucket(slide.texts.length), pictures: bucket(slide.pictures.length), slides: [] });
    groups.get(key).slides.push(slide.index);
  }
  const layouts = [];
  for (const group of groups.values()) {
    const guessed = layoutGuess(group.texts, group.pictures);
    layouts.push({
      ...guessed,
      sourceSlides: group.slides,
      source: "mop-facts",
      status: "inferred",
      clonePlan: "structured",
    });
  }
  return layouts.length
    ? layouts
    : [{ layoutId: "text-summary", contentRelation: "single-conclusion", roles: ["title", "body"], source: "mop-facts", status: "inferred", clonePlan: "structured" }];
}

function bucket(n) {
  if (n <= 0) return 0;
  if (n === 1) return 1;
  if (n <= 3) return 2;
  return 3;
}

function layoutGuess(textBucket, pictureBucket) {
  if (pictureBucket > 0 && textBucket <= 1) {
    return { layoutId: "image-with-callout", contentRelation: "single-conclusion", roles: ["title", "image", "callout"] };
  }
  if (textBucket >= 3) {
    return { layoutId: "parallel-blocks", contentRelation: "parallel", roles: ["title", "repeated-block", "body"] };
  }
  if (textBucket <= 1) {
    return { layoutId: "cover-statement", contentRelation: "single-conclusion", roles: ["title", "subtitle"] };
  }
  return { layoutId: "text-summary", contentRelation: "single-conclusion", roles: ["title", "body"] };
}

export function compactFacts(facts) {
  return {
    pageCount: facts.pageCount,
    palette: facts.palette,
    fonts: facts.fonts,
    canvas: facts.canvas,
    slides: (facts.slides || []).map((slide) => ({
      index: slide.index,
      title: slide.texts?.[0]?.text || "",
      texts: slide.texts?.length || 0,
      pictures: slide.pictures?.length || 0,
    })),
  };
}
