export function pageTypesFromHandbook(handbook) {
  const types = {};
  for (const page of handbook?.pages || []) {
    const kind = page.pageKind || "content";
    if (!types[kind]) {
      types[kind] = { pageKind: kind, sourceSlides: [], pages: [] };
    }
    types[kind].sourceSlides.push(page.index);
    types[kind].pages.push(page);
  }
  return types;
}

export function remapSlots(sourcePage, newIndex) {
  if (!sourcePage) return [];
  const from = `s${sourcePage.index}-`;
  const to = `s${newIndex}-`;
  return (sourcePage.slots || []).map((slot) => ({
    ...slot,
    slotId: String(slot.slotId || "").replace(from, to),
    sourceSlotId: slot.slotId,
    sourceSlide: sourcePage.index,
  }));
}

export function remapPictureSlots(factsSlide, newIndex) {
  if (!factsSlide) return [];
  return (factsSlide.pictures || [])
    .map((pic, index) => ({
      slotId: `s${newIndex}-p${index}`,
      sourceSlotId: `s${factsSlide.index}-p${index}`,
      sourceSlide: factsSlide.index,
      digest: pic.digest,
      logo: Boolean(pic.logo),
      replaceable: !pic.logo,
      width: pic.width,
      height: pic.height,
      left: pic.left,
      top: pic.top,
      name: pic.name,
    }));
}

export function pickSourceSlide(pageTypes, pageKind, instanceIndex = 0) {
  const entry = pageTypes[pageKind];
  if (!entry?.sourceSlides?.length) return null;
  return entry.sourceSlides[instanceIndex % entry.sourceSlides.length];
}
