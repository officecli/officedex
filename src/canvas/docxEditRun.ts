import type { DesktopAPI } from "../shared/types";
import type { WriterAgentEditor } from "../renderer/word/WriterEditorFrame";
import { agentClientId } from "../renderer/agentClientIdentity";
import { unwrapAgentRunResult, waitForAgentRun } from "../renderer/agentRuntime";
import type { DocumentEditRequest, DocumentEditResult } from "../shell/editor/canvasContract";

/**
 * Editing the Word document that is already open, in place.
 *
 * The model never sees the file. It is given the text of one scope — the
 * selection, or the whole document — and returns exact replacements inside it;
 * the editor performs them. Nothing is regenerated, nothing is written to a
 * second file, and the paragraph the user was looking at is still the paragraph
 * they were looking at.
 *
 * This is `office.docx.edit.v1`, the workflow the old workbench's Word panel
 * has used all along (`renderer/word/DocxAgentPanel.tsx`). The new shell sent
 * every instruction to the generation runtime instead, so "shorten the second
 * paragraph" meant regenerating the document from the prompt and overwriting
 * the open copy with the result. The planner's own contract is what makes the
 * narrow path safe: each query must occur exactly once in the supplied text,
 * queries may not overlap, at most 128 of them (internal/cli/docx_edit_planner.go).
 */

interface TextEdit {
  query: string;
  replacement: string;
}

interface EditPlan {
  summary: string;
  edits: TextEdit[];
}

export interface DocxEditDeps {
  readonly api: DesktopAPI;
  readonly editor: WriterAgentEditor;
  /** Where the document lives, when known — metadata for the run only. */
  readonly filePath?: string;
  /** Whether the user currently has a non-empty selection. Read at send time. */
  readonly hasSelection: () => boolean;
  /** `ui_locale` for the planner, which writes its summary in that language. */
  readonly locale?: string;
}

/** How long the planner gets before the run is abandoned and cancelled. */
const PLAN_TIMEOUT_MS = 180_000;

class EditAborted extends Error {
  constructor() {
    super("The edit was stopped.");
    this.name = "EditAborted";
  }
}

function assertLive(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new EditAborted();
}

/**
 * A promise that rejects the moment Stop is pressed, and otherwise never
 * settles — the losing half of a race with the thing being waited on.
 *
 * `onAbort` runs before the rejection so the run is cancelled on the way out
 * rather than after the caller has already given up on it.
 */
function abortedAsError(signal: AbortSignal | undefined, onAbort: () => void): Promise<never> {
  return new Promise<never>((_resolve, reject) => {
    if (!signal) return;
    if (signal.aborted) {
      onAbort();
      reject(new EditAborted());
      return;
    }
    signal.addEventListener(
      "abort",
      () => {
        onAbort();
        reject(new EditAborted());
      },
      { once: true },
    );
  });
}

/**
 * Whether this plan can be turned back into what was there before.
 *
 * Reversing an exact replacement is just swapping the two strings — but only
 * while the swap is itself unambiguous. A deletion has nothing to search for on
 * the way back, and an edit whose replacement text also appears elsewhere in the
 * document would undo in the wrong place. Both are refused up front, so the
 * Undo button is either honest or absent.
 */
function invertible(edits: TextEdit[]): boolean {
  if (edits.length === 0) return false;
  return edits.every((edit) => edit.replacement.trim().length > 0 && edit.replacement !== edit.query);
}

/** Every `needle` occurs exactly once in `haystack`. */
function eachOccursOnce(haystack: string, needles: string[]): boolean {
  return needles.every((needle) => {
    const first = haystack.indexOf(needle);
    return first >= 0 && !haystack.includes(needle, first + needle.length);
  });
}

export function createDocxEditRunner(deps: DocxEditDeps) {
  return async function editDocument(request: DocumentEditRequest): Promise<DocumentEditResult> {
    const instruction = request.instruction.trim();
    if (!instruction) throw new Error("There is no instruction to carry out.");

    const scope: "selection" | "document" =
      request.preferSelection && deps.hasSelection() ? "selection" : "document";

    assertLive(request.signal);
    request.onPhase?.("reading");
    /*
     * `capture` is not a read. It tracks a range for the `apply` that follows
     * and replaces whatever was tracked before, so the id it returns is the
     * only thing `apply` will accept — and taking a second capture in between
     * would expire it. One capture, one apply.
     */
    const captured = await deps.editor.capture(scope);

    assertLive(request.signal);
    request.onPhase?.("drafting");

    const started = await deps.api.startAgentRun({
      workflow: "office.docx.edit.v1",
      input: {
        parameters: {
          prompt: instruction,
          text: captured.text,
          scope: captured.scope,
          ...(deps.locale ? { ui_locale: deps.locale } : {}),
        },
      },
      metadata: {
        surface: "docx-editor",
        origin_client_id: agentClientId(),
        ...(deps.filePath ? { source_path: deps.filePath } : {}),
      },
    });

    // Stopping has to reach the run, not just this function: an abandoned run
    // keeps burning model time and credits on an answer nobody will read.
    const cancel = () => void deps.api.cancelAgentRun(started.id).catch(() => {});

    let plan: EditPlan;
    try {
      /*
       * Raced against Stop, not merely checked after it.
       *
       * `waitForAgentRun` polls to a deadline three minutes out and takes no
       * signal; awaiting it plainly means Stop does nothing visible until the
       * planner answers or the deadline passes. Cancelling the run makes it
       * end *eventually* — the next poll sees a cancelled run — but "eventually"
       * is the thing Stop exists to avoid. The losing side of the race keeps
       * polling harmlessly into a cancelled run, so its rejection is swallowed
       * rather than left to surface as an unhandled one.
       */
      const waiting = waitForAgentRun(started.id, {
        api: deps.api,
        timeoutMs: PLAN_TIMEOUT_MS,
        pollMs: 250,
        cancelOnTimeout: true,
      });
      waiting.catch(() => {});

      const outcome = await Promise.race([waiting, abortedAsError(request.signal, cancel)]);
      if (outcome.kind !== "completed") {
        // The workflow has no question step, so this is the runtime asking for
        // something this path cannot supply. Surfacing its words beats a
        // generic failure.
        throw new Error(outcome.question);
      }
      plan = unwrapAgentRunResult<EditPlan>(outcome.run);
    } catch (reason) {
      if (!(reason instanceof EditAborted)) cancel();
      throw reason;
    }

    assertLive(request.signal);
    if (!plan || typeof plan.summary !== "string" || !Array.isArray(plan.edits)) {
      throw new Error("The agent returned an edit plan this app could not read.");
    }

    // No edits is an answer, not an error: the planner returns an empty list
    // and explains itself in `summary` when it needs a clarification or when
    // the request asks for formatting it cannot do.
    if (plan.edits.length === 0) {
      return { summary: plan.summary, applied: 0, undo: null, scope, saveError: null };
    }

    request.onPhase?.("applying");
    const { replaced } = await deps.editor.apply(captured.id, plan.edits);

    // Nothing matched, so there is nothing to write. Saving here would push an
    // unchanged document through a DOCX export for no reason, and a failure in
    // that export would then be reported as a failure of the edit.
    if (replaced === 0) {
      return { summary: plan.summary, applied: 0, undo: null, scope, saveError: null };
    }

    /*
     * The save is allowed to fail on its own terms.
     *
     * By this point the replacements are *in the document* — the editor has
     * them, the user can see them, the tab is dirty. Letting a save failure
     * escape as an exception would report all of that as "the edit stopped",
     * which is both wrong and destructive to trust: the document has changed
     * and the app just said it had not. Observed with the Writer embed's DOCX
     * export, which fails for reasons that have nothing to do with whether the
     * text was replaced.
     *
     * So the failure travels back as data and the conversation says the true
     * thing: changed here, not yet written to disk.
     */
    request.onPhase?.("saving");
    let saveError: string | null = null;
    try {
      await deps.editor.save();
    } catch (reason) {
      saveError = reason instanceof Error ? reason.message : String(reason);
    }

    return {
      summary: plan.summary,
      applied: replaced,
      scope,
      saveError,
      undo: invertible(plan.edits) ? () => undo(deps, scope, plan.edits) : null,
    };
  };
}

/**
 * Puts the document back, by running the same replacements the other way.
 *
 * Writer has no undo verb on the embed protocol, and the shell has no snapshot
 * of the file — the edit was applied inside a live editor rather than to bytes
 * on disk. What it does have is an exact record of what was swapped for what,
 * which is enough as long as the swap is still unambiguous. It stops rather
 * than half-reverting: a document that has been edited since is left alone and
 * says so, because applying the reversible half of a change would leave the
 * user with a document that matches neither version.
 */
async function undo(
  deps: DocxEditDeps,
  scope: "selection" | "document",
  edits: TextEdit[],
): Promise<{ saveError: string | null }> {
  /*
   * Always the whole document, whatever the edit's scope was.
   *
   * A selection-scoped edit was applied to whatever was selected at the time,
   * and that selection is long gone — the user has clicked somewhere else, or
   * nowhere. Capturing "selection" now would track the caret and find none of
   * the replaced text.
   */
  void scope;
  const fresh = await deps.editor.capture("document");
  if (!eachOccursOnce(fresh.text, edits.map((edit) => edit.replacement))) {
    throw new Error(
      "This change can no longer be undone on its own — the document has moved on since it was applied.",
    );
  }
  await deps.editor.apply(
    fresh.id,
    edits.map((edit) => ({ query: edit.replacement, replacement: edit.query })),
  );
  // Same split as the forward path, and for the same reason: by here the
  // document is already back to what it was, so a failed write is "reverted but
  // not saved". Throwing would report the revert itself as having failed, and
  // the user would go looking for a change that is no longer there.
  try {
    await deps.editor.save();
    return { saveError: null };
  } catch (reason) {
    return { saveError: reason instanceof Error ? reason.message : String(reason) };
  }
}
