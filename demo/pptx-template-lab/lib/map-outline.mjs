import { pickSourceSlide } from "./page-types.mjs";

const ORDER = [
  "cover",
  "closing",
  "section-divider",
  "team",
  "partners",
  "pricing",
  "kpi",
  "parallel-6",
  "parallel-4",
  "parallel-3",
  "split-image",
  "content",
];

export function mapOutlineToPages(outline, pageTypes) {
  const slides = outline?.slides || [];
  const warnings = [];
  const mapping = slides.map((slide, index) => {
    const guessed = guessKind(slide, index, slides.length, pageTypes);
    const usedFallback = guessed.fallback;
    if (usedFallback) {
      warnings.push({
        code: "no-exact-page-type",
        slide: index + 1,
        detail: `outline "${slide.purpose}" has no exact page type; using ${guessed.pageKind} from template slide ${guessed.sourceSlide}`,
      });
    }
    return {
      outlineIndex: index + 1,
      purpose: slide.purpose,
      bullets: slide.bullets || [],
      pageKind: guessed.pageKind,
      sourceSlide: guessed.sourceSlide,
      fallback: usedFallback,
      jsFallback: guessed.jsFallback || false,
    };
  });
  const used = {};
  for (const row of mapping) {
    const n = used[row.pageKind] || 0;
    const picked = pickSourceSlide(pageTypes, row.pageKind, n);
    if (picked) row.sourceSlide = picked;
    used[row.pageKind] = n + 1;
  }
  return { mapping, warnings };
}

export function guessKind(slide, index, total, pageTypes) {
  const has = (kind) => Boolean(pageTypes?.[kind]?.sourceSlides?.length);
  const text = `${slide.purpose || ""} ${(slide.bullets || []).join(" ")}`.toLowerCase();
  const n = (slide.bullets || []).length;
  if (index === 0 && has("cover")) return take("cover", pageTypes);
  if (index === total - 1 && has("closing")) return take("closing", pageTypes);
  if (has("section-divider") && /section|chapter|分隔|章节|关于我们$|我们的服务$|我们的业务$|我们的目标$/.test(text) && n <= 1) {
    return take("section-divider", pageTypes);
  }
  if (has("team") && /team|团队/.test(text)) return take("team", pageTypes);
  if (has("partners") && /partner|伙伴|客户/.test(text)) return take("partners", pageTypes);
  if (has("pricing") && /pric|定价|价格/.test(text)) return take("pricing", pageTypes);
  if (has("kpi") && /kpi|指标|市场地位|百分比|%/.test(text)) return take("kpi", pageTypes);
  if (n >= 6 && has("parallel-6")) return take("parallel-6", pageTypes);
  if (n >= 4 && has("parallel-4")) return take("parallel-4", pageTypes);
  if (n === 3 && has("parallel-3")) return take("parallel-3", pageTypes);
  if (has("split-image") && /image|图|介绍/.test(text) && n <= 2) return take("split-image", pageTypes);
  if (has("content")) return take("content", pageTypes);
  return closestPageType(n, pageTypes);
}

function take(kind, pageTypes) {
  return { pageKind: kind, sourceSlide: pageTypes[kind].sourceSlides[0], fallback: false };
}

export function closestPageType(bulletCount, pageTypes) {
  const wanted = bulletCount >= 6 ? ["parallel-6", "parallel-4", "parallel-3", "content"]
    : bulletCount >= 4 ? ["parallel-4", "parallel-3", "content"]
      : bulletCount === 3 ? ["parallel-3", "parallel-4", "content"]
        : ["content", "split-image", "section-divider", "parallel-3"];
  for (const kind of wanted) {
    if (pageTypes[kind]?.sourceSlides?.length) {
      return { pageKind: kind, sourceSlide: pageTypes[kind].sourceSlides[0], fallback: true };
    }
  }
  for (const kind of ORDER) {
    if (pageTypes[kind]?.sourceSlides?.length && kind !== "cover" && kind !== "closing") {
      return { pageKind: kind, sourceSlide: pageTypes[kind].sourceSlides[0], fallback: true };
    }
  }
  return { pageKind: "js-fallback", sourceSlide: null, fallback: true, jsFallback: true };
}
