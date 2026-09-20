import { describe, expect, it, vi } from "vitest";

import { resetDocumentEditIds, startDocumentEditRun } from "./documentEditRun";
import type { AgentTask } from "../../shared/uiPort";
import type { DocumentEditRequest, DocumentEditResult } from "../editor/canvasContract";

/**
 * The conversation an in-place edit produces.
 *
 * What is being pinned here is what the panel is allowed to *claim*: that a
 * change was applied, and that it can be taken back. Both have a way of
 * drifting from what happened — the planner writes a cheerful summary whether
 * or not it produced any edits, and an edit that replaced text with nothing has
 * no search term to reverse it with.
 */

function collect() {
  const snapshots: AgentTask[] = [];
  return { snapshots, onTask: (task: AgentTask) => void snapshots.push(task) };
}

const input = {
  instruction: "Shorten the second paragraph",
  folderId: "folder-launch",
  fileId: "file-plan",
  fileName: "MO launch plan.docx",
};

function canvasReturning(result: Partial<DocumentEditResult> & { applied: number }) {
  return {
    editDocument: async (request: DocumentEditRequest): Promise<DocumentEditResult> => {
      request.onPhase?.("reading");
      request.onPhase?.("drafting");
      request.onPhase?.("applying");
      return {
        summary: "Trimmed the second paragraph.",
        scope: "document" as const,
        undo: null,
        saveError: null,
        ...result,
      };
    },
  };
}

describe("startDocumentEditRun", () => {
  it("opens with the instruction as a user message and the first step active", async () => {
    resetDocumentEditIds();
    const { snapshots, onTask } = collect();
    const run = startDocumentEditRun({ canvas: canvasReturning({ applied: 2 }), onTask }, input);
    await run.done;

    const first = snapshots[0];
    expect(first.messages).toHaveLength(1);
    expect(first.messages[0]).toMatchObject({ role: "user", text: "Shorten the second paragraph" });
    expect(first.steps.map((step) => step.state)).toEqual(["active", "pending", "pending"]);
    expect(first.documentType).toBe("docx");
  });

  it("reports an applied change with a count that came from the editor", async () => {
    const { snapshots, onTask } = collect();
    const run = startDocumentEditRun(
      { canvas: canvasReturning({ applied: 3, scope: "selection", undo: async () => ({ saveError: null }) }), onTask },
      input,
    );
    await run.done;

    const last = snapshots.at(-1)!;
    expect(last.status).toBe("done");
    expect(last.suggestion).toMatchObject({
      targetFileId: "file-plan",
      applied: true,
      undoable: true,
      summary: "3 changes made to the selected text.",
    });
    // The planner's own words are the reply; the card states the count.
    expect(last.messages.at(-1)).toMatchObject({ role: "agent", text: "Trimmed the second paragraph." });
  });

  /*
   * The planner answers with an empty edit list and an explanation when it
   * needs a clarification or cannot do what was asked. A summary is not
   * evidence that anything happened.
   */
  it("does not claim a change when the editor applied none", async () => {
    const { snapshots, onTask } = collect();
    const run = startDocumentEditRun(
      {
        canvas: canvasReturning({
          applied: 0,
          summary: "Which of the two tables did you mean?",
        }),
        onTask,
      },
      input,
    );
    await run.done;

    const last = snapshots.at(-1)!;
    expect(last.suggestion).toBeNull();
    expect(last.phase).toBe("No changes were needed");
    expect(last.messages.at(-1)?.text).toBe("Which of the two tables did you mean?");
  });

  it("offers no Undo when the edit cannot be reversed", async () => {
    const { snapshots, onTask } = collect();
    const run = startDocumentEditRun({ canvas: canvasReturning({ applied: 1, undo: null }), onTask }, input);
    await run.done;

    expect(snapshots.at(-1)!.suggestion).toMatchObject({ applied: true, undoable: false });
    await expect(run.undo()).rejects.toThrow(/no longer be undone/);
  });

  it("runs the editor's own undo and says the file is back", async () => {
    const revert = vi.fn(async () => ({ saveError: null as string | null }));
    const { snapshots, onTask } = collect();
    const run = startDocumentEditRun(
      { canvas: canvasReturning({ applied: 1, undo: revert }), onTask },
      input,
    );
    await run.done;
    await run.undo();

    expect(revert).toHaveBeenCalledTimes(1);
    const last = snapshots.at(-1)!;
    // The card is gone, not flipped: see the note in `undo`.
    expect(last.suggestion).toBeNull();
    expect(last.messages.at(-1)?.text).toContain("MO launch plan.docx is back");
    // Undo is not a thing you do twice.
    await expect(run.undo()).rejects.toThrow(/no longer be undone/);
  });

  it("turns a failure into a reply rather than an unhandled rejection", async () => {
    const { snapshots, onTask } = collect();
    const run = startDocumentEditRun(
      {
        canvas: {
          editDocument: async () => {
            throw new Error("The Word editor stopped responding.");
          },
        },
        onTask,
      },
      input,
    );
    await expect(run.done).resolves.toBeUndefined();

    const last = snapshots.at(-1)!;
    expect(last.status).toBe("done");
    expect(last.messages.at(-1)?.text).toBe("The Word editor stopped responding.");
    expect(last.suggestion).toBeNull();
  });

  it("says the document was left alone when the run is stopped", async () => {
    const { snapshots, onTask } = collect();
    let release: () => void = () => {};
    const run = startDocumentEditRun(
      {
        canvas: {
          editDocument: async (request) =>
            new Promise((_resolve, reject) => {
              release = () => reject(new Error("aborted"));
              request.signal?.addEventListener("abort", release);
            }),
        },
        onTask,
      },
      input,
    );

    run.abort();
    await run.done;

    const last = snapshots.at(-1)!;
    expect(last.phase).toBe("Stopped");
    expect(last.messages.at(-1)?.text).toBe("Stopped. The document was not changed.");
  });

  it("scopes to the selection only when the message quoted one", async () => {
    const seen: boolean[] = [];
    const canvas = {
      editDocument: async (request: DocumentEditRequest): Promise<DocumentEditResult> => {
        seen.push(request.preferSelection);
        return { summary: "done", applied: 1, undo: null, scope: "document" as const, saveError: null };
      },
    };

    await startDocumentEditRun({ canvas, onTask: () => {} }, input).done;
    await startDocumentEditRun(
      { canvas, onTask: () => {} },
      { ...input, reference: { fileId: "file-plan", label: "MO launch plan.docx · 2 paragraphs", text: "…" } },
    ).done;

    expect(seen).toEqual([false, true]);
  });

  /*
   * The case a real run turned up: the replacements landed, and the Writer
   * embed's DOCX export then failed. Reported as a plain failure — which is
   * what it used to be — the panel said the edit stopped while the document
   * sat there modified and unsaved, with the Undo that could have rescued it
   * never offered.
   */
  it("says the change landed but is unsaved when only the save failed", async () => {
    const { snapshots, onTask } = collect();
    const run = startDocumentEditRun(
      {
        canvas: canvasReturning({
          applied: 1,
          undo: async () => ({ saveError: null }),
          saveError: "DOCX export unavailable: docx-export-failed.",
        }),
        onTask,
      },
      input,
    );
    await run.done;

    const last = snapshots.at(-1)!;
    expect(last.phase).toBe("Changed, but not saved");
    expect(last.suggestion).toMatchObject({ applied: true, undoable: true });
    expect(last.suggestion?.summary).toContain("not saved yet");
    expect(last.suggestion?.summary).toContain("docx-export-failed");
  });

  /*
   * And the same on the way back. The first version of this threw when the
   * write failed, which — since the revert had already happened — left the
   * document restored, the card still reading "Changes applied", and an Undo
   * button offering to undo something that was no longer there. Caught on a
   * real document, not in review.
   */
  it("says the document was put back even when saving it failed", async () => {
    const { snapshots, onTask } = collect();
    const run = startDocumentEditRun(
      {
        canvas: canvasReturning({
          applied: 1,
          undo: async () => ({ saveError: "DOCX export unavailable: docx-export-failed." }),
        }),
        onTask,
      },
      input,
    );
    await run.done;
    await run.undo();

    const last = snapshots.at(-1)!;
    expect(last.suggestion).toBeNull();
    expect(last.phase).toBe("Reverted, but not saved");
    expect(last.messages.at(-1)?.text).toContain("not saved yet");
  });
});
