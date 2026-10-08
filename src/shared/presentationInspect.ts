/**
 * Office.js source that snapshots the open presentation for the AI planner:
 * every slide with its shapes (geometry + trimmed text) plus the current
 * selection. It runs inside the embedded presentation editor via
 * `presentation:execute-script`; the result shape is `PresentationEditorContext`.
 */
export const PRESENTATION_INSPECT_SOURCE = `
return await PowerPoint.run(async (context) => {
  const MAX_TEXT = 400;
  const TEXT_TYPES = ["TextBox", "Placeholder", "GeometricShape"];
  const slides = context.presentation.slides.load("items/id,index");
  const selectedSlides = context.presentation.getSelectedSlides().load("items/id,index");
  const selectedShapes = context.presentation.getSelectedShapes().load("items/id,name,type");
  await context.sync();
  const shapeLists = slides.items.map((slide) =>
    slide.shapes.load("items/id,name,type,left,top,width,height"),
  );
  await context.sync();
  const textShapes = new Set();
  for (const shapes of shapeLists) {
    for (const shape of shapes.items) {
      if (TEXT_TYPES.includes(shape.type)) {
        shape.textFrame.textRange.load("text");
        textShapes.add(shape);
      }
    }
  }
  if (textShapes.size) await context.sync();
  const rows = slides.items.map((slide, position) => ({
    id: slide.id,
    index: slide.index,
    shapes: shapeLists[position].items.map((shape) => ({
      id: shape.id,
      name: shape.name,
      type: shape.type,
      left: shape.left,
      top: shape.top,
      width: shape.width,
      height: shape.height,
      text: textShapes.has(shape)
        ? String(shape.textFrame.textRange.text ?? "").slice(0, MAX_TEXT)
        : "",
    })),
  }));
  return {
    slides: rows,
    selectedSlideIds: selectedSlides.items.map((slide) => slide.id),
    selectedShapes: selectedShapes.items.map((shape) => ({
      id: shape.id,
      name: shape.name,
      type: shape.type,
    })),
  };
});`;

export interface PresentationEditorShape {
  id: string;
  name: string;
  type: string;
  left: number;
  top: number;
  width: number;
  height: number;
  text: string;
}

export interface PresentationEditorSlide {
  id: string;
  index: number;
  shapes: PresentationEditorShape[];
}

/** Result of `PRESENTATION_INSPECT_SOURCE`; forwarded verbatim to the planner. */
export interface PresentationEditorContext {
  slides: PresentationEditorSlide[];
  selectedSlideIds: string[];
  selectedShapes: Array<{ id: string; name: string; type: string }>;
}
