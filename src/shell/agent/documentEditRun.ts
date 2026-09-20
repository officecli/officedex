import type { AgentTask, AgentReference } from "../../shared/uiPort";
import type { CanvasAdapter, DocumentEditPhase } from "../editor/canvasContract";

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
}

const STEP_IDS = ["read", "draft", "apply"] as const;

const STEP_LABELS: Record<(typeof STEP_IDS)[number], string> = {
  read: "Read the document",
  draft: "Draft the change",
  apply: "Apply to the document",
};

/** Which step a phase belongs to. Saving is applying, as far as a reader goes. */
const STEP_OF_PHASE: Record<DocumentEditPhase, (typeof STEP_IDS)[number]> = {
  reading: "read",
  drafting: "draft",
  applying: "apply",
  saving: "apply",
};

const PHASE_TEXT: Record<DocumentEditPhase, string> = {
  reading: "Reading the document",
  drafting: "Working out what to change",
  applying: "Applying the changes",
  saving: "Saving",
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
function appliedLine(applied: number, scope: "selection" | "document"): string {
  const where = scope === "selection" ? "the selected text" : "the document";
  return applied === 1
    ? `One change made to ${where}.`
    : `${applied} changes made to ${where}.`;
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
    documentType: "docx",
    status: "reading",
    phase: PHASE_TEXT.reading,
    steps: STEP_IDS.map((step, index) => ({
      id: `${id}:${step}`,
      label: STEP_LABELS[step],
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
    task.phase = PHASE_TEXT[phase];
    task.steps.forEach((step, index) => {
      step.state = index < reached ? "done" : index === reached ? "active" : "pending";
    });
    emit();
  };

  const say = (text: string) => {
    task.messages.push({ id: nextId("message"), role: "agent", text, createdAt: now() });
  };

  const finish = (phase: string) => {
    task.status = "done";
    task.phase = phase;
    task.steps.forEach((step) => {
      step.state = "done";
    });
  };

  emit();

  const done = (async () => {
    try {
      const result = await deps.canvas.editDocument!({
        instruction: input.instruction,
        // A quoted passage is the user pointing at part of the document, and
        // it is the same selection the editor still has tracked. Without one,
        // the whole document is the scope.
        preferSelection: Boolean(input.reference),
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
        say(result.summary || "Nothing in the document needed to change.");
        finish("No changes were needed");
        emit();
        return;
      }

      revert = result.undo;
      say(result.summary);
      task.suggestion = {
        id: suggestionId,
        targetFileId: input.fileId,
        summary: result.saveError
          ? `${appliedLine(result.applied, result.scope)} They are not saved yet — ${result.saveError}`
          : appliedLine(result.applied, result.scope),
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
      finish(result.saveError ? "Changed, but not saved" : "Changes applied");
      emit();
    } catch (reason) {
      if (controller.signal.aborted) {
        say("Stopped. The document was not changed.");
        finish("Stopped");
        emit();
        return;
      }
      say(reason instanceof Error ? reason.message : String(reason));
      finish("The edit stopped");
      emit();
    }
  })();

  return {
    done,
    abort: () => controller.abort(),
    suggestionId,
    undo: async () => {
      if (!revert) {
        throw new Error("This change can no longer be undone.");
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
          ? `Put back. ${input.fileName} is not saved yet — ${saveError}`
          : `Reverted. ${input.fileName} is back to what it was.`,
      );
      task.phase = saveError ? "Reverted, but not saved" : "Change reverted";
      emit();
    },
  };
}
