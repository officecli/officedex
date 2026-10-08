import type { GenerationCanvasPhase } from "./pptxGenerationPhase";

const PHASES = ["research", "outline", "writing", "drawing", "polish"] as const;

function isPhase(value: string | null): value is GenerationCanvasPhase {
  return value !== null && (PHASES as readonly string[]).includes(value);
}

/**
 * `?slidesGenerating=writing` — paint the generating canvas in a browser
 * without a live PPT run.
 *
 * The product path only mounts that canvas from `PresentationStage` while a
 * run is going and the editor is not yet up. A browser session has no canvas
 * adapter, so opening a .pptx there still shows the grey skeleton. This flag
 * is the review handle for that gap; compiled out of production builds.
 */
export function slidesGeneratingPreview(
  search?: string,
  enabled: boolean = import.meta.env.DEV,
): GenerationCanvasPhase | null {
  if (!enabled) return null;
  const query = search ?? (typeof window === "undefined" ? "" : window.location.search);
  const value = new URLSearchParams(query).get("slidesGenerating");
  return isPhase(value) ? value : null;
}
