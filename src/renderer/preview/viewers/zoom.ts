// Zoom ranges shared by the document viewers. Three viewers declared the same
// triplet; the PDF viewer has coarser steps because its pages re-rasterise.
export interface ZoomRange {
  readonly step: number;
  readonly min: number;
  readonly max: number;
}

export const DOCUMENT_ZOOM: ZoomRange = { step: 0.15, min: 0.25, max: 3 };
export const PDF_ZOOM: ZoomRange = { step: 0.25, min: 0.5, max: 4 };

export function zoomIn(zoom: number, range: ZoomRange): number {
  return Math.min(zoom + range.step, range.max);
}

export function zoomOut(zoom: number, range: ZoomRange): number {
  return Math.max(zoom - range.step, range.min);
}
