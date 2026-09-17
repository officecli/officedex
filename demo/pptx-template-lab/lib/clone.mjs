export function cloneMappedSlides(mopRoot, mapping, extras = []) {
  const slidesBlock = (mopRoot.blocks || []).find((block) => block.type === "slides");
  if (!slidesBlock || !Array.isArray(slidesBlock.data)) {
    throw new Error("MOP has no slides block");
  }
  const originals = slidesBlock.data;
  const assembled = mapping.map((row, index) => {
    if (row.jsFallback && extras[index]) {
      return stampSlide(extras[index], index);
    }
    const src = originals[row.sourceSlide - 1];
    if (!src) throw new Error(`template slide ${row.sourceSlide} missing`);
    return stampSlide(JSON.parse(JSON.stringify(src)), index);
  });
  slidesBlock.data = assembled;
  rewriteSlideOrder(mopRoot, assembled);
  return mopRoot;
}

function stampSlide(slide, index) {
  if (!slide.attrs) slide.attrs = {};
  slide.attrs.logicalId = `slide-gen-${index + 1}`;
  slide.attrs.show = true;
  remintObjectIds(slide, index + 1);
  return slide;
}

function remintObjectIds(slide, newIndex) {
  const renamed = new Map();
  let n = 0;
  walkNodes(slide, (node, isRoot) => {
    if (isRoot || !node.attrs?.logicalId) return;
    const next = `slide-gen-${newIndex}-object-${++n}`;
    renamed.set(node.attrs.logicalId, next);
    node.attrs.logicalId = next;
  });
  walkNodes(slide, (node) => {
    const attrs = node.attrs;
    if (!attrs) return;
    for (const key of Object.keys(attrs)) {
      if (!key.endsWith("Ref")) continue;
      const mapped = renamed.get(attrs[key]);
      if (mapped) attrs[key] = mapped;
    }
  });
}

function walkNodes(node, visit, isRoot = true) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const child of node) walkNodes(child, visit, false);
    return;
  }
  visit(node, isRoot);
  walkNodes(node.data, visit, false);
}

function rewriteSlideOrder(mopRoot, assembled) {
  for (const block of mopRoot.blocks || []) {
    if (block.type !== "presentation") continue;
    for (const child of block.data || []) {
      if (child.type !== "slideOrder") continue;
      child.data = assembled.map((slide) => ({
        type: "slideRef",
        attrs: { targetRef: slide.attrs?.logicalId },
        data: null,
      }));
    }
  }
}
