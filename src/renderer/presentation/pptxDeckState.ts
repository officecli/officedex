import type { VibeOp } from "../../shared/types";
import { imageProgressFromOps } from "./pptxProgress";

/**
 * The two questions the PPTX surfaces ask about a finished run, in one place.
 *
 * They look like the same question and are not, which is why this module exists
 * with both answers side by side rather than one shared predicate. Unifying them
 * draws a deck before its pictures land, or leaves a spinner over a deck that is
 * already finished — both have shipped before.
 */

/** Only the run state and the op stream matter here, so both transports qualify. */
export interface PptxDeckRunInput {
  readonly status: string;
  readonly vibeOps?: readonly VibeOp[];
}

/** `deck.end` is the author's last word on the deck's structure. */
export function pptxHasDeckEnd(ops: readonly VibeOp[] = []): boolean {
  return ops.some((op) => op.op === "deck.end");
}

/**
 * "Is the screen still working?"
 *
 * Answered yes while the run is complete but picture slots are open and the
 * author has not closed the deck: the deck is not yet what it is going to be, so
 * the stage keeps its progress affordances instead of offering an editor over a
 * half-empty page.
 */
export function pptxDeckStillDrawing(task: PptxDeckRunInput): boolean {
  if (task.status !== "completed") return false;
  const ops = task.vibeOps ?? [];
  return imageProgressFromOps(ops).pending > 0 && !pptxHasDeckEnd(ops);
}

/**
 * "Has the op stream stopped producing?"
 *
 * Answered no while any picture slot is still open, **even after `deck.end`**,
 * because the author closes the deck before the image workers emit the
 * `shape.update` patches that fill those slots. The replay sequencer latches its
 * own `finished` flag the moment this says yes and then ignores every later
 * `update()`, so declaring the stream drained early freezes the drawing with the
 * pictures missing.
 */
export function pptxOpStreamDrained(task: PptxDeckRunInput): boolean {
  if (task.status === "failed" || task.status === "cancelled") return true;
  if (task.status !== "completed") return false;
  return imageProgressFromOps(task.vibeOps ?? []).pending === 0;
}

export interface PptxTemplateBindingIssue {
  slide: number;
  code: "missing-layout" | "missing-asset-dir" | "unsupported-role";
  message: string;
}

/** Validate clone metadata before a replay reaches the JS-SDK. */
export function validatePptxTemplateBindings(ops: readonly VibeOp[] = []): PptxTemplateBindingIssue[] {
  const issues: PptxTemplateBindingIssue[] = [];
  for (const op of ops) {
    if (op.op !== "slide.begin") continue;
    const template = (op as VibeOp & { template?: { layoutId?: unknown; assetDir?: unknown; assetRoles?: unknown[] } }).template;
    if (!template) continue;
    const slide = Number(op.slide ?? 0);
    if (typeof template.layoutId !== "string" || !template.layoutId.trim()) {
      issues.push({ slide, code: "missing-layout", message: "Template slide has no layout binding" });
    }
    if (typeof template.assetDir !== "string" || !template.assetDir.trim()) {
      issues.push({ slide, code: "missing-asset-dir", message: "Template slide has no local asset directory" });
    }
    for (const role of Array.isArray(template.assetRoles) ? template.assetRoles : []) {
      if (!["title", "body", "image", "chart", "callout", "repeated-block", "logo"].includes(String(role))) {
        issues.push({ slide, code: "unsupported-role", message: `Unsupported template asset role: ${String(role)}` });
      }
    }
  }
  return issues;
}
