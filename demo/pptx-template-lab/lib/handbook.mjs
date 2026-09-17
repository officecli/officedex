const BRAND_SAMPLE = /^(公司名字|公司名称|company\s*name)$/i;
const PLACEHOLDER_BODY = /这是一段文字|you can add any text/i;

export function handbookFromFacts(facts) {
  const brandIds = collectBrandSlotIds(facts);
  const pages = (facts.slides || []).map((slide) => buildPage(slide, brandIds));
  const globals = [];
  if (brandIds.length) {
    globals.push({
      id: "brand.name",
      fillWith: "Company / organization name (same value on every listed slot)",
      dataKind: "org-name",
      slotIds: brandIds,
    });
  }
  return { version: 1, source: "mop-slots", language: "en", globals, pages };
}

function collectBrandSlotIds(facts) {
  const ids = [];
  for (const slide of facts.slides || []) {
    for (const box of slide.texts || []) {
      if (box.role === "brand" || BRAND_SAMPLE.test(String(box.text || "").trim())) ids.push(box.slotId);
    }
  }
  return ids;
}

function buildPage(slide, brandIds) {
  const brand = new Set(brandIds);
  const keep = [];
  const slots = [];
  for (const box of slide.texts || []) {
    if (!box.replaceable || box.role === "page-number" || box.role === "footer") {
      keep.push({ slotId: box.slotId, reason: box.role === "page-number" ? "page number" : "fixed chrome" });
      continue;
    }
    if (brand.has(box.slotId) || box.role === "brand") {
      slots.push(describeSlot(box, "brand.name", "org-name", "Company / organization name (global)"));
      continue;
    }
    slots.push(describeSlot(box, box.role || "body", inferDataKind(box), inferFillWith(box)));
  }
  const local = slots.filter((slot) => slot.role !== "brand.name");
  let title = local.find((slot) => slot.role === "title");
  title = fixClosingTitle(slide, local, title);
  markOverview(slide, local, title);
  const rest = local.filter((slot) => slot.slotId !== title?.slotId && slot.role !== "subtitle" && slot.role !== "presenter" && slot.role !== "overview" && slot.role !== "closing.kicker" && slot.role !== "closing.message");
  const useCards = detectCards(slide, rest);
  const pageKind = inferPageKind(slide, { title, cards: useCards, local });
  const modules = buildModules(pageKind, title, useCards, local);
  applyModuleRoles(slots, modules);
  return {
    index: slide.index,
    pageKind,
    purpose: purposeFor(pageKind, useCards.length),
    modules,
    slots: visualSort(slide, slots),
    keep,
  };
}

function fixClosingTitle(slide, local, title) {
  const kicker = local.find((slot) => /^thanks$/i.test(String(slot.sample || "").trim()));
  const message = local.find((slot) => /感谢/.test(slot.sample || ""));
  if (!kicker || !message) return title;
  kicker.role = "closing.kicker";
  kicker.fillWith = "English kicker (keep or replace with Thanks)";
  kicker.dataKind = "kicker";
  message.role = "closing.message";
  message.fillWith = "Closing message";
  message.dataKind = "closing";
  return message;
}

function markOverview(slide, local, title) {
  const tbox = (slide.texts || []).find((box) => box.slotId === title?.slotId);
  if (!tbox) return;
  for (const slot of local) {
    if (slot.slotId === title.slotId) continue;
    if (/名字摆放处|职位摆放处/.test(slot.sample || "")) continue;
    const box = (slide.texts || []).find((item) => item.slotId === slot.slotId);
    if (!box) continue;
    const underTitle = box.top > tbox.top && Math.abs(box.left - tbox.left) < 50 && box.width >= 200;
    if (underTitle && PLACEHOLDER_BODY.test(slot.sample) && box.sizePt && box.sizePt <= 16) {
      slot.role = "overview";
      slot.fillWith = "Section overview paragraph";
      slot.dataKind = "overview";
    }
  }
}

function detectCards(slide, rest) {
  const members = rest.filter((slot) => /名字摆放处|职位摆放处/.test(slot.sample || ""));
  if (members.length >= 2) {
    return orderCards(slide, members.map((slot) => ({ titleSlot: slot.slotId, bodySlot: null })));
  }
  const geo = pairCardsGeometric(slide, rest);
  if (geo.length >= 3) return orderCards(slide, geo);
  const tree = pairCards(rest);
  if (tree.length >= 3) return orderCards(slide, tree);
  const combined = rest.filter((slot) => /观点\d|案例\d|标题\s*\d*%/.test(slot.sample || "") || (PLACEHOLDER_BODY.test(slot.sample) && /^观点/.test(slot.sample)));
  if (combined.length >= 3) return orderCards(slide, combined.map((slot) => ({ titleSlot: slot.slotId, bodySlot: null })));
  return [];
}

function orderCards(slide, items) {
  const geo = new Map((slide.texts || []).map((box) => [box.slotId, box]));
  const decorated = items.map((item) => {
    const title = geo.get(item.titleSlot);
    const numbered = String(title?.text || "").match(/(?:标题|服务|观点|案例|文本|card)\s*(\d)/i);
    return {
      ...item,
      number: numbered ? Number(numbered[1]) : 0,
      top: title?.top || 0,
      left: title?.left || 0,
    };
  });
  decorated.sort((a, b) => {
    if (a.number && b.number && a.number !== b.number) return a.number - b.number;
    const dt = a.top - b.top;
    if (Math.abs(dt) > 24) return dt;
    return a.left - b.left;
  });
  return decorated.map((item, index) => ({
    index: index + 1,
    titleSlot: item.titleSlot,
    bodySlot: item.bodySlot || null,
  }));
}

function describeSlot(box, role, dataKind, fillWith) {
  return {
    slotId: box.slotId,
    role,
    fillWith,
    dataKind,
    maxChars: box.maxChars || 40,
    sample: box.text || "",
    top: box.top,
    left: box.left,
  };
}

function pairCardsGeometric(slide, slots) {
  const geo = new Map((slide.texts || []).map((box) => [box.slotId, box]));
  const heading = [];
  const body = [];
  for (const slot of slots) {
    if (isHeadingSample(slot)) heading.push(slot);
    else if (isBodySample(slot)) body.push(slot);
  }
  const lefts = heading.map((head) => (geo.get(head.slotId) || head).left || 0);
  if (heading.length >= 2 && Math.max(...lefts) - Math.min(...lefts) < 24) return [];
  const items = [];
  const used = new Set();
  const sorted = [...heading].sort((a, b) => {
    const ga = geo.get(a.slotId) || a;
    const gb = geo.get(b.slotId) || b;
    const dt = (ga.top || 0) - (gb.top || 0);
    if (Math.abs(dt) > 16) return dt;
    return (ga.left || 0) - (gb.left || 0);
  });
  for (const head of sorted) {
    const gh = geo.get(head.slotId) || head;
    let best = null;
    let bestScore = 1e9;
    for (const block of body) {
      if (used.has(block.slotId)) continue;
      const gb = geo.get(block.slotId) || block;
      const dl = Math.abs((gb.left || 0) - (gh.left || 0));
      const dt = (gb.top || 0) - (gh.top || 0);
      if (dt < -8 || dl > 80) continue;
      const score = dl + dt * 0.5;
      if (score < bestScore) {
        best = block;
        bestScore = score;
      }
    }
    if (best) {
      used.add(best.slotId);
      items.push({ index: items.length + 1, titleSlot: head.slotId, bodySlot: best.slotId });
    }
  }
  return items;
}

function equalBodyCards(slots, existing) {
  if (existing.length >= 3) return existing;
  const bodies = slots.filter((slot) => isBodySample(slot) || /观点\d|名字摆放处|标题\s*\d*%/.test(slot.sample || ""));
  if (bodies.length < 3) return existing;
  return bodies.map((slot, index) => ({ index: index + 1, titleSlot: slot.slotId, bodySlot: null }));
}

function pairCards(slots) {
  const items = [];
  const used = new Set();
  for (let i = 0; i < slots.length; i += 1) {
    if (used.has(i)) continue;
    const a = slots[i];
    const b = slots[i + 1];
    const aShort = isHeadingSample(a);
    const bLong = b && isBodySample(b);
    if (aShort && bLong) {
      items.push({ index: items.length + 1, titleSlot: a.slotId, bodySlot: b.slotId });
      used.add(i);
      used.add(i + 1);
      continue;
    }
  }
  return items;
}

function isHeadingSample(slot) {
  const sample = String(slot.sample || "").trim();
  if (PLACEHOLDER_BODY.test(sample)) return false;
  return sample.length <= 16 || /^(标题|服务|观点|案例|文本)\d*$/.test(sample) || /[服务标题案例文本]\d/.test(sample);
}

function isBodySample(slot) {
  const sample = String(slot.sample || "").trim();
  return PLACEHOLDER_BODY.test(sample) || sample.length > 18;
}

function inferPageKind(slide, { title, cards, local }) {
  const heading = String(title?.sample || local.map((s) => s.sample).join(" "));
  if (slide.index === 1) return "cover";
  if (slide.index >= 28 || /感谢|thanks/i.test(heading)) return "closing";
  const n = local.length;
  const pics = slide.pictures?.length || 0;
  if (/团队|team/i.test(heading) || cards.length === 3 && /名字摆放处/.test(local.map((s) => s.sample).join(""))) return "team";
  if (/伙伴|partner/i.test(heading) || /logo摆放处/.test(local.map((s) => s.sample).join(""))) return "partners";
  if (/定价|price/i.test(heading)) return "pricing";
  if (/%/.test(local.map((s) => s.sample).join("")) && cards.length === 0 && local.filter((s) => /%/.test(s.sample)).length >= 3) return "kpi";
  if (n <= 2 && pics >= 1) return "section-divider";
  if (cards.length >= 6) return "parallel-6";
  if (cards.length === 4) return "parallel-4";
  if (cards.length === 3) return "parallel-3";
  if (pics >= 1) return "split-image";
  return "content";
}

function buildModules(pageKind, title, cards, local) {
  const modules = [];
  if (title) modules.push({ id: "page-title", kind: "title", slots: [title.slotId] });
  if (cards.length >= 3) {
    modules.push({
      id: pageKind.startsWith("parallel") || pageKind === "team" ? pageKind : `parallel-${cards.length}`,
      kind: "card-grid",
      items: cards.map((card) => ({
        index: card.index,
        titleSlot: card.titleSlot,
        bodySlot: card.bodySlot,
      })),
    });
  }
  return modules;
}

function applyModuleRoles(slots, modules) {
  const byId = new Map(slots.map((slot) => [slot.slotId, slot]));
  for (const mod of modules) {
    if (mod.kind !== "card-grid") continue;
    for (const item of mod.items || []) {
      const title = byId.get(item.titleSlot);
      const body = byId.get(item.bodySlot);
      if (title && !item.bodySlot) {
        title.role = `card[${item.index}].combined`;
        title.fillWith = `Card ${item.index} title and body in one slot`;
        title.dataKind = "card-combined";
      } else if (title && body) {
        title.role = `card[${item.index}].title`;
        title.fillWith = `Card ${item.index} title`;
        title.dataKind = "card-title";
        body.role = `card[${item.index}].body`;
        body.fillWith = `Card ${item.index} body copy`;
        body.dataKind = "card-body";
      }
    }
  }
}

function purposeFor(pageKind, cardCount) {
  const map = {
    cover: "Fill cover fields: deck title, presenter, company, contact, date.",
    "section-divider": "Fill the chapter title only; keep the photo and chrome.",
    "parallel-3": "Fill the page title and three equal cards (title + body each).",
    "parallel-4": "Fill the page title and four equal cards (title + body each).",
    "parallel-6": "Fill the page title and a six-cell service grid.",
    team: "Fill the team heading and each member name/role slot.",
    partners: "Fill the partners heading; logo placeholders stay unless new marks are supplied.",
    pricing: "Fill pricing heading and each plan/price block as a single slot.",
    kpi: "Fill the KPI heading and each metric slot (label + number together).",
    "split-image": "Fill title and short copy; keep the existing image.",
    content: "Fill titled paragraphs already present on this slide.",
  };
  if (map[pageKind]) return map[pageKind];
  if (cardCount) return `Fill the page title and ${cardCount} existing cards.`;
  return "Fill replaceable text slots on this slide. Do not add shapes.";
}

function inferFillWith(box) {
  const text = String(box.text || "");
  if (/汇报人|姓名/.test(text)) return "Presenter full name";
  if (BRAND_SAMPLE.test(text.trim())) return "Company / organization name (global)";
  if (/电话|tel/i.test(text)) return "Contact phone";
  if (/邮箱|email/i.test(text)) return "Email address";
  if (/网站|http|www/i.test(text)) return "Website URL";
  if (/地址/.test(text) && !/公司 地址/.test(text)) return "Contact address";
  if (/20\d{2}|20XX/.test(text) && (box.maxChars || 40) <= 16) return "Date or year";
  if (box.role === "title") return "Slide title";
  if (box.role === "subtitle") return "Slide subtitle or one-line claim";
  if (/名字摆放处/.test(text)) return "Person name and job title in one slot";
  if (/logo摆放处/i.test(text)) return "Partner name or keep as logo placeholder";
  if (/标题\s*\d*%?/.test(text) || /%$/.test(text)) return "Metric label and value in one slot";
  if (PLACEHOLDER_BODY.test(text)) return "Body paragraph for this block";
  return "Replacement copy for this existing text box";
}

function inferDataKind(box) {
  const fill = inferFillWith(box);
  if (/Presenter/.test(fill)) return "person-name";
  if (/Company/.test(fill)) return "org-name";
  if (/phone/i.test(fill)) return "phone";
  if (/Email/.test(fill)) return "email";
  if (/Website/.test(fill)) return "url";
  if (/address/i.test(fill)) return "address";
  if (/Date/.test(fill)) return "date";
  if (/title/i.test(fill) && box.role === "title") return "title";
  if (/Metric/.test(fill)) return "metric";
  if (/Person name/.test(fill)) return "person-role";
  return "body";
}

function visualSort(slide, slots) {
  const geo = new Map((slide.texts || []).map((box) => [box.slotId, box]));
  return [...slots].sort((a, b) => {
    const ga = geo.get(a.slotId) || a;
    const gb = geo.get(b.slotId) || b;
    const dt = (ga.top || 0) - (gb.top || 0);
    if (Math.abs(dt) > 12) return dt;
    return (ga.left || 0) - (gb.left || 0);
  });
}

export function renderHandbookMarkdown(handbook) {
  const lines = [
    "# Template MOP fill handbook",
    "",
    "Fill new data into existing text slots only. Do not add slides or shapes, and do not change geometry. Sample strings are placeholders — never copy them.",
    "",
  ];
  if (handbook.globals?.length) {
    lines.push("## Global fields", "");
    for (const field of handbook.globals) {
      lines.push(`- \`${field.id}\` → ${field.fillWith}`);
      lines.push(`  slots: ${(field.slotIds || []).map((id) => "`" + id + "`").join(", ")}`);
    }
    lines.push("");
  }
  for (const page of handbook.pages || []) {
    lines.push(`## Slide ${page.index} · ${page.pageKind || "content"}`);
    if (page.purpose) lines.push("", page.purpose);
    if (page.modules?.length) {
      lines.push("", "Modules:");
      for (const mod of page.modules) {
        if (mod.kind === "card-grid") {
          lines.push(`- ${mod.id}: card grid`);
          for (const item of mod.items || []) {
            lines.push(`  - card ${item.index}: title \`${item.titleSlot}\` + body \`${item.bodySlot}\``);
          }
        } else {
          lines.push(`- ${mod.id} (${mod.kind}): ${(mod.slots || []).map((id) => "`" + id + "`").join(", ")}`);
        }
      }
    }
    lines.push("", "| slotId | role | fillWith | maxChars | sample |", "|---|---|---|---|---|");
    for (const slot of page.slots || []) {
      lines.push(`| \`${slot.slotId}\` | ${slot.role} | ${slot.fillWith} | ${slot.maxChars || "—"} | ${escapeCell(slot.sample)} |`);
    }
    if (page.keep?.length) {
      lines.push("", "Keep unchanged: " + page.keep.map((item) => item.slotId ? `${item.slotId} (${item.reason})` : item).join("; "));
    }
    lines.push("");
  }
  return lines.join("\n");
}

export function mergeHandbook(base, incoming) {
  if (!incoming) return base;
  const incomingPages = incoming.pages || incoming.handbook?.pages;
  if (!incomingPages?.length) return base;
  const byIndex = new Map(incomingPages.map((page) => [page.index, page]));
  return {
    ...base,
    source: "llm",
    language: "en",
    globals: incoming.globals || incoming.handbook?.globals || base.globals,
    pages: (base.pages || []).map((page) => {
      const overlay = byIndex.get(page.index);
      if (!overlay) return page;
      const byId = new Map((overlay.slots || []).map((slot) => [slot.slotId, slot]));
      return {
        ...page,
        pageKind: overlay.pageKind || page.pageKind,
        purpose: overlay.purpose || page.purpose,
        modules: page.modules,
        slots: (page.slots || []).map((slot) => {
          const next = byId.get(slot.slotId);
          if (!next) return slot;
          return {
            ...slot,
            role: next.role || slot.role,
            fillWith: next.fillWith || slot.fillWith,
            dataKind: next.dataKind || slot.dataKind,
          };
        }),
      };
    }),
  };
}

function escapeCell(value) {
  return String(value || "").replace(/\|/g, "\\|").replace(/\n/g, " ");
}
