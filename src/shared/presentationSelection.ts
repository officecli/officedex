/**
 * Office.js source that reads *only what is selected* in the open presentation.
 *
 * Deliberately not `PRESENTATION_INSPECT_SOURCE`, which walks every slide and
 * every shape to build the planner's snapshot. Reporting a reference chip has
 * to be cheap enough to run whenever the user looks away from the editor, and
 * the planner's snapshot is two orders of magnitude more work than "what did
 * they click on".
 *
 * Two versions, the same split the other two editors have: the address is
 * free, the words cost a second `sync`.
 */

export const PRESENTATION_SELECTION_SOURCE = `
return await PowerPoint.run(async (context) => {
  const slides = context.presentation.getSelectedSlides().load("items/id");
  const shapes = context.presentation.getSelectedShapes().load("items/id,name,type");
  await context.sync();
  return {
    slideCount: slides.items.length,
    shapes: shapes.items.map((shape) => ({ id: shape.id, name: shape.name, type: shape.type })),
  };
});`;

export const PRESENTATION_SELECTION_TEXT_SOURCE = `
return await PowerPoint.run(async (context) => {
  const MAX_TEXT = 4000;
  const TEXT_TYPES = ["TextBox", "Placeholder", "GeometricShape"];
  const slides = context.presentation.getSelectedSlides().load("items/id");
  const shapes = context.presentation.getSelectedShapes().load("items/id,name,type");
  await context.sync();
  const withText = shapes.items.filter((shape) => TEXT_TYPES.includes(shape.type));
  for (const shape of withText) shape.textFrame.textRange.load("text");
  if (withText.length) await context.sync();
  const text = withText
    .map((shape) => String(shape.textFrame.textRange.text ?? "").trim())
    .filter(Boolean)
    .join("\\n")
    .slice(0, MAX_TEXT);
  return {
    slideCount: slides.items.length,
    shapes: shapes.items.map((shape) => ({ id: shape.id, name: shape.name, type: shape.type })),
    text,
  };
});`;

export interface PresentationSelectionShape {
  id: string;
  name: string;
  type: string;
}

export interface PresentationSelection {
  slideCount: number;
  shapes: PresentationSelectionShape[];
  /** Only present from `PRESENTATION_SELECTION_TEXT_SOURCE`. */
  text?: string;
}

/**
 * What the reference chip says.
 *
 * Shape names first, because PowerPoint's own names ("Title 1", "Content
 * Placeholder 2") say more than a count does. Slide numbers are avoided on
 * purpose: the editor's slide index and what the user sees on screen do not
 * reliably agree, and a chip that names the wrong slide is worse than one that
 * does not name a slide at all.
 */
export function presentationSelectionLabel(selection: PresentationSelection): string | null {
  if (selection.shapes.length === 1) return selection.shapes[0].name || "1 shape";
  if (selection.shapes.length > 1) return `${selection.shapes.length} shapes`;
  if (selection.slideCount === 1) return "slide selection";
  if (selection.slideCount > 1) return `${selection.slideCount} slides`;
  return null;
}
