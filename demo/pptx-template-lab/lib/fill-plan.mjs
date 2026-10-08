export const FILL_SYSTEM = `Return JSON {fills:[{slotId,text}]} only. Chinese copy. Use NEW slot indexes.
Rules:
- Fill EVERY listed slot. Do not omit card bodies.
- Respect maxChars and maxLines. maxLines=1 means a single line; never overflow it.
- Keep labeled prefixes from sample (汇报人姓名：, 联系电话：, 联系地址：) when they still fit with a SHORT value.
- Combined / pricing slots must include name + price or 2-4 feature words matching the sample's density. Do not leave a tall card with only a title.
- Do not invent partners, customers, logos, prices, or metrics that are not in the brief.
- If partners are not listed, write 合作伙伴一 / 合作伙伴二 / 合作伙伴三 — never 阿里云, 腾讯, 字节, 华为 unless the brief names them.
- closing.message is one short sentence (感谢观看). closing.kicker stays Thanks unless asked otherwise.
- Never copy sample placeholders (这是一段文字, logo摆放处, 某某某, 20XX, 标题1, 服务1).`;

export function slotPayload(slot) {
  return {
    slotId: slot.slotId,
    role: slot.role,
    fillWith: slot.fillWith,
    dataKind: slot.dataKind,
    maxChars: slot.maxChars,
    maxLines: slot.maxLines || 1,
    sample: slot.sample,
  };
}

export function remapFillIds(fills, mapping) {
  const srcToNew = new Map();
  for (const row of mapping || []) {
    if (row.sourceSlide && row.outlineIndex && row.sourceSlide !== row.outlineIndex) {
      srcToNew.set(row.sourceSlide, row.outlineIndex);
    }
  }
  const haveNew = new Set((fills || []).map((fill) => fill.slotId));
  for (const fill of fills || []) {
    const match = String(fill.slotId || "").match(/^s(\d+)-(t\d+)$/);
    if (!match) continue;
    const neu = srcToNew.get(Number(match[1]));
    if (!neu) continue;
    const next = `s${neu}-${match[2]}`;
    if (!haveNew.has(next)) {
      fill.slotId = next;
      haveNew.add(next);
    }
  }
  return fills;
}

export function applyKnownFacts(fills, slots, facts = {}) {
  const byId = new Map((fills || []).map((fill) => [fill.slotId, fill]));
  for (const slot of slots || []) {
    const text = formatKnown(slot, byId.get(slot.slotId)?.text, facts);
    if (text == null) continue;
    const existing = byId.get(slot.slotId);
    if (existing) existing.text = text;
    else {
      const fill = { slotId: slot.slotId, text };
      fills.push(fill);
      byId.set(slot.slotId, fill);
    }
  }
  return fills;
}

export function formatKnown(slot, current, facts) {
  const kind = slot.dataKind || "";
  const role = slot.role || "";
  const max = slot.maxChars || 40;
  const sample = slot.sample || "";
  if (role === "brand.name" || kind === "org-name") return fit(facts.brand, max);
  if (kind === "phone") return fitLabeled(sample, facts.phone, max);
  if (kind === "date") return fit(facts.date, max);
  if (kind === "address") return fitLabeled(sample, facts.address, max);
  if (kind === "email") return fitLabeled(sample, facts.email, max);
  if (kind === "url") return fitLabeled(sample, facts.website, max);
  if (role === "presenter" || kind === "person-name") return fitLabeled(sample, facts.presenter, max);
  if (role === "closing.kicker") return fit(facts.closingKicker || "Thanks", max);
  if (role === "closing.message") return fit(facts.closingMessage || "感谢观看", max);
  if (current != null && kind === "card-combined") return densifyCombined(current, sample, max);
  return null;
}

export function missingSlots(fills, slots) {
  const have = new Set((fills || []).map((fill) => fill.slotId));
  return (slots || []).filter((slot) => slot.role !== "brand.name" && !have.has(slot.slotId));
}

export function leftoverPlaceholders(fills) {
  const re = /这是一段文字|you can add any text|logo摆放处|名字摆放处|某某某|20XX|xxxxxxxxxx|观点\d|标题\s*\d|服务\s*\d/i;
  return (fills || []).filter((fill) => re.test(String(fill.text || "")));
}

export function fitLabeled(sample, value, maxChars) {
  if (!value) return null;
  const prefix = String(sample).match(/^[^\s]{1,8}：/)?.[0] || "";
  const compact = String(value).replace(/-/g, "");
  const shortPrefix = prefix.replace(/^联系/u, "");
  for (const candidate of [prefix + value, prefix + compact, shortPrefix + value, shortPrefix + compact, value, compact]) {
    if (candidate && [...candidate].length <= maxChars) return candidate;
  }
  return [...compact].slice(0, maxChars).join("");
}

export function fit(value, maxChars) {
  if (value == null || value === "") return null;
  const runes = [...String(value)];
  return runes.length <= maxChars ? runes.join("") : runes.slice(0, maxChars).join("");
}

function densifyCombined(text, sample, maxChars) {
  const current = String(text || "").trim();
  if (!current) return null;
  if ([...current].length >= Math.min(maxChars, 18)) return current;
  if (!/特点|¥|￥/.test(sample || "")) return current;
  if (/特点|¥|￥/.test(current)) return current;
  const extra = " 协作 权限 安全";
  return fit(current + extra, maxChars);
}
