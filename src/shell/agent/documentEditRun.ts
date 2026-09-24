import type { AgentTask, AgentReference } from "../../shared/uiPort";
import type { CanvasAdapter, DocumentEditPhase } from "../editor/canvasContract";
import { translate } from "../../renderer/i18n";

/**
 * An in-place document edit, as a conversation.
 *
 * `TaskPanel` renders an `AgentTask`, and an edit carried out by the mounted
 * editor is a task in every sense the user cares about — they asked for
 * something, it took a while, it changed the file, and they may want it back.
 * It just is not a task the *runtime* has: nothing was generated, no artifact
 * was written, and there is no run id for the desktop's task history to key on.
 *
 * So this builds the same record the agent service builds from runtime events,
 * from what the editor reports instead. The panel cannot tell the difference,
 * which is the point: there is one conversation, and how a change was carried
 * out is not the user's problem.
 *
 * Kept out of `useAgentTask` because it is a state machine with four outcomes
 * and no React in it — and because the interesting parts (what counts as
 * applied, what the summary is allowed to claim) are worth testing without a
 * renderer.
 */

export interface DocumentEditRunInput {
  instruction: string;
  folderId: string;
  fileId: string;
  fileName: string;
  reference?: AgentReference;
  /**
   * Which editor this instruction is for.
   *
   * The run itself is the same for both — read, plan, apply, save, and the same
   * three steps in the panel — so it is a parameter rather than a second copy.
   * It reaches the task so the panel and the file projection describe the right
   * file type, and the adapter routes to the matching in-place editor.
   */
  documentType: "docx" | "pptx";
}

export interface DocumentEditRunDeps {
  canvas: Pick<CanvasAdapter, "editDocument">;
  /** Every snapshot of the task, in order. The caller renders the last one. */
  onTask: (task: AgentTask) => void;
  now?: () => number;
}

export interface DocumentEditRunHandle {
  /** Resolves when the run is over, however it ended. Never rejects. */
  done: Promise<void>;
  /** Stops the run and the model call behind it. */
  abort: () => void;
  /** Reverts this edit, when it can be reverted. Rejects with why, when not. */
  undo: () => Promise<void>;
  /** The suggestion id this run owns, so Undo can be routed back to it. */
  suggestionId: string;
  /**
   * Answers the question this run is blocked on, if any.
   *
   * A question is a door, not a message — `AgentQuestion` says so — and a run
   * that put one up and cannot be answered is exactly the dead end that
   * description warns about. The in-place edit is a local run, so the shell's
   * answer has to reach it here rather than through the port.
   */
  answer: (input: { optionId?: string; text?: string }) => void;
}

const STEP_IDS = ["read", "draft", "apply"] as const;

/** Dictionary keys; a run is labelled in the language it started in. */
const STEP_LABELS: Record<(typeof STEP_IDS)[number], string> = {
  read: "shell.edit.step.read",
  draft: "shell.edit.step.draft",
  apply: "shell.edit.step.apply",
};

/** Which step a phase belongs to. Saving is applying, as far as a reader goes. */
const STEP_OF_PHASE: Record<DocumentEditPhase, (typeof STEP_IDS)[number]> = {
  reading: "read",
  drafting: "draft",
  applying: "apply",
  saving: "apply",
};

const PHASE_TEXT: Record<DocumentEditPhase, string> = {
  reading: "shell.edit.phase.reading",
  drafting: "shell.edit.phase.drafting",
  applying: "shell.edit.phase.applying",
  saving: "shell.edit.phase.saving",
};

let counter = 0;
const nextId = (prefix: string) => `${prefix}-${(counter += 1)}`;

/** Exists for tests: ids appear in snapshots and have to start somewhere known. */
export function resetDocumentEditIds(): void {
  counter = 0;
}

function title(instruction: string): string {
  return instruction.length > 60 ? `${instruction.slice(0, 60)}…` : instruction;
}

/**
 * How to describe a change in one line, without overstating it.
 *
 * The planner writes a summary whatever it did, including when it did nothing,
 * so the summary alone cannot be trusted to mean "applied". The count can: it
 * is what the editor reports having actually replaced.
 */
/**
 * What landed, said in the words of the thing it landed in.
 *
 * A deck counts slides where a document counts replacements, so "3 changes made
 * to the document" would be two kinds of wrong on a presentation. The noun comes
 * from the file type rather than from the count, because the count cannot tell
 * them apart.
 *
 * A scoped deck edit gets its own noun too. "The slides that needed it" is a
 * claim about the deck deciding, and a user who picked one title and was told
 * that has no way to know whether the other nine slides were left alone —
 * which, until scoping existed, they were not. "What you selected" is the
 * narrower and the checkable thing, and it stays true whether the pick was a
 * shape or a whole slide.
 */
function appliedLine(
  applied: number,
  scope: "selection" | "document",
  documentType: "docx" | "pptx",
): string {
  const where =
    documentType === "pptx"
      ? scope === "selection"
        ? translate("shell.edit.where.selection")
        : applied === 1
          ? translate("shell.edit.where.slideOne")
          : translate("shell.edit.where.slideMany")
      : scope === "selection"
        ? translate("shell.edit.where.selectedText")
        : translate("shell.edit.where.document");
  return applied === 1
    ? translate("shell.edit.appliedOne", { where })
    : translate("shell.edit.appliedMany", { count: applied, where });
}

export function startDocumentEditRun(
  deps: DocumentEditRunDeps,
  input: DocumentEditRunInput,
): DocumentEditRunHandle {
  const now = deps.now ?? (() => Date.now());
  const controller = new AbortController();
  const id = nextId("edit");
  const suggestionId = nextId("edit-suggestion");
  let revert: (() => Promise<{ saveError: string | null }>) | null = null;

  const task: AgentTask = {
    id,
    title: title(input.instruction),
    folderId: input.folderId,
    documentType: input.documentType,
    status: "reading",
    phase: translate(PHASE_TEXT.reading),
    steps: STEP_IDS.map((step, index) => ({
      id: `${id}:${step}`,
      label: translate(STEP_LABELS[step]),
      state: index === 0 ? "active" : "pending",
    })),
    messages: [
      {
        id: `${id}:instruction`,
        role: "user",
        text: input.instruction,
        createdAt: now(),
        ...(input.reference ? { reference: input.reference } : {}),
      },
    ],
    suggestion: null,
    question: null,
  };

  const emit = () => deps.onTask(structuredClone(task));

  const advance = (phase: DocumentEditPhase) => {
    const reached = STEP_IDS.indexOf(STEP_OF_PHASE[phase]);
    task.status = phase === "reading" ? "reading" : "writing";
    task.phase = translate(PHASE_TEXT[phase]);
    task.steps.forEach((step, index) => {
      step.state = index < reached ? "done" : index === reached ? "active" : "pending";
    });
    emit();
  };

  /*
   * The confirmation the run is waiting on, if any.
   *
   * Held as a resolver rather than as state because the run is *blocked* on it:
   * the editor asked whether to apply a plan and is awaiting the answer, so
   * there is nothing to re-render — there is something to release.
   */
  let pendingAnswer: ((optionId: string) => void) | null = null;

  const ask = (question: { text: string; detail?: string; danger?: boolean }): Promise<boolean> =>
    new Promise<boolean>((resolve) => {
      /*
       * `awaiting-review`, not a "question" status — there is no such member.
       * The card renders off `task.question` alone, and the status is what
       * stops the panel offering Pause/Finish for a run that is waiting on the
       * person rather than on itself.
       */
      task.status = "awaiting-review";
      task.phase = question.detail ?? question.text;
      task.question = {
        id: nextId("question"),
        text: question.text,
        /*
         * Which answer is offered first is not decoration on a dangerous
         * question. Recommending Apply on "this plan changes the whole deck,
         * you selected one title" is the app nudging the user through the one
         * gate that exists to stop it, and a gate everybody is nudged through
         * stops being read. So on those, Cancel is the recommendation and yes
         * has to be chosen deliberately; the planner's own "are you sure" keeps
         * the old default, because there the app has no reason to doubt it.
         */
        options: question.danger
          ? [
              { id: "apply", label: translate("shell.edit.applyAnyway") },
              { id: "cancel", label: translate("ui.text.Cancel"), recommended: true },
            ]
          : [
              { id: "apply", label: translate("shell.edit.applyChange"), recommended: true },
              { id: "cancel", label: translate("ui.text.Cancel") },
            ],
        allowFreeform: false,
      };
      emit();
      pendingAnswer = (optionId: string) => {
        pendingAnswer = null;
        task.question = null;
        task.status = "writing";
        emit();
        resolve(optionId === "apply");
      };
    });

  const answer = (input: { optionId?: string; text?: string }) => {
    // Free text is not an option list; the closest reading is "yes".
    const optionId = input.optionId ?? (input.text?.trim() ? "apply" : "cancel");
    pendingAnswer?.(optionId);
  };

  const say = (text: string) => {
    task.messages.push({ id: nextId("message"), role: "agent", text, createdAt: now() });
  };

  /*
   * Ends the run, and says how far it actually got.
   *
   * `completed` is not decoration. This used to tick every step on the way out
   * of all three exits, so a run that timed out in the planner still showed
   * "Read the document ✓ / Draft the change ✓ / Apply to the document ✓" beside
   * the failure that had just been reported — three claims the app knew were
   * false, next to the message saying so.
   *
   * `AgentStep.state` has no failure value (`done | active | pending`), and
   * adding one reaches the shared port and every panel that renders it. It is
   * not needed here: leaving the steps where the run left them already says the
   * true thing, which is that it stopped part way. The step it was *on* goes
   * back to pending rather than staying active, because a spinner on a finished
   * run never resolves.
   *
   * What went wrong is the conversation's job — `say()` has already put the
   * runtime's own sentence there — and `phase` names the outcome.
   */
  const finish = (phase: string, completed = true) => {
    task.status = "done";
    task.phase = phase;
    task.steps.forEach((step) => {
      if (completed) step.state = "done";
      else if (step.state === "active") step.state = "pending";
    });
  };

  emit();

  const done = (async () => {
    try {
      const result = await deps.canvas.editDocument!({
        instruction: input.instruction,
        onConfirm: ask,
        // A quoted passage is the user pointing at part of the document, and
        // it is the same selection the editor still has tracked. Without one,
        // the whole document is the scope.
        preferSelection: Boolean(input.reference),
        // And *which* passage, because "narrow this" is not a target. A deck
        // editor locates the selected shape from these words when its own
        // snapshot no longer has the selection the chip was captured from.
        ...(input.reference
          ? { selection: { label: input.reference.label, text: input.reference.text } }
          : {}),
        onPhase: advance,
        signal: controller.signal,
      });

      if (result.applied === 0) {
        /*
         * Nothing changed, and that is the honest report.
         *
         * The planner returns an empty edit list when it needs a clarification
         * or when the request asks for something it cannot do, and explains
         * itself in the summary. Showing a "Changes applied" card here — which
         * is what a summary-only check would do — would be the app claiming a
         * change the document never received.
         */
        say(result.summary || translate("shell.edit.nothingToChange"));
        finish(translate("shell.edit.noChangesNeeded"));
        emit();
        return;
      }

      revert = result.undo;
      say(result.summary);
      task.suggestion = {
        id: suggestionId,
        targetFileId: input.fileId,
        summary: result.saveError
          ? translate("shell.edit.notSaved", { applied: appliedLine(result.applied, result.scope, input.documentType), error: result.saveError })
          : appliedLine(result.applied, result.scope, input.documentType),
        applied: true,
        // The card's Undo is disabled rather than hidden when a change cannot
        // be taken back, and says why on hover — see `TaskPanel`.
        undoable: result.undo !== null,
      };
      /*
       * "Applied" and "saved" are different claims, and the phase makes the
       * weaker one when that is all that is true.
       *
       * A save that fails after the replacements have landed leaves the
       * document changed in the editor and unchanged on disk. The user can
       * still press Save, or undo — but only if the app tells them the edit
       * itself worked, which it used to not: the whole run was reported as a
       * failure and the document was quietly left dirty behind the message.
       */
      finish(result.saveError ? translate("shell.edit.changedNotSaved") : translate("shell.edit.changesApplied"));
      emit();
    } catch (reason) {
      if (controller.signal.aborted) {
        say(translate("shell.edit.stoppedUnchanged"));
        finish(translate("shell.edit.stopped"), false);
        emit();
        return;
      }
      say(reason instanceof Error ? reason.message : String(reason));
      finish(translate("shell.edit.editStopped"), false);
      emit();
    }
  })();

  return {
    done,
    abort: () => controller.abort(),
    answer,
    suggestionId,
    undo: async () => {
      if (!revert) {
        throw new Error(translate("shell.edit.notUndoable"));
      }
      const { saveError } = await revert();
      revert = null;
      /*
       * The card goes away rather than flipping to "not applied".
       *
       * `AgentSuggestion` is the port's shape for a change the agent *proposes*
       * and the user then applies, so `applied: false` renders as "Suggested
       * changes are ready" with a Review and apply button. For an in-place edit
       * that is a button with nothing behind it — the change was applied by the
       * editor, was just taken back out, and `agent.applySuggestion` has no
       * artifact to put anywhere. Its summary would be stale too: it counts
       * replacements that are no longer in the document.
       *
       * What is true after an undo is a sentence, and the reply below is it.
       */
      task.suggestion = null;
      // The revert happened whatever the write did, so it is reported first and
      // the write's failure is a qualifier on it — not a replacement for it.
      say(
        saveError
          ? translate("shell.edit.putBack", { name: input.fileName, error: saveError })
          : translate("shell.edit.reverted", { name: input.fileName }),
      );
      task.phase = saveError ? translate("shell.edit.revertedNotSaved") : translate("shell.edit.changeReverted");
      emit();
    },
  };
}
