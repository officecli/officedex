import type { DesktopTask, VibeOp } from "../../../shared/types";
import { pptxContentPreviews } from "../../../renderer/presentation/pptxRuntimeActivity";
import type { GenerationCanvasPhase } from "./pptxGenerationPhase";

export interface SlideCopy {
  title: string;
  subtitle: string;
  bullets: string[];
  currentSlide: number;
  totalSlides: number;
  filledThumbs: number;
}

function textOf(op: VibeOp): string {
  const value = op.shape?.text;
  return typeof value === "string" ? value.trim() : "";
}

function roleOf(op: VibeOp): string {
  return typeof op.shape?.role === "string" ? op.shape.role : "";
}

function copyFromOps(ops: readonly VibeOp[]): Partial<SlideCopy> | null {
  const texts = ops.flatMap((op) => {
    if (op.op !== "shape.add" && op.op !== "shape.update") return [];
    const text = textOf(op);
    if (!text) return [];
    return [{ text, role: roleOf(op), slide: op.slide ?? 0 }];
  });
  if (texts.length === 0) return null;
  const currentSlide = texts.reduce((max, item) => Math.max(max, item.slide), 1);
  const onSlide = texts.filter((item) => item.slide === currentSlide || item.slide === 0);
  const titled = onSlide.find((item) => item.role === "title") ?? onSlide[0];
  const subtitle = onSlide.find((item) => item.role === "subtitle" || item.role === "caption" || item.role === "takeaway");
  const bullets = onSlide
    .filter((item) => item !== titled && item !== subtitle)
    .filter((item) => item.role === "bullet" || item.role === "item" || item.role === "body" || item.role === "" || item.role === "text")
    .map((item) => item.text)
    .slice(0, 3);
  return {
    title: titled?.text ?? "",
    subtitle: subtitle?.text ?? "",
    bullets,
    currentSlide,
  };
}

function outlineTitles(task: DesktopTask): string[] {
  const slides = task.vibeOutline?.slides ?? [];
  const fromOutline = slides
    .map((slide) => (typeof slide.headline === "string" ? slide.headline.trim() : ""))
    .filter(Boolean);
  if (fromOutline.length) return fromOutline;
  const nodes = task.vibeTree?.tree.nodes ?? [];
  return nodes
    .filter((node) => node.kind === "slide" || node.kind === "outline")
    .map((node) => node.title?.trim() ?? "")
    .filter(Boolean);
}

export function slideCopyFromTask(task: DesktopTask, phase: GenerationCanvasPhase): SlideCopy {
  const titles = outlineTitles(task);
  const previews = pptxContentPreviews(task);
  const fromOps = copyFromOps(task.vibeOps ?? []);
  const lastPreview = previews.at(-1);
  const totalSlides = Math.max(
    titles.length,
    previews.length,
    fromOps?.currentSlide ?? 0,
    5,
  );
  const currentSlide = fromOps?.currentSlide || lastPreview?.slide || Math.min(Math.max(titles.length, 1), totalSlides);

  let filledThumbs = 0;
  if (phase === "research") filledThumbs = 0;
  else if (phase === "outline") filledThumbs = Math.max(titles.length, 5);
  else filledThumbs = Math.max(currentSlide, titles.length, 1);

  return {
    title: fromOps?.title || lastPreview?.headline || titles[currentSlide - 1] || titles[0] || "",
    subtitle: fromOps?.subtitle || lastPreview?.takeaway || "",
    bullets: (fromOps?.bullets?.length ? fromOps.bullets : lastPreview?.details.slice(0, 3)) || [],
    currentSlide,
    totalSlides,
    filledThumbs: Math.min(filledThumbs, totalSlides),
  };
}

export function cursorKindFor(phase: GenerationCanvasPhase): "text" | "shape" {
  return phase === "writing" ? "text" : "shape";
}

export function cursorAnchor(phase: GenerationCanvasPhase): "panel" | "slide" | "title" | "list" | "chart" | "figure" {
  if (phase === "research") return "panel";
  if (phase === "outline" || phase === "polish") return "slide";
  if (phase === "writing") return "title";
  return "chart";
}
