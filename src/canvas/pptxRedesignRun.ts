import type { DesktopAPI } from "../shared/types";
import type { PresentationEditorContext } from "../shared/presentationInspect";
import type { PresentationEditorController } from "../renderer/presentation/PresentationEditorFrame";
import { buildSelectSlideScript } from "../renderer/presentation/pptxEditFocus";
import { getCurrentLocale, translate } from "../renderer/i18n";
import { logShellEvent } from "../shell/port/shellLog";
import type { DocumentEditRequest, DocumentEditResult } from "../shell/editor/canvasContract";

/**
 * "Redesign this slide", as an SVG round trip.
 *
 * A small edit — a word, a colour, a nudge — is an Office.js script
 * (`pptxEditRun`). A redesign is not a small edit: the model has to see the
 * page as a picture it can rearrange, and a script that moves forty shapes one
 * property at a time is neither something it writes well nor something that
 * can be checked before it runs.
 *
 * So the page goes out as constrained SVG with every element tagged by the id
 * of the object it came from, comes back edited, is linted by the editor's own
 * compiler with real text measurement, and is written back by id: an element
 * that kept its id is changed in place, a new one is added, a missing one is
 * removed. What the SVG never carried — animation, hyperlinks, alt text — is
 * not part of the comparison, so it is still there afterwards.
 */

/** Model answers per redesign: the first, then at most two repairs. */
const MAX_LINT_ROUNDS = 2;
/** Typographic findings are worth a rewrite but do not block the page. */
const SOFT_RULES = new Set(["text.orphan", "text.number-unit-split"]);

const REDESIGN_INTENT =
  /重新设计|重新排版|重新生成|重做|重画|换(?:个|一个|一种|成)?[^，。,.]{0,8}(?:版式|布局|排版|风格)|改成[^，。,.]{0,10}(?:版式|布局|时间线|对比|卡片)|redesign|redo|regenerate|re-?layout|new layout|restyle/iu;

/** Whether an instruction asks for the page to be laid out afresh. */
export function isRedesignInstruction(instruction: string): boolean {
  return REDESIGN_INTENT.test(instruction);
}

export interface RedesignTarget {
  id: string;
  position: number;
}

/** More pages than this in one instruction are asked about before starting. */
export const REDESIGN_CONFIRM_ABOVE = 3;

/**
 * The slides a redo applies to, in deck order.
 *
 * This is the incremental redo of a finished deck: "redo slides 3 to 5",
 * "everything from page 6 on", "the whole deck in a darker style". Each
 * target goes through the same per-slide round trip, so a deck is redone a
 * page at a time and an unchanged page is never touched.
 *
 * Read from the instruction first — a range, a "from N on", a list, "all" —
 * and from the selection otherwise. Nothing named and nothing selected is not
 * a redo this path takes.
 */
export function redesignTargetSlides(
  context: PresentationEditorContext,
  instruction: string,
): RedesignTarget[] {
  const slides = context.slides ?? [];
  const at = (position: number): RedesignTarget[] =>
    slides[position] ? [{ id: slides[position].id, position }] : [];
  const span = (from: number, to: number): RedesignTarget[] => {
    const targets: RedesignTarget[] = [];
    for (let position = Math.max(0, from); position <= Math.min(slides.length - 1, to); position += 1) {
      targets.push(...at(position));
    }
    return targets;
  };
  const range =
    /第?\s*(\d{1,3})\s*(?:页|张)?\s*(?:到|至|-|–|—|~|～)\s*第?\s*(\d{1,3})\s*[页张]/u.exec(instruction) ??
    /(?:slides?|pages?)\s*(\d{1,3})\s*(?:to|through|-|–)\s*(\d{1,3})/iu.exec(instruction);
  if (range) return span(Number(range[1]) - 1, Number(range[2]) - 1);
  const onward =
    /(?:从)?第\s*(\d{1,3})\s*[页张]\s*(?:开始|起|之后|以后|往后|及之后|及以后)/u.exec(instruction) ??
    /from\s+(?:slide|page)\s*(\d{1,3})\s*(?:on|onward|onwards)/iu.exec(instruction);
  if (onward) {
    // "第 6 页之后" starts after it; "从第 6 页开始" starts at it.
    const after = /之后|以后|往后/u.test(onward[0]) && !/及/u.test(onward[0]);
    return span(Number(onward[1]) - 1 + (after ? 1 : 0), slides.length - 1);
  }
  const listed = [...instruction.matchAll(/第\s*((?:\d{1,3}\s*[、,，和]\s*)*\d{1,3})\s*[页张]/gu)]
    .flatMap((match) => match[1].split(/[、,，和]/u))
    .concat([...instruction.matchAll(/(?:slide|page)\s*(\d{1,3})/giu)].map((match) => match[1]))
    .map((value) => Number(value.trim()) - 1)
    .filter((position) => Number.isInteger(position));
  if (listed.length > 0) {
    return [...new Set(listed)].sort((a, b) => a - b).flatMap(at);
  }
  if (/整套|全部|所有页|每一页|每页|整个(?:演示|PPT|文稿)|whole deck|every slide|all slides/iu.test(instruction)) {
    return span(0, slides.length - 1);
  }
  if (context.selectedSlideIds.length > 0) {
    return slides
      .map((slide, position) => ({ id: slide.id, position }))
      .filter((target) => context.selectedSlideIds.includes(target.id));
  }
  return slides.length === 1 ? at(0) : [];
}

/** The single target of a one-slide redesign, or null. */
export function redesignTargetSlide(
  context: PresentationEditorContext,
  instruction: string,
): RedesignTarget | null {
  const targets = redesignTargetSlides(context, instruction);
  return targets.length === 1 ? targets[0] : null;
}

interface LintDiagnostic {
  severity: string;
  rule: string;
  message: string;
  hint?: string;
}

function exportScript(position: number): string {
  return `const host = globalThis.__presentationSvgSlide;
if (!host || typeof host.exportSlide !== "function") return { unsupported: true };
return { svg: host.exportSlide(${position + 1}) };`;
}

function lintScript(svg: string): string {
  return `const result = await globalThis.__presentationSvgSlide.lint(${JSON.stringify(svg)});
return { diagnostics: result.diagnostics };`;
}

function importScript(position: number, exported: string, edited: string): string {
  return `return await PowerPoint.run(async (context) => {
  const slide = context.presentation.slides.getItemAt(${position});
  const plan = await globalThis.__presentationSvgSlide.importSlide(context, slide, { exported: ${JSON.stringify(exported)}, edited: ${JSON.stringify(edited)} });
  await context.sync();
  const diff = plan.diff;
  if (!diff) return { applied: false, errors: plan.diagnostics.filter((item) => item.severity === "error").map((item) => item.message) };
  return {
    applied: true,
    updated: diff.updates.length,
    replaced: diff.replacements.length,
    added: diff.additions.length,
    removed: diff.removals.length,
    background: Boolean(diff.background),
  };
});`;
}

function feedbackFrom(errors: readonly LintDiagnostic[]): string {
  return errors
    .map((item, index) => `${index + 1}. (${item.rule}) ${item.message}${item.hint ? ` 修复：${item.hint}` : ""}`)
    .join("\n");
}

export interface PptxRedesignDeps {
  readonly api: DesktopAPI;
  readonly controller: PresentationEditorController;
}

/**
 * Runs the round trip. Returns null when this editor build has no SVG slide
 * surface, so the caller can fall back to the script path; every other
 * failure is thrown, because by then the user has been told a redesign is
 * under way.
 */
export async function redesignSlide(
  deps: PptxRedesignDeps,
  request: DocumentEditRequest,
  target: { id: string; position: number },
  assertLive: () => void,
  plan: <T>(work: Promise<T>) => Promise<T>,
): Promise<DocumentEditResult | null> {
  const exportedResult = (await deps.controller.executeScript(exportScript(target.position), { awaitSnapshotMs: 0 }))
    ?.result as { svg?: string; unsupported?: boolean } | undefined;
  if (!exportedResult || exportedResult.unsupported || !exportedResult.svg) {
    logShellEvent("pptx-redesign.unsupported", { slide: target.position + 1 });
    return null;
  }
  const exported = exportedResult.svg;
  assertLive();

  request.onPhase?.("drafting");
  let edited = "";
  let summary = "";
  let feedback = "";
  let rounds = 0;
  for (;;) {
    const answer = await plan(
      deps.api.planPptxJS({
        prompt: request.instruction.trim(),
        context: {
          mode: "svg-redesign",
          svg: exported,
          ...(edited && feedback ? { previous_svg: edited, lint_feedback: feedback } : {}),
          ui_locale: getCurrentLocale(),
        },
      }),
    );
    assertLive();
    if (!answer || typeof answer.source !== "string" || !answer.source.includes("<svg")) {
      throw new Error(translate("shell.edit.redesignUnreadable"));
    }
    edited = answer.source;
    summary = answer.summary?.trim() || summary;
    const linted = (await deps.controller.executeScript(lintScript(edited), { awaitSnapshotMs: 0 }))
      ?.result as { diagnostics?: LintDiagnostic[] } | undefined;
    const errors = (linted?.diagnostics ?? []).filter((item) => item.severity === "error");
    const blocking = errors.filter((item) => !SOFT_RULES.has(item.rule));
    logShellEvent("pptx-redesign.lint", {
      slide: target.position + 1,
      round: rounds,
      errors: errors.map((item) => item.rule),
    });
    if (errors.length === 0) break;
    if (rounds >= MAX_LINT_ROUNDS) {
      // Only typographic findings left: the page is usable as drawn.
      if (blocking.length === 0) break;
      throw new Error(translate("shell.edit.redesignRejected", { reason: blocking[0].message }));
    }
    feedback = feedbackFrom(errors);
    rounds += 1;
  }

  if (request.requireReview) {
    const ask = request.onConfirm;
    if (!ask) throw new Error(translate("shell.edit.notConfident"));
    const approved = await ask({
      text: translate("shell.edit.redesignConfirm", { slide: target.position + 1 }),
      ...(summary ? { detail: summary } : {}),
    });
    assertLive();
    if (!approved) {
      return { summary: translate("shell.edit.deckCancelled"), applied: 0, scope: "selection", undo: null, saveError: null };
    }
  }

  request.onPhase?.("applying");
  const applied = (await deps.controller.executeScript(importScript(target.position, exported, edited)))
    ?.result as { applied?: boolean; errors?: string[]; updated?: number; replaced?: number; added?: number; removed?: number; background?: boolean } | undefined;
  if (!applied?.applied) {
    throw new Error(translate("shell.edit.redesignRejected", { reason: applied?.errors?.[0] ?? "" }));
  }
  const changed =
    (applied.updated ?? 0) + (applied.replaced ?? 0) + (applied.added ?? 0) + (applied.removed ?? 0) + (applied.background ? 1 : 0);
  logShellEvent("pptx-redesign.applied", { slide: target.position + 1, rounds, ...applied });
  try {
    await deps.controller.executeScript(buildSelectSlideScript(target.id));
  } catch {
    // The change is in the deck; only following it on screen is lost.
  }
  if (changed === 0) {
    return { summary: summary || translate("shell.edit.deckUpdated"), applied: 0, scope: "selection", undo: null, saveError: null };
  }

  request.onPhase?.("saving");
  let saveError: string | null = null;
  try {
    await deps.controller.save();
  } catch (reason) {
    saveError = reason instanceof Error ? reason.message : String(reason);
  }
  return {
    summary: summary || translate("shell.edit.slideRedesigned", { slide: target.position + 1 }),
    // One slide changed; the count is in slides, as it is for the script path.
    applied: 1,
    scope: "selection",
    saveError,
    undo: null,
  };
}

/**
 * Redoes several slides, one round trip each, in deck order.
 *
 * A page that fails its layout check is left as it was and the run goes on:
 * four good pages are not thrown away for a fifth that would not settle. The
 * result says how many changed and names the ones that did not.
 */
export async function redesignSlides(
  deps: PptxRedesignDeps,
  request: DocumentEditRequest,
  targets: readonly RedesignTarget[],
  assertLive: () => void,
  plan: <T>(work: Promise<T>) => Promise<T>,
): Promise<DocumentEditResult | null> {
  if (targets.length === 1) return redesignSlide(deps, request, targets[0], assertLive, plan);
  if (targets.length > REDESIGN_CONFIRM_ABOVE || request.requireReview) {
    const ask = request.onConfirm;
    if (!ask) throw new Error(translate("shell.edit.notConfident"));
    const approved = await ask({
      text: translate("shell.edit.redesignManyConfirm", {
        count: targets.length,
        slides: targets.map((target) => target.position + 1).join(", "),
      }),
    });
    assertLive();
    if (!approved) {
      return { summary: translate("shell.edit.deckCancelled"), applied: 0, scope: "selection", undo: null, saveError: null };
    }
  }
  let applied = 0;
  let saveError: string | null = null;
  const failed: number[] = [];
  // Each page saves itself; asking again per page would be a confirmation
  // the user already gave.
  const each: DocumentEditRequest = { ...request, requireReview: false };
  for (const target of targets) {
    assertLive();
    try {
      const result = await redesignSlide(deps, each, target, assertLive, plan);
      // The editor build has no SVG surface: nothing here can work.
      if (result === null) return applied > 0 ? summarise() : null;
      applied += result.applied;
      saveError = result.saveError ?? saveError;
    } catch (error) {
      if (error instanceof Error && error.name === "EditAborted") throw error;
      failed.push(target.position + 1);
      logShellEvent("pptx-redesign.slide-failed", {
        slide: target.position + 1,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  if (applied === 0 && failed.length > 0) {
    throw new Error(translate("shell.edit.redesignRejected", { reason: "" }).trim());
  }
  return summarise();

  function summarise(): DocumentEditResult {
    const summary =
      failed.length > 0
        ? translate("shell.edit.slidesRedesignedPartly", { count: applied, failed: failed.join(", ") })
        : translate("shell.edit.slidesRedesigned", { count: applied });
    return { summary, applied, scope: targets.length === 1 ? "selection" : "document", saveError, undo: null };
  }
}
