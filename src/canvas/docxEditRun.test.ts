import { describe, expect, it, vi } from "vitest";

import { createDocxEditRunner } from "./docxEditRun";
import type { DesktopAPI } from "../shared/types";
import type { WriterAgentEditor } from "../renderer/word/WriterEditorFrame";

/**
 * The Word edit path, from an instruction to replacements in the open document.
 *
 * The properties worth holding still are the ones that were wrong before this
 * path existed, or that would be silently wrong if the wiring slipped: that the
 * planner is given the *captured* text rather than the file, that the capture
 * id used for `apply` is the one `capture` just returned, and that Undo refuses
 * rather than guessing when the document has moved on.
 */

function editor(text: string): WriterAgentEditor & {
  apply: ReturnType<typeof vi.fn>;
  save: ReturnType<typeof vi.fn>;
  capture: ReturnType<typeof vi.fn>;
} {
  let captures = 0;
  let current = text;
  const apply = vi.fn(async (_id: string, edits: { query: string; replacement: string }[]) => {
    let replaced = 0;
    for (const edit of edits) {
      if (!current.includes(edit.query)) continue;
      current = current.replace(edit.query, edit.replacement);
      replaced += 1;
    }
    return { replaced };
  });
  const capture = vi.fn(async (scope: "selection" | "document") => {
    captures += 1;
    return { id: `capture-${captures}`, text: current, scope };
  });
  return { capture, apply, save: vi.fn(async () => undefined) } as never;
}

function api(plan: unknown, overrides: Partial<DesktopAPI> = {}): DesktopAPI {
  return {
    startAgentRun: vi.fn(async () => ({ id: "run-1", status: "running" })),
    getAgentRun: vi.fn(async () => ({ id: "run-1", status: "completed", result: plan, events: [] })),
    cancelAgentRun: vi.fn(async () => undefined),
    ...overrides,
  } as unknown as DesktopAPI;
}

const ONE_EDIT = {
  summary: "Tightened the opening line.",
  edits: [{ query: "It is very important to note that we", replacement: "We" }],
};

describe("createDocxEditRunner", () => {
  it("plans against the captured text and applies with that capture's id", async () => {
    const writer = editor("It is very important to note that we ship on Friday.");
    const desktop = api(ONE_EDIT);
    const run = createDocxEditRunner({
      api: desktop,
      editor: writer,
      filePath: "/tmp/plan.docx",
      hasSelection: () => false,
      locale: "en",
    });

    const result = await run({ instruction: "Cut the throat-clearing", preferSelection: false });

    expect(desktop.startAgentRun).toHaveBeenCalledWith(
      expect.objectContaining({
        workflow: "office.docx.edit.v1",
        input: {
          parameters: expect.objectContaining({
            prompt: "Cut the throat-clearing",
            text: "It is very important to note that we ship on Friday.",
            scope: "document",
            ui_locale: "en",
          }),
        },
      }),
    );
    expect(writer.apply).toHaveBeenCalledWith("capture-1", ONE_EDIT.edits);
    expect(writer.save).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ applied: 1, scope: "document", summary: "Tightened the opening line." });
  });

  it("narrows to the selection only when there is one to narrow to", async () => {
    const withSelection = editor("Some selected words.");
    await createDocxEditRunner({
      api: api(ONE_EDIT),
      editor: withSelection,
      hasSelection: () => true,
    })({ instruction: "Rewrite", preferSelection: true });
    expect(withSelection.capture).toHaveBeenCalledWith("selection");

    // Asked for the selection, but the caret is collapsed: the whole document
    // is the honest scope, not an empty one.
    const noSelection = editor("Some words.");
    await createDocxEditRunner({
      api: api(ONE_EDIT),
      editor: noSelection,
      hasSelection: () => false,
    })({ instruction: "Rewrite", preferSelection: true });
    expect(noSelection.capture).toHaveBeenCalledWith("document");
  });

  it("returns the explanation and touches nothing when the plan has no edits", async () => {
    const writer = editor("Unchanged.");
    const result = await createDocxEditRunner({
      api: api({ summary: "I need to know which section you mean.", edits: [] }),
      editor: writer,
      hasSelection: () => false,
    })({ instruction: "Make it shorter", preferSelection: false });

    expect(result).toMatchObject({ applied: 0, undo: null });
    expect(result.summary).toBe("I need to know which section you mean.");
    expect(writer.apply).not.toHaveBeenCalled();
    expect(writer.save).not.toHaveBeenCalled();
  });

  it("puts the document back by running the replacements the other way", async () => {
    const writer = editor("It is very important to note that we ship on Friday.");
    const result = await createDocxEditRunner({
      api: api(ONE_EDIT),
      editor: writer,
      hasSelection: () => false,
    })({ instruction: "Cut it", preferSelection: false });

    expect(result.undo).not.toBeNull();
    await result.undo!();

    expect(writer.apply).toHaveBeenLastCalledWith("capture-2", [
      { query: "We", replacement: "It is very important to note that we" },
    ]);
  });

  it("reports a failed save on the way back without claiming the revert failed", async () => {
    const writer = editor("It is very important to note that we ship on Friday.");
    const result = await createDocxEditRunner({
      api: api(ONE_EDIT),
      editor: writer,
      hasSelection: () => false,
    })({ instruction: "Cut it", preferSelection: false });

    writer.save.mockRejectedValueOnce(new Error("DOCX export unavailable: docx-export-failed."));
    const outcome = await result.undo!();

    expect(outcome.saveError).toContain("docx-export-failed");
    // The replacement was still reversed in the editor — that is the part the
    // caller must be able to report truthfully.
    expect(writer.apply).toHaveBeenCalledTimes(2);
  });

  /*
   * A deletion has no search term on the way back, so the reverse replacement
   * would be an empty query — which the editor cannot act on and the planner's
   * own contract forbids. Better no button than a button that does nothing.
   */
  it("offers no undo for a deletion", async () => {
    const result = await createDocxEditRunner({
      api: api({ summary: "Removed the disclaimer.", edits: [{ query: "Disclaimer. ", replacement: "" }] }),
      editor: editor("Disclaimer. We ship on Friday."),
      hasSelection: () => false,
    })({ instruction: "Drop the disclaimer", preferSelection: false });

    expect(result.applied).toBe(1);
    expect(result.undo).toBeNull();
  });

  it("refuses to undo once the replaced text is no longer unique", async () => {
    const writer = editor("It is very important to note that we ship on Friday.");
    const result = await createDocxEditRunner({
      api: api(ONE_EDIT),
      editor: writer,
      hasSelection: () => false,
    })({ instruction: "Cut it", preferSelection: false });

    // The user kept typing, and now the replacement text appears twice.
    writer.capture.mockImplementationOnce(async () => ({
      id: "capture-late",
      text: "We ship on Friday. We also ship on Monday.",
      scope: "document" as const,
    }));

    await expect(result.undo!()).rejects.toThrow(/moved on since/);
    expect(writer.apply).toHaveBeenCalledTimes(1);
  });

  it("reports phases in order so a slow plan does not look like a hang", async () => {
    const phases: string[] = [];
    await createDocxEditRunner({
      api: api(ONE_EDIT),
      editor: editor("It is very important to note that we ship."),
      hasSelection: () => false,
    })({
      instruction: "Cut it",
      preferSelection: false,
      onPhase: (phase) => void phases.push(phase),
    });

    expect(phases).toEqual(["reading", "drafting", "applying", "saving"]);
  });

  it("cancels the run when the caller stops waiting for it", async () => {
    const controller = new AbortController();
    const desktop = api(ONE_EDIT, {
      getAgentRun: vi.fn(async () => {
        controller.abort();
        return { id: "run-1", status: "running", events: [] } as never;
      }),
    });

    const pending = createDocxEditRunner({
      api: desktop,
      editor: editor("Anything."),
      hasSelection: () => false,
    })({ instruction: "Cut it", preferSelection: false, signal: controller.signal });

    await expect(pending).rejects.toThrow();
    expect(desktop.cancelAgentRun).toHaveBeenCalledWith("run-1");
  });

  it("rejects an instruction that is only whitespace before calling anything", async () => {
    const writer = editor("Anything.");
    const desktop = api(ONE_EDIT);
    await expect(
      createDocxEditRunner({ api: desktop, editor: writer, hasSelection: () => false })({
        instruction: "   ",
        preferSelection: false,
      }),
    ).rejects.toThrow(/no instruction/i);
    expect(writer.capture).not.toHaveBeenCalled();
    expect(desktop.startAgentRun).not.toHaveBeenCalled();
  });

  /*
   * A real run turned this up. The replacements went into the document, the
   * Writer embed's DOCX export then failed, and the whole edit was reported as
   * a failure — leaving the user's document modified, unsaved, and described
   * as untouched.
   */
  it("reports a failed save as a failed save, not as a failed edit", async () => {
    const writer = editor("It is very important to note that we ship on Friday.");
    writer.save.mockRejectedValueOnce(new Error("DOCX export unavailable: docx-export-failed."));

    const result = await createDocxEditRunner({
      api: api(ONE_EDIT),
      editor: writer,
      hasSelection: () => false,
    })({ instruction: "Cut it", preferSelection: false });

    expect(result.applied).toBe(1);
    expect(result.saveError).toContain("docx-export-failed");
    // Still undoable: the change is in the editor, which is exactly where the
    // undo would put it back.
    expect(result.undo).not.toBeNull();
  });

  /*
   * A plan whose queries match nothing leaves the document untouched, so there
   * is nothing to write. Saving anyway would push an unchanged document through
   * a DOCX export, and a failure there would be reported as a failed edit.
   */
  it("does not save when no replacement matched", async () => {
    const writer = editor("A document that says nothing of the kind.");
    const result = await createDocxEditRunner({
      api: api(ONE_EDIT),
      editor: writer,
      hasSelection: () => false,
    })({ instruction: "Cut it", preferSelection: false });

    expect(result.applied).toBe(0);
    expect(result.undo).toBeNull();
    expect(writer.save).not.toHaveBeenCalled();
  });

  it("reports a clean save as having nothing to report", async () => {
    const result = await createDocxEditRunner({
      api: api(ONE_EDIT),
      editor: editor("It is very important to note that we ship on Friday."),
      hasSelection: () => false,
    })({ instruction: "Cut it", preferSelection: false });

    expect(result.saveError).toBeNull();
  });
});
