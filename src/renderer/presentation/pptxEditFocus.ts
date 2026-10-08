import type {
  PresentationPptxEditorContext,
  PresentationPptxSlideContext,
} from "../../shared/presentationPptxProtocol";

/**
 * Where an AI edit landed, worked out from the deck rather than from the plan.
 *
 * The generated script says what it meant to do, never which slide it hit --
 * "change the second slide's title" carries no slide id back to the host. So
 * the deck is inspected on both sides of the execution, and the slides whose
 * visible state moved are the ones the edit touched.
 */

/** Geometry arrives as floats; only differences a reader could see matter. */
function coordinate(value: number | undefined): string {
  return typeof value === "number" && Number.isFinite(value)
    ? value.toFixed(2)
    : "";
}

/** Separators no shape name or text can contain, so fields cannot run together. */
const FIELD = "\u001f";
const SHAPE = "\u001e";

function slideSignature(slide: PresentationPptxSlideContext): string {
  const shapes = (slide.shapes ?? []).map((shape) =>
    [
      shape.id,
      shape.name ?? "",
      shape.type ?? "",
      coordinate(shape.left),
      coordinate(shape.top),
      coordinate(shape.width),
      coordinate(shape.height),
      shape.text ?? "",
    ].join(FIELD),
  );
  // The index is part of the signature so a reorder, an insert, or a delete
  // counts as a change to every slide that moved, not only to the new one.
  return [String(slide.index), ...shapes].join(SHAPE);
}

/** Slides that are new or whose contents moved, in deck order. */
export function changedSlideIds(
  before: PresentationPptxEditorContext | null | undefined,
  after: PresentationPptxEditorContext | null | undefined,
): string[] {
  const previous = new Map<string, string>();
  for (const slide of before?.slides ?? [])
    previous.set(slide.id, slideSignature(slide));
  const changed: string[] = [];
  for (const slide of after?.slides ?? []) {
    const was = previous.get(slide.id);
    if (was === undefined || was !== slideSignature(slide))
      changed.push(slide.id);
  }
  return changed;
}

/**
 * The slide the reader should be looking at once the edit lands, or `null` when
 * the view is already on one of the slides that changed -- or when nothing did.
 */
export function focusSlideAfterEdit(
  before: PresentationPptxEditorContext | null | undefined,
  after: PresentationPptxEditorContext | null | undefined,
): string | null {
  const changed = changedSlideIds(before, after);
  if (changed.length === 0) return null;
  const selected = new Set(after?.selectedSlideIds ?? []);
  if (changed.some((id) => selected.has(id))) return null;
  return changed[0];
}

/**
 * Office.js source that moves the editor to one slide. `setSelectedSlides` is
 * what the live drawing uses to follow itself across a deck, and it drives the
 * canvas and the slide rail together.
 */
export function buildSelectSlideScript(slideId: string): string {
  return `return await PowerPoint.run(async (context) => {
  const target = ${JSON.stringify(slideId)};
  context.presentation.setSelectedSlides([target]);
  await context.sync();
  return { selectedSlideId: target };
});`;
}
