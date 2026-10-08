import type { DesktopAPI, PlanPptxJSResult } from "../shared/types";
import type { PresentationEditorController } from "../renderer/presentation/PresentationEditorFrame";
import { changedSlideIds, focusSlideAfterEdit, buildSelectSlideScript } from "../renderer/presentation/pptxEditFocus";
import { logShellEvent } from "../shell/port/shellLog";
import { translate } from "../renderer/i18n";
import type { DocumentEditRequest, DocumentEditResult } from "../shell/editor/canvasContract";
import {
  auditPlanScope,
  buildPlannerContext,
  describeScopeBreach,
  describeUnlocatedQuote,
  enumeratesWholeDeck,
  resolveEditScope,
  scopedPrompt,
} from "./pptxEditScope";

/**
 * Editing the deck that is already open, in place.
 *
 * The model never sees the file. It is handed a snapshot of the open
 * presentation — every slide, its shapes and the current selection — and
 * returns Office.js that changes it. The editor runs that script itself, so
 * nothing is regenerated, no second file is written, and the slides the user
 * was not talking about are not touched.
 *
 * This is `office.pptx.plan_js` plus `PresentationEditorController`, both of
 * which have existed the whole time and neither of which the shell called. The
 * shell's send path only had an in-place branch for Word (`target.type ===
 * "doc"`), so an instruction about an open deck went to the generation runtime
 * instead — "change slide 3's title" meant re-authoring the whole deck from the
 * prompt, which is why the canvas filled with a deck being drawn and the title
 * did not change. The workbench has driven this path all along
 * (`PresentationPptxWorkbench.planTurn`); this is the same sequence without its
 * conversation UI, the way `docxEditRun` is for Word.
 *
 * What the user *selected* is part of the instruction, and is carried through
 * `pptxEditScope`. Without it this path had no notion of a target at all: a
 * title picked on slide 4 plus "make it Japanese" reached the planner as the
 * whole deck plus "make it Japanese", and came back as a ten-slide translation
 * — obedient, and not what was asked for. So the scope is resolved, the context
 * is narrowed to it, the prompt states it, and the returned script is audited
 * against it before it is allowed to run.
 *
 * Which slide the edit landed on is worked out from the deck, not from the
 * plan: the generated script never says. The deck is inspected before and
 * after, and the slides whose visible state moved are the ones it touched
 * (`focusSlideAfterEdit`). That is also the answer to "how many changes" —
 * `applied` is a slide count here, not a replacement count.
 */

export interface PptxEditDeps {
  readonly api: DesktopAPI;
  readonly controller: PresentationEditorController;
  /** Where the deck lives, when known — metadata for the run only. */
  readonly filePath?: string;
}

/** Longest a planner call may take before the instruction is abandoned. */
const PLAN_TIMEOUT_MS = 180_000;

class EditAborted extends Error {
  constructor() {
    super(translate("shell.edit.aborted"));
    this.name = "EditAborted";
  }
}

export function createPptxEditRunner(deps: PptxEditDeps) {
  return async function editDeck(
    request: DocumentEditRequest,
  ): Promise<DocumentEditResult> {
    const instruction = request.instruction.trim();
    if (!instruction) throw new Error(translate("shell.edit.noInstruction"));
    const { signal } = request;
    const assertLive = () => {
      if (signal?.aborted) throw new EditAborted();
    };

    request.onPhase?.("reading");
    /*
     * The "before" shot, and the context the planner reads.
     *
     * Kept out of the try below on purpose: the plan is applied against the
     * deck as it stood when the planner saw it, so this value has to survive a
     * planner failure to be usable at all.
     */
    const before = await withLog("pptx-edit.inspect", () => deps.controller.inspect());
    assertLive();

    /*
     * The boundary, decided before the planner is called and recorded either way.
     *
     * Logged rather than trusted to be obvious: a packaged build has no console,
     * and "it translated the whole deck again" is only answerable if the run
     * left behind which rule fired and what it decided. `basis` is that record.
     */
    const { scope, basis } = resolveEditScope(before, {
      preferSelection: request.preferSelection,
      ...(request.selection?.text ? { quotedText: request.selection.text } : {}),
    });
    logShellEvent("pptx-edit.scope", {
      kind: scope.kind,
      ...(scope.level ? { level: scope.level } : {}),
      slideIds: scope.slideIds,
      shapeIds: scope.shapeIds,
      basis,
      ...(request.selection?.label ? { label: request.selection.label } : {}),
    });

    request.onPhase?.("drafting");
    const plan = await withLog("pptx-edit.plan", () =>
      withDeadline(
        deps.api.planPptxJS({
          prompt: scopedPrompt(instruction, scope, before),
          context: buildPlannerContext(before, scope),
        }),
        signal,
        PLAN_TIMEOUT_MS,
      ),
    );
    assertLive();

    if (!isUsablePlan(plan)) {
      throw new Error(translate("shell.edit.unrunnableScript"));
    }

    /*
     * A plan the planner flagged, or one that left the scope, is asked about —
     * not applied and not dropped.
     *
     * The deck planner sets `requires_confirmation` when an instruction reads
     * as more than it looks — "change page 2 to Japanese" is one slide and a
     * dozen text runs — and it says so in its own words. The workbench has
     * always put that behind a confirmation step.
     *
     * Refusing it outright was the first version of this, and it was a dead
     * end: the panel showed the planner's caution as a sentence and offered
     * nothing to press, so the user's explicit instruction ended in a message
     * they could not act on. Applying it silently is the other wrong answer —
     * a change the planner itself wanted checked.
     *
     * So: ask, and apply only on a yes. A caller that cannot ask still gets the
     * refusal, because the one thing that must not happen is applying it
     * unasked.
     *
     * The out-of-scope case joins this gate rather than adding a second one.
     * Two gates would mean two ways to be let through, and the honest answer to
     * both questions is the same shape: here is what this would do, say yes or
     * nothing happens. The breach wins the wording when there is one, because
     * "the planner was unsure" is not what went wrong — the plan covers more
     * than the user selected, and that is what they have to judge.
     *
     * The third case is the quiet one: the user quoted something, nothing could
     * be matched to it, and the edit fell back to the whole deck — the exact
     * behaviour that produced the bug, reached through a door marked "no match".
     * A pinpoint plan there is fine and is not worth interrupting; one that
     * walks every slide is the bug happening again, so that and only that is
     * asked about.
     *
     * Both of those are marked `danger`, which is what stops the panel from
     * recommending Apply. A confirmation whose default answer is yes is a
     * formality, and a formality in front of "this rewrites your deck" is worse
     * than no question at all.
     */
    const breach = auditPlanScope(plan.source, before, scope);
    const unlocatedWalk =
      !breach && scope.kind === "document" && scope.quotedText
        ? enumeratesWholeDeck(plan.source)
        : [];
    const flagged = plan.requires_confirmation === true || plan.confidence === "low";
    const dangerous = Boolean(breach) || unlocatedWalk.length > 0;
    if (dangerous || flagged) {
      const detail = breach
        ? describeScopeBreach(breach, scope)
        : unlocatedWalk.length > 0
          ? describeUnlocatedQuote(scope, before.slides?.length ?? 0)
          : (plan.confirmation?.message ?? plan.summary);
      logShellEvent("pptx-edit.gate", {
        reason: breach ? "out-of-scope" : unlocatedWalk.length > 0 ? "unlocated-quote" : "planner",
        ...(breach ? { ids: breach.ids, enumerations: breach.enumerations } : {}),
        ...(unlocatedWalk.length > 0 ? { enumerations: unlocatedWalk } : {}),
        askable: Boolean(request.onConfirm),
      });
      const ask = request.onConfirm;
      if (!ask) {
        throw new Error(
          detail || translate("shell.edit.notConfident"),
        );
      }
      const approved = await ask({
        text: detail || translate("shell.edit.confirm"),
        ...(plan.summary ? { detail: plan.summary } : {}),
        ...(dangerous ? { danger: true } : {}),
      });
      assertLive();
      if (!approved) {
        // A refusal is an answer, not a failure: nothing was changed and the
        // panel says so rather than reporting the run as broken.
        return {
          summary: translate("shell.edit.deckCancelled"),
          applied: 0,
          scope: scope.kind,
          undo: null,
          saveError: null,
        };
      }
    }

    request.onPhase?.("applying");
    await withLog("pptx-edit.execute", () => deps.controller.executeScript(plan.source));

    /*
     * Follow the edit.
     *
     * "Change the second slide's title" while the reader sits on the fifth
     * otherwise happens off-screen and reads as nothing having happened. The
     * slide rail and the canvas are moved together by the editor's own
     * `setSelectedSlides`, which is the same call the live drawing uses to
     * follow itself across a deck — so this is the editor's highlight, not a
     * border the shell painted over it.
     *
     * A deck that will not navigate is not a failed edit: the change has
     * already landed by this point, so every failure in here is swallowed
     * except the ones that mean the edit itself did not happen.
     */
    let applied = 0;
    /*
     * Where it *landed*, which is not the same question as where it was aimed.
     *
     * `scope` is what the request asked for; the card's wording has to describe
     * what happened. The two come apart on exactly the path this whole file
     * exists for: the guard catches a whole-deck plan, the user reads the
     * question and approves it anyway, and ten slides change. Reporting the
     * requested scope there would put "10 changes made to what you selected" on
     * the card — a worse lie than the one before scoping existed, and told in
     * the one case where the user has already been warned about the truth.
     *
     * Slides are the unit because slides are what can be compared before and
     * after; a change inside a selected slide is not distinguishable from here,
     * and the slide-level answer is the one the count is already in.
     *
     * When the after-shot cannot be taken, the audit's verdict stands in: a plan
     * that was clean is assumed to have stayed clean, and one that was approved
     * despite reaching further is not given the benefit of the doubt.
     */
    let landedInScope = breach === null;
    try {
      const after = await deps.controller.inspect();
      const changed = changedSlideIds(before, after);
      applied = changed.length;
      landedInScope =
        scope.kind === "document" || changed.every((id) => scope.slideIds.includes(id));
      if (applied > 0) {
        const target = focusSlideAfterEdit(before, after);
        if (target) await deps.controller.executeScript(buildSelectSlideScript(target));
      }
    } catch {
      // The edit is in the document; only the follow-the-edit courtesy is lost.
      applied = applied || 1;
    }
    const landedScope = landedInScope ? scope.kind : "document";

    const summary = plan.summary?.trim() || translate("shell.edit.deckUpdated");
    if (applied === 0) {
      // Nothing moved, so there is nothing to write. Saving here would push an
      // unchanged deck through a PPTX export for no reason, and a failure in
      // that export would be reported as a failure of the edit.
      return { summary, applied: 0, scope: landedScope, undo: null, saveError: null };
    }

    /*
     * The save is allowed to fail on its own terms.
     *
     * By now the change is *in the deck* — the editor has it, the rail shows
     * it, the tab is dirty. Letting a save failure escape as an exception would
     * report all of that as "the edit stopped", which is both wrong and
     * destructive to trust. So it travels back as data and the card says the
     * true thing: changed here, not yet written to disk.
     */
    request.onPhase?.("saving");
    let saveError: string | null = null;
    try {
      await deps.controller.save();
    } catch (reason) {
      saveError = reason instanceof Error ? reason.message : String(reason);
    }

    return {
      summary,
      applied,
      scope: landedScope,
      saveError,
      // The deck has no invertible-edit record the way Word does: the script
      // is arbitrary Office.js, and the shell holds no snapshot of the file.
      // Undo is the editor's own, so the card offers none rather than a button
      // that would have to guess.
      undo: null,
    };
  };
}

/**
 * Runs a step and records it, successful or not.
 *
 * This exists because a deck edit that goes wrong is otherwise invisible from
 * the outside: the instruction is taken, the panel shows its three steps, and
 * nothing anywhere says whether the planner answered, refused, or answered with
 * something the editor could not run. Every failure in this file is one of
 * those, so each step reports what it did and what it said.
 *
 * Writes to the same app log as `agent.routing`; a packaged build has no
 * console, and this is the record that turns "it broke again" into a cause.
 * Never throws on a logging failure — the step's own error is the one that
 * matters.
 */
async function withLog<T>(event: string, step: () => Promise<T>): Promise<T> {
  try {
    const value = await step();
    logShellEvent(event, { ok: true });
    return value;
  } catch (error) {
    logShellEvent(event, {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

function isUsablePlan(plan: PlanPptxJSResult | undefined): plan is PlanPptxJSResult {
  return Boolean(plan && typeof plan.source === "string" && plan.source.trim());
}

/**
 * Races a planner promise against Stop.
 *
 * `planPptxJS` takes no signal, so awaiting it plainly means Stop does nothing
 * visible until the model answers — and the bridge call would keep running
 * behind an abandoned instruction. There is no cancel verb for this workflow
 * (`office.docx.edit.v1` has one; this is a synchronous request), so the race
 * is what Stop can honestly be given: the caller stops waiting and the answer
 * is dropped.
 */
async function withDeadline<T>(
  work: Promise<T>,
  signal: AbortSignal | undefined,
  timeoutMs: number,
): Promise<T> {
  if (!signal) return work;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(translate("shell.edit.planTimeout"))),
          timeoutMs,
        );
        signal.addEventListener(
          "abort",
          () => reject(new EditAborted()),
          { once: true },
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
