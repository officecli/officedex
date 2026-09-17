export function applyPageNumbers(root) {
  const blocks = Array.isArray(root?.blocks) ? root.blocks : [];
  for (const block of blocks) {
    if (block.type !== "slides" || !Array.isArray(block.data)) continue;
    block.data.forEach((slide, index) => retargetPageNumbers(asArray(slide.data), String(index + 1)));
  }
  return root;
}

function retargetPageNumbers(nodes, value) {
  for (const node of nodes) {
    if (node.type === "picture") continue;
    if (node.type === "shape") {
      const text = collectText(node);
      if (/^\d{1,3}$/.test(text)) setText(node, value);
      continue;
    }
    retargetPageNumbers(asArray(node.data), value);
  }
}

export function applyFills(root, fills) {
  const byID = new Map();
  for (const fill of fills || []) {
    if (fill?.slotId) byID.set(String(fill.slotId), String(fill.text ?? ""));
  }
  const blocks = Array.isArray(root?.blocks) ? root.blocks : [];
  for (const block of blocks) {
    if (block.type !== "slides" || !Array.isArray(block.data)) continue;
    block.data.forEach((slide, index) => {
      let n = 0;
      walk(asArray(slide.data), () => {
        n += 1;
        return `s${index + 1}-t${n - 1}`;
      }, byID);
    });
  }
  return root;
}

function walk(nodes, nextId, byID) {
  for (const node of nodes) {
    if (node.type === "picture") continue;
    if (node.type === "shape") {
      if (collectText(node)) {
        const id = nextId();
        if (byID.has(id)) setText(node, byID.get(id));
      }
      continue;
    }
    walk(asArray(node.data), nextId, byID);
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

function setText(node, text) {
  let first = true;
  const visit = (n) => {
    if (n.type === "text") {
      n.data = first ? text : "";
      first = false;
      return;
    }
    for (const child of asArray(n.data)) visit(child);
  };
  visit(node);
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

export function overflowWarnings(fills, slots) {
  const byId = new Map((slots || []).map((slot) => [slot.slotId, slot]));
  const warnings = [];
  for (const fill of fills || []) {
    const slot = byId.get(fill.slotId);
    if (!slot?.maxChars || fill.text == null) continue;
    const n = [...String(fill.text)].length;
    if (n > slot.maxChars) {
      warnings.push({
        code: "overflow",
        slotId: fill.slotId,
        maxChars: slot.maxChars,
        actual: n,
        detail: `${fill.slotId} is ${n} chars, max ${slot.maxChars}`,
      });
      fill.text = [...String(fill.text)].slice(0, slot.maxChars).join("");
    }
  }
  return warnings;
}

export function applyImageFills(root, imageFills, resolveFile) {
  const byID = new Map();
  for (const fill of imageFills || []) {
    if (fill?.slotId && fill.digest) byID.set(fill.slotId, fill);
  }
  if (!byID.size) return root;
  const blocks = Array.isArray(root?.blocks) ? root.blocks : [];
  for (const block of blocks) {
    if (block.type !== "slides" || !Array.isArray(block.data)) continue;
    block.data.forEach((slide, index) => {
      let n = 0;
      walkPics(asArray(slide.data), () => `s${index + 1}-p${n++}`, byID);
    });
  }
  return root;
}

function walkPics(nodes, nextId, byID) {
  for (const node of nodes) {
    if (node.type === "picture") {
      const id = nextId();
      const fill = byID.get(id);
      if (fill?.digest && node.attrs?.resource) {
        node.attrs.resource.digest = fill.digest.startsWith("sha256:") ? fill.digest : `sha256:${fill.digest}`;
      }
      continue;
    }
    if (node.type === "shape") continue;
    walkPics(asArray(node.data), nextId, byID);
  }
}

export function replaceableSlots(facts) {
  const out = [];
  for (const slide of facts.slides || []) {
    for (const box of slide.texts || []) {
      if (box.replaceable) out.push({ ...box, slide: slide.index });
    }
  }
  return out;
}
