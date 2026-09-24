import { describe, expect, it, vi } from "vitest";

import {
  resetDocumentEditIds,
  startDocumentEditRun,
  type DocumentEditRunInput,
} from "./documentEditRun";
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

const input: DocumentEditRunInput = {
  instruction: "Shorten the second paragraph",
  folderId: "folder-launch",
  fileId: "file-plan",
  fileName: "MO launch plan.docx",
  documentType: "docx",
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

  /*
   * Three ticks beside a failure is three claims the app knows are false.
   *
   * Reported from the field: a title edit failed with `bridge: officecli bridge
   * request timed out: pptx/plan-js`, and the panel showed "Read the document ✓
   * / Draft the change ✓ / Apply to the document ✓" next to the error. The run
   * had reached the planner and stopped there; it never applied anything.
   *
   * `AgentStep.state` has no failure value, so what is asserted is the weaker
   * true thing: the steps stay where the run left them, and the one it was on
   * does not keep spinning on a run that is over.
   */
  it("does not tick the steps it never took when the edit fails", async () => {
    const { snapshots, onTask } = collect();
    const run = startDocumentEditRun(
      {
        canvas: {
          editDocument: async (request: DocumentEditRequest) => {
            request.onPhase?.("reading");
            request.onPhase?.("drafting");
            throw new Error("bridge: officecli bridge request timed out: pptx/plan-js");
          },
        },
        onTask,
      },
      input,
    );
    await expect(run.done).resolves.toBeUndefined();

    const last = snapshots.at(-1)!;
    const byId = (suffix: string) => last.steps.find((step) => step.id.endsWith(suffix))!;
    expect(byId("read").state, "reading did happen").toBe("done");
    expect(byId("draft").state, "the planner never answered").not.toBe("done");
    expect(byId("apply").state, "nothing was applied").toBe("pending");
    // A spinner on a finished run never resolves.
    expect(last.steps.some((step) => step.state === "active")).toBe(false);
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
   * And *which* selection, because "narrow this" is not a target.
   *
   * The deck path needs the words: it resolves the scope from the editor's own
   * snapshot, and when that snapshot no longer holds the selection the chip was
   * captured from, the quoted text is the only way left to find the shape the
   * user pointed at. A flag alone sent it back to editing the whole deck.
   */
  it("passes the quoted passage down, not only the fact that there was one", async () => {
    const seen: DocumentEditRequest[] = [];
    const canvas = {
      editDocument: async (request: DocumentEditRequest): Promise<DocumentEditResult> => {
        seen.push(request);
        return { summary: "done", applied: 1, undo: null, scope: "selection" as const, saveError: null };
      },
    };

    await startDocumentEditRun(
      { canvas, onTask: () => {} },
      {
        ...input,
        reference: { fileId: "file-plan", label: "deck.pptx · Title 1", text: "Why We Win" },
      },
    ).done;
    await startDocumentEditRun({ canvas, onTask: () => {} }, input).done;

    expect(seen[0].selection).toEqual({ label: "deck.pptx · Title 1", text: "Why We Win" });
    expect(seen[1].selection).toBeUndefined();
  });

  /*
   * A deck edit that stayed inside the selection says so.
   *
   * "The slides that needed it" is the deck deciding, and a user who picked one
   * title and read that had no way to tell whether the other nine slides were
   * left alone — which, before the edit was scoped, they were not.
   */
  it("names the selection when a deck edit was scoped to one", async () => {
    const { snapshots, onTask } = collect();
    await startDocumentEditRun(
      { canvas: canvasReturning({ applied: 1, scope: "selection" }), onTask },
      { ...input, documentType: "pptx", fileName: "deck.pptx" },
    ).done;

    expect(snapshots.at(-1)!.suggestion?.summary).toBe("One change made to what you selected.");
  });

  it("still counts slides when a deck edit was not scoped", async () => {
    const { snapshots, onTask } = collect();
    await startDocumentEditRun(
      { canvas: canvasReturning({ applied: 2, scope: "document" }), onTask },
      { ...input, documentType: "pptx", fileName: "deck.pptx" },
    ).done;

    expect(snapshots.at(-1)!.suggestion?.summary).toBe("2 changes made to the slides that needed it.");
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

/**
 * A run that asks before it changes anything.
 *
 * The deck planner sets `requires_confirmation` for an instruction that reads
 * as more than it looks, and the question has to be answerable: `AgentQuestion`
 * is documented as "a door it is standing behind", and a local run that put one
 * up with no way through would be the dead end that description warns about.
 * Answers for a local run never reach the port, so the handle carries them.
 */
function canvasAsking(): { seen: DocumentEditRequest[] } {
  const seen: DocumentEditRequest[] = [];
  return {
    seen,
    editDocument: async (request: DocumentEditRequest): Promise<DocumentEditResult> => {
      seen.push(request);
      const approved = await request.onConfirm?.({
        text: "This changes a dozen text runs. Continue?",
      });
      if (!approved) {
        return {
          summary: "Cancelled. The deck was not changed.",
          applied: 0,
          scope: "document",
          undo: null,
          saveError: null,
        };
      }
      return {
        summary: "Translated slide 2.",
        applied: 1,
        scope: "document",
        undo: null,
        saveError: null,
      };
    },
  } as never;
}

describe("a run that asks first", () => {
  it("puts the question on the task and finishes only once it is answered", async () => {
    resetDocumentEditIds();
    const canvas = canvasAsking();
    const tasks: AgentTask[] = [];
    const run = startDocumentEditRun(
      { canvas: canvas as never, onTask: (task) => tasks.push(structuredClone(task)) },
      input,
    );

    // The question is up, and the run has not gone past it.
    const asked = await vi.waitFor(() => {
      const withQuestion = tasks.find((task) => task.question);
      expect(withQuestion).toBeDefined();
      return withQuestion!;
    });
    expect(asked.question?.text).toContain("dozen text runs");
    expect(asked.question?.options.map((option) => option.id)).toEqual(["apply", "cancel"]);
    expect(tasks.some((task) => task.suggestion)).toBe(false);

    run.answer({ optionId: "apply" });
    await run.done;

    const finished = tasks.at(-1)!;
    expect(finished.question).toBeNull();
    expect(finished.suggestion?.applied).toBe(true);
    expect(finished.status).toBe("done");
  });

  it("changes nothing when the answer is no", async () => {
    resetDocumentEditIds();
    const canvas = canvasAsking();
    const tasks: AgentTask[] = [];
    const run = startDocumentEditRun(
      { canvas: canvas as never, onTask: (task) => tasks.push(structuredClone(task)) },
      input,
    );

    await vi.waitFor(() => expect(tasks.some((task) => task.question)).toBe(true));
    run.answer({ optionId: "cancel" });
    await run.done;

    const finished = tasks.at(-1)!;
    expect(finished.suggestion).toBeNull();
    expect(finished.messages.some((message) => /cancel/i.test(message.text))).toBe(true);
  });

  /*
   * A confirmation whose default answer is yes is a formality, and a formality
   * in front of "this plan changes the whole deck and you selected one title"
   * is worse than no question at all: it teaches the user to click through the
   * one gate that exists to stop that edit.
   */
  it("does not recommend Apply on a dangerous question", async () => {
    resetDocumentEditIds();
    const tasks: AgentTask[] = [];
    const canvas = {
      editDocument: async (request: DocumentEditRequest): Promise<DocumentEditResult> => {
        const approved = await request.onConfirm?.({
          text: "This plan reaches past your selection. Apply it to the rest of the deck anyway?",
          danger: true,
        });
        return {
          summary: approved ? "Applied." : "Cancelled. The deck was not changed.",
          applied: approved ? 1 : 0,
          scope: "document" as const,
          undo: null,
          saveError: null,
        };
      },
    };
    const run = startDocumentEditRun(
      { canvas, onTask: (task) => tasks.push(structuredClone(task)) },
      { ...input, documentType: "pptx" },
    );

    const asked = await vi.waitFor(() => {
      const withQuestion = tasks.find((task) => task.question);
      expect(withQuestion).toBeDefined();
      return withQuestion!;
    });
    const options = asked.question!.options;
    expect(options.find((option) => option.id === "apply")?.recommended).toBeUndefined();
    expect(options.find((option) => option.id === "cancel")?.recommended).toBe(true);

    run.answer({ optionId: "cancel" });
    await run.done;
    expect(tasks.at(-1)!.suggestion).toBeNull();
  });

  it("still recommends Apply on the planner's own caution", async () => {
    resetDocumentEditIds();
    const canvas = canvasAsking();
    const tasks: AgentTask[] = [];
    const run = startDocumentEditRun(
      { canvas: canvas as never, onTask: (task) => tasks.push(structuredClone(task)) },
      input,
    );

    const asked = await vi.waitFor(() => {
      const withQuestion = tasks.find((task) => task.question);
      expect(withQuestion).toBeDefined();
      return withQuestion!;
    });
    expect(asked.question!.options.find((option) => option.id === "apply")?.recommended).toBe(true);

    run.answer({ optionId: "cancel" });
    await run.done;
  });
});
