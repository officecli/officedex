import { act, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SEED_ACTIVE_FILE_ID } from "../port/fake/seed";
import { renderShell } from "../test/renderShell";
import type { CanvasAdapter, CanvasDraft, CanvasSelection } from "../editor/canvasContract";

afterEach(cleanup);

/**
 * The seam between the embedded editor and the shell around it.
 *
 * Two things cross it, and neither could before: the editor tells the shell the
 * document is dirty, and the shell tells the editor to write it out. Both were
 * missing in a way that only shows up once a real editor is mounted — the save
 * button called `files.save`, which clears the flag and writes nothing, so
 * pressing it would have marked unsaved work as saved.
 */
function fakeAdapter() {
  let dirtyListener: ((dirty: boolean) => void) | null = null;
  let selectionListener: ((selection: CanvasSelection | null) => void) | null = null;
  let draftListener: ((action: "apply") => void) | null = null;
  const save = vi.fn(async () => {});
  const showDraft = vi.fn((_draft: CanvasDraft | null) => {});
  const resolveSelection = vi.fn(async (): Promise<CanvasSelection | null> => ({
    fileId: SEED_ACTIVE_FILE_ID,
    label: "MO launch plan.docx · Heading",
    text: "A better everyday workspace",
  }));
  const adapter: CanvasAdapter = {
    mount() {},
    show() {},
    hide() {},
    unmount() {},
    onSelection(listener) {
      selectionListener = listener;
      return () => {
        selectionListener = null;
      };
    },
    resolveSelection,
    onDirtyChange(listener) {
      dirtyListener = listener;
      return () => {
        dirtyListener = null;
      };
    },
    showDraft,
    onDraftAction(listener) {
      draftListener = listener;
      return () => {
        draftListener = null;
      };
    },
    save,
  };
  return {
    adapter,
    save,
    showDraft,
    resolveSelection,
    report: (dirty: boolean) => dirtyListener?.(dirty),
    select: (selection: CanvasSelection | null) => selectionListener?.(selection),
    applyFromDocument: () => draftListener?.("apply"),
  };
}

const saveButton = (container: HTMLElement) =>
  container.querySelector<HTMLButtonElement>(".shell-save-state")!;

describe("canvas ⇄ shell", () => {
  it("shows the editor's unsaved state in the tab bar", async () => {
    const { adapter, report } = fakeAdapter();
    const shell = await renderShell({ canvas: adapter });
    await shell.dispatch({ type: "open-file", fileId: SEED_ACTIVE_FILE_ID });

    expect(saveButton(shell.view.container).textContent).toContain("Saved");

    await act(async () => {
      report(true);
    });

    await waitFor(() => {
      expect(saveButton(shell.view.container).textContent).toContain("Unsaved");
    });
  });

  // The order matters and is the whole point: bytes first, flag second.
  it("writes through the editor before clearing the flag", async () => {
    const { adapter, save, report } = fakeAdapter();
    const shell = await renderShell({ canvas: adapter });
    await shell.dispatch({ type: "open-file", fileId: SEED_ACTIVE_FILE_ID });
    await act(async () => {
      report(true);
    });
    await waitFor(() => {
      expect(saveButton(shell.view.container).textContent).toContain("Unsaved");
    });

    await act(async () => {
      fireEvent.click(saveButton(shell.view.container));
    });

    expect(save).toHaveBeenCalledOnce();
    await waitFor(() => {
      expect(saveButton(shell.view.container).textContent).toContain("Saved");
    });
  });

  // A browser has no embedded editor. The shell has to stay usable there — it
  // is where the UI was designed and is still reviewed.
  it("saves without an adapter at all", async () => {
    const shell = await renderShell();
    await shell.dispatch({ type: "open-file", fileId: SEED_ACTIVE_FILE_ID });

    await act(async () => {
      fireEvent.click(saveButton(shell.view.container));
    });

    expect(saveButton(shell.view.container).textContent).toContain("Saved");
  });
});

/**
 * The other half of the seam: what the user selected in the document.
 *
 * `onSelection` and `SendInput.reference` were both in the contract from the
 * start and nothing joined them, so asking the agent to "tighten this
 * paragraph" sent a message that never said which paragraph. These tests are
 * the wire, end to end: editor reports → composer quotes → message carries it.
 */
describe("canvas selection → composer reference", () => {
  const reference = (container: HTMLElement) =>
    container.querySelector<HTMLElement>(".shell-cx-reference");

  const selection: CanvasSelection = {
    fileId: SEED_ACTIVE_FILE_ID,
    label: "MO launch plan.docx · Heading",
    text: "A better everyday workspace",
  };

  it("quotes the selection in the composer", async () => {
    const { adapter, select } = fakeAdapter();
    const shell = await renderShell({ canvas: adapter });
    await shell.dispatch({ type: "open-file", fileId: SEED_ACTIVE_FILE_ID });

    expect(reference(shell.view.container)).toBeNull();

    await act(async () => {
      select(selection);
    });

    await waitFor(() => {
      expect(reference(shell.view.container)?.textContent).toContain("MO launch plan.docx · Heading");
    });
    expect(reference(shell.view.container)?.textContent).toContain("A better everyday workspace");
  });

  it("sends the quote with the message, then drops it", async () => {
    const { adapter, select } = fakeAdapter();
    const shell = await renderShell({ canvas: adapter, fastAgent: true });
    const send = vi.spyOn(shell.port.agent, "send");
    await shell.dispatch({ type: "open-file", fileId: SEED_ACTIVE_FILE_ID });
    await act(async () => {
      select(selection);
    });
    await waitFor(() => expect(reference(shell.view.container)).not.toBeNull());

    const input = shell.view.container.querySelector<HTMLTextAreaElement>(".shell-cx-input")!;
    await act(async () => {
      fireEvent.change(input, { target: { value: "Tighten this" } });
    });
    await act(async () => {
      fireEvent.submit(input.closest("form") ?? input);
      fireEvent.keyDown(input, { key: "Enter" });
    });

    await waitFor(() => {
      expect(send).toHaveBeenCalled();
    });
    expect(send.mock.calls[0]?.[0].reference).toEqual(selection);

    // The next message is not about the same passage unless the user says so.
    await waitFor(() => {
      expect(reference(shell.view.container)).toBeNull();
    });
  });

  /*
   * Editors report *that* the selection changed far more cheaply than *what*
   * it says — in Writer the text costs a round trip that also re-targets the
   * editor's one tracked edit scope. So the chip is a label until the message
   * is sent, and the words are fetched once, then.
   */
  it("fetches the quoted text when the message goes out, not before", async () => {
    const { adapter, select, resolveSelection } = fakeAdapter();
    const shell = await renderShell({ canvas: adapter, fastAgent: true });
    const send = vi.spyOn(shell.port.agent, "send");
    await shell.dispatch({ type: "open-file", fileId: SEED_ACTIVE_FILE_ID });

    await act(async () => {
      select({ ...selection, text: "" });
    });
    await waitFor(() => expect(reference(shell.view.container)).not.toBeNull());
    expect(resolveSelection).not.toHaveBeenCalled();

    const input = shell.view.container.querySelector<HTMLTextAreaElement>(".shell-cx-input")!;
    await act(async () => {
      fireEvent.change(input, { target: { value: "Tighten this" } });
    });
    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter" });
    });

    await waitFor(() => expect(send).toHaveBeenCalled());
    expect(resolveSelection).toHaveBeenCalledOnce();
    expect(send.mock.calls[0]?.[0].reference?.text).toBe("A better everyday workspace");
  });

  // A reference that could not be read must not take the message down with it.
  it("still sends when the editor cannot produce the text", async () => {
    const { adapter, select, resolveSelection } = fakeAdapter();
    resolveSelection.mockRejectedValueOnce(new Error("The selection is empty."));
    const shell = await renderShell({ canvas: adapter, fastAgent: true });
    const send = vi.spyOn(shell.port.agent, "send");
    await shell.dispatch({ type: "open-file", fileId: SEED_ACTIVE_FILE_ID });
    await act(async () => {
      select({ ...selection, text: "" });
    });
    await waitFor(() => expect(reference(shell.view.container)).not.toBeNull());

    const input = shell.view.container.querySelector<HTMLTextAreaElement>(".shell-cx-input")!;
    await act(async () => {
      fireEvent.change(input, { target: { value: "Tighten this" } });
    });
    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter" });
    });

    await waitFor(() => expect(send).toHaveBeenCalled());
    expect(send.mock.calls[0]?.[0].reference?.label).toBe(selection.label);
    expect(send.mock.calls[0]?.[0].reference?.text).toBe("");
  });

  // A selection that outlives the tab it came from would have the composer
  // quoting one document while the canvas shows another.
  it("ignores a selection from a file that is no longer open", async () => {
    const { adapter, select } = fakeAdapter();
    const shell = await renderShell({ canvas: adapter });
    await shell.dispatch({ type: "open-file", fileId: SEED_ACTIVE_FILE_ID });
    await act(async () => {
      select({ ...selection, fileId: "file-forecast" });
    });

    expect(reference(shell.view.container)).toBeNull();
  });
});

/**
 * Editing does not unfold the agent. The collapsed mark in the corner stays
 * there until the user clicks it: selecting a block, moving the caret, or
 * picking another shape are all just editing.
 */
describe("canvas selection → agent presence", () => {
  const block: CanvasSelection = {
    fileId: SEED_ACTIVE_FILE_ID,
    label: "MO launch plan.docx · Heading",
    text: "",
    block: true,
  };

  const face = (container: HTMLElement) => container.querySelector(".shell-presence-face");
  const panel = (container: HTMLElement) => container.querySelector(".shell-presence-panel");

  /** Editor mode with the presence collapsed — the state the mark is in. */
  async function collapsedInEditor() {
    const fake = fakeAdapter();
    const shell = await renderShell({ canvas: fake.adapter });
    await shell.dispatch({ type: "open-file", fileId: SEED_ACTIVE_FILE_ID });
    await shell.dispatch({ type: "set-mode", mode: "editor" });
    await waitFor(() => expect(face(shell.view.container)).not.toBeNull());
    expect(shell.state().presence.expanded).toBe(false);
    return { ...fake, shell };
  }

  it("stays collapsed when the user picks a block", async () => {
    const { shell, select } = await collapsedInEditor();

    await act(async () => {
      select(block);
    });

    expect(face(shell.view.container)).not.toBeNull();
    expect(panel(shell.view.container)).toBeNull();
    expect(shell.state().presence.expanded).toBe(false);
  });

  it("stays collapsed across further selections while the user edits", async () => {
    const { shell, select } = await collapsedInEditor();
    await act(async () => {
      select(block);
    });
    await act(async () => {
      select({ ...block, label: "MO launch plan.docx · Body" });
    });

    expect(face(shell.view.container)).not.toBeNull();
    expect(panel(shell.view.container)).toBeNull();
    expect(shell.state().presence.expanded).toBe(false);
  });
});

/**
 * The proposal, shown in the document rather than only in the panel.
 *
 * No editor implements `showDraft` yet, so these run against the fake adapter
 * and pin down the shell's half of the deal: when a draft exists, which file
 * it belongs to, and that Apply from inside the document goes through the same
 * port call as the button in the panel.
 */
describe("suggestion → in-document draft", () => {
  async function runToSuggestion() {
    const fake = fakeAdapter();
    const shell = await renderShell({ canvas: fake.adapter, fastAgent: true });
    await shell.dispatch({ type: "open-file", fileId: SEED_ACTIVE_FILE_ID });

    const input = shell.view.container.querySelector<HTMLTextAreaElement>(".shell-cx-input")!;
    await act(async () => {
      fireEvent.change(input, { target: { value: "Tighten the summary" } });
    });
    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter" });
    });
    await waitFor(() => {
      expect(fake.showDraft).toHaveBeenCalledWith(
        expect.objectContaining({ fileId: expect.any(String), text: expect.any(String) }),
      );
    });
    return { ...fake, shell };
  }

  it("hands the draft to the editor when one is ready", async () => {
    const { showDraft } = await runToSuggestion();
    const draft = showDraft.mock.calls.map(([value]) => value).filter(Boolean).at(-1);
    expect(draft?.suggestionId).toBeTruthy();
    expect(draft?.text.length).toBeGreaterThan(0);
  });

  it("applies through the port when the document asks", async () => {
    const { shell, applyFromDocument } = await runToSuggestion();
    const apply = vi.spyOn(shell.port.agent, "applySuggestion");

    await act(async () => {
      applyFromDocument();
    });

    await waitFor(() => {
      expect(apply).toHaveBeenCalledOnce();
    });
  });

  // An editor with no draft support is the normal case today.
  it("does not require the editor to support drafts", async () => {
    const fake = fakeAdapter();
    const plain: CanvasAdapter = { ...fake.adapter };
    delete plain.showDraft;
    delete plain.onDraftAction;
    const shell = await renderShell({ canvas: plain, fastAgent: true });
    await shell.dispatch({ type: "open-file", fileId: SEED_ACTIVE_FILE_ID });
    expect(shell.view.container.querySelector("#shell")).not.toBeNull();
  });
});
