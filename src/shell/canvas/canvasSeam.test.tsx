import { act, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { resetComposerDrafts } from "../composer/Composer";
import { resetLayers } from "../kit/layers";
import { SEED_ACTIVE_FILE_ID, SEED_FOLDER_ID } from "../port/fake/seed";
import { renderShell } from "../test/renderShell";
import { createTestCanvasAdapter } from "../editor/testCanvasAdapter";
import type { CanvasAdapter, CanvasSelection } from "../editor/canvasContract";

afterEach(() => {
  // Drafts are module state, so a message typed here would still be in the next
  // test's composer.
  resetComposerDrafts();
  resetLayers();
  cleanup();
});

/**
 * The seam between the embedded editor and the shell around it.
 *
 * Two things cross it, and neither could before: the editor tells the shell the
 * document is dirty, and the shell tells the editor to write it out. Both were
 * missing in a way that only shows up once a real editor is mounted — the save
 * button called `files.save`, which clears the flag and writes nothing, so
 * pressing it would have marked unsaved work as saved.
 */
const saveButton = (container: HTMLElement) =>
  container.querySelector<HTMLButtonElement>(".dx-source-saved")!;

const dirtyMark = (container: HTMLElement) =>
  container.querySelector<HTMLElement>(`.dx-file-tab[data-tab="${SEED_ACTIVE_FILE_ID}"] .dx-dirty-mark`);

describe("canvas ⇄ shell", () => {
  it("shows the editor's unsaved state on the tab and in the tab row", async () => {
    const { adapter, report } = createTestCanvasAdapter();
    const shell = await renderShell({ canvas: adapter });
    await shell.dispatch({ type: "open-file", fileId: SEED_ACTIVE_FILE_ID });

    expect(saveButton(shell.view.container).textContent).toContain("Saved");
    expect(dirtyMark(shell.view.container)).toBeNull();

    await act(async () => {
      report(true);
    });

    await waitFor(() => {
      expect(saveButton(shell.view.container).textContent).toContain("Unsaved");
    });
    // The dot on the tab is the same fact, and the only one visible once the
    // document is not the tab being looked at.
    expect(dirtyMark(shell.view.container)).not.toBeNull();
  });

  // The order matters and is the whole point: bytes first, flag second.
  it("writes through the editor before clearing the flag", async () => {
    const { adapter, save, report } = createTestCanvasAdapter();
    const shell = await renderShell({ canvas: adapter });
    const clearFlag = vi.spyOn(shell.port.files, "save");
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
    expect(save.mock.invocationCallOrder[0]).toBeLessThan(clearFlag.mock.invocationCallOrder[0]);
    await waitFor(() => {
      expect(saveButton(shell.view.container).textContent).toContain("Saved");
    });
  });

  // ⌘S belongs to the document, and takes the same route as the button (§13).
  it("saves through the editor when ⌘S is pressed", async () => {
    const { adapter, save, report } = createTestCanvasAdapter();
    const shell = await renderShell({ canvas: adapter });
    const clearFlag = vi.spyOn(shell.port.files, "save");
    await shell.dispatch({ type: "open-file", fileId: SEED_ACTIVE_FILE_ID });
    await act(async () => {
      report(true);
    });
    await waitFor(() => {
      expect(saveButton(shell.view.container).textContent).toContain("Unsaved");
    });

    await act(async () => {
      fireEvent.keyDown(window, { key: "s", metaKey: true });
    });

    await waitFor(() => {
      expect(save).toHaveBeenCalledOnce();
    });
    expect(save.mock.invocationCallOrder[0]).toBeLessThan(clearFlag.mock.invocationCallOrder[0]);
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
 *
 * Over a Local document the composer is the Dex panel's, and the quote is drawn
 * above it; beside a conversation the quote goes to that composer instead and
 * Dex stays shut (§17, §19).
 */
describe("canvas selection → composer reference", () => {
  const dexQuote = (container: HTMLElement) => container.querySelector<HTMLElement>(".dx-dex-reference");
  const chatQuote = (container: HTMLElement) => container.querySelector<HTMLElement>(".dx-chat-reference");
  const dexPanel = (container: HTMLElement) => container.querySelector<HTMLElement>(".dx-dex-panel")!;
  const dexInput = (container: HTMLElement) =>
    container.querySelector<HTMLTextAreaElement>("[data-draft=dex]")!;

  const selection: CanvasSelection = {
    fileId: SEED_ACTIVE_FILE_ID,
    label: "MO launch plan.docx · Heading",
    text: "A better everyday workspace",
  };

  it("quotes the selection over the document", async () => {
    const { adapter, select } = createTestCanvasAdapter();
    const shell = await renderShell({ canvas: adapter });
    await shell.dispatch({ type: "open-file", fileId: SEED_ACTIVE_FILE_ID });

    expect(dexQuote(shell.view.container)).toBeNull();
    expect(dexPanel(shell.view.container).hidden).toBe(true);

    await act(async () => {
      select(selection);
    });

    await waitFor(() => {
      expect(dexQuote(shell.view.container)?.textContent).toContain("MO launch plan.docx · Heading");
    });
    expect(dexQuote(shell.view.container)?.textContent).toContain("A better everyday workspace");
    // Selecting something in a Local document is a question about it, so the
    // panel that can be asked opens itself.
    expect(dexPanel(shell.view.container).hidden).toBe(false);
  });

  it("sends the quote with the message, then drops it", async () => {
    const { adapter, select } = createTestCanvasAdapter();
    const shell = await renderShell({ canvas: adapter, fastAgent: true });
    const send = vi.spyOn(shell.port.agent, "send");
    await shell.dispatch({ type: "open-file", fileId: SEED_ACTIVE_FILE_ID });
    await act(async () => {
      select(selection);
    });
    await waitFor(() => expect(dexQuote(shell.view.container)).not.toBeNull());

    const input = dexInput(shell.view.container);
    await act(async () => {
      fireEvent.change(input, { target: { value: "Tighten this" } });
    });
    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter" });
    });

    await waitFor(() => {
      expect(send).toHaveBeenCalled();
    });
    expect(send.mock.calls[0]?.[0].reference).toEqual(selection);

    // The next message is not about the same passage unless the user says so.
    await waitFor(() => {
      expect(dexQuote(shell.view.container)).toBeNull();
    });
  });

  /*
   * Editors report *that* the selection changed far more cheaply than *what*
   * it says — in Writer the text costs a round trip that also re-targets the
   * editor's one tracked edit scope. So the chip is a label until the message
   * is sent, and the words are fetched once, then.
   */
  it("fetches the quoted text when the message goes out, not before", async () => {
    const { adapter, select, resolveSelection } = createTestCanvasAdapter();
    const shell = await renderShell({ canvas: adapter, fastAgent: true });
    const send = vi.spyOn(shell.port.agent, "send");
    await shell.dispatch({ type: "open-file", fileId: SEED_ACTIVE_FILE_ID });

    await act(async () => {
      select({ ...selection, text: "" });
    });
    await waitFor(() => expect(dexQuote(shell.view.container)).not.toBeNull());
    expect(resolveSelection).not.toHaveBeenCalled();

    const input = dexInput(shell.view.container);
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
    const { adapter, select, resolveSelection } = createTestCanvasAdapter();
    resolveSelection.mockRejectedValueOnce(new Error("The selection is empty."));
    const shell = await renderShell({ canvas: adapter, fastAgent: true });
    const send = vi.spyOn(shell.port.agent, "send");
    await shell.dispatch({ type: "open-file", fileId: SEED_ACTIVE_FILE_ID });
    await act(async () => {
      select({ ...selection, text: "" });
    });
    await waitFor(() => expect(dexQuote(shell.view.container)).not.toBeNull());

    const input = dexInput(shell.view.container);
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
    const { adapter, select } = createTestCanvasAdapter();
    const shell = await renderShell({ canvas: adapter });
    await shell.dispatch({ type: "open-file", fileId: SEED_ACTIVE_FILE_ID });
    await act(async () => {
      select({ ...selection, fileId: "file-forecast" });
    });

    expect(dexQuote(shell.view.container)).toBeNull();
    expect(dexPanel(shell.view.container).hidden).toBe(true);
  });

  // Beside a conversation the message is being written there, so that is where
  // the quote belongs — and Dex does not unfold over the document for it (§19).
  it("quotes into the conversation's composer when one is open beside the document", async () => {
    const { adapter, select } = createTestCanvasAdapter();
    const shell = await renderShell({ canvas: adapter });
    await shell.dispatch({
      type: "open-chat",
      chat: { folderId: SEED_FOLDER_ID, conversationId: null },
    });
    await shell.dispatch({ type: "open-file", fileId: SEED_ACTIVE_FILE_ID });

    await act(async () => {
      select(selection);
    });

    await waitFor(() => {
      expect(chatQuote(shell.view.container)?.textContent).toContain("MO launch plan.docx · Heading");
    });
    expect(chatQuote(shell.view.container)?.textContent).toContain("A better everyday workspace");
    // Dex neither unfolds nor wears its selected face for a selection that
    // belongs to the conversation.
    expect(shell.state().dexOpen).toBe(false);
    expect(dexPanel(shell.view.container).hidden).toBe(true);
    expect(
      shell.view.container.querySelector<HTMLElement>("button.dx-dex[data-act=dex]")?.dataset.state,
    ).not.toBe("selected");
  });
});

/**
 * An instruction aimed at the document already open.
 *
 * It goes to the mounted editor as exact replacements rather than to the
 * generation runtime, which would re-author the whole file from the prompt and
 * overwrite the copy the user has been typing into. Which path a message takes
 * is decided by `canEditDocument()`, so it follows what is on screen.
 */
describe("in-place document edit", () => {
  const dexInput = (container: HTMLElement) =>
    container.querySelector<HTMLTextAreaElement>("[data-draft=dex]")!;

  async function askTheDocument(canvas: ReturnType<typeof createTestCanvasAdapter>, text: string) {
    const shell = await renderShell({ canvas: canvas.adapter, fastAgent: true });
    const send = vi.spyOn(shell.port.agent, "send");
    await shell.dispatch({ type: "open-file", fileId: SEED_ACTIVE_FILE_ID });
    return { shell, send, type: async () => {
      const input = dexInput(shell.view.container);
      await act(async () => {
        fireEvent.change(input, { target: { value: text } });
      });
      await act(async () => {
        fireEvent.keyDown(input, { key: "Enter" });
      });
    } };
  }

  it("goes through the canvas adapter and not the runtime", async () => {
    const canvas = createTestCanvasAdapter({ inPlace: {} });
    const { send, type } = await askTheDocument(canvas, "Tighten the summary");

    await type();

    await waitFor(() => expect(canvas.editDocument).toHaveBeenCalledOnce());
    expect(send).not.toHaveBeenCalled();
    const request = canvas.editDocument.mock.calls[0]?.[0];
    expect(request.instruction).toBe("Tighten the summary");
    // Nothing was selected, so the scope is the whole document.
    expect(request.preferSelection).toBe(false);
  });

  it("narrows the edit to the quoted passage", async () => {
    const canvas = createTestCanvasAdapter({ inPlace: { scope: "selection" } });
    const { type } = await askTheDocument(canvas, "Tighten this");
    await act(async () => {
      canvas.select({
        fileId: SEED_ACTIVE_FILE_ID,
        label: "MO launch plan.docx · Heading",
        text: "",
      });
    });

    await type();

    await waitFor(() => expect(canvas.editDocument).toHaveBeenCalledOnce());
    const request = canvas.editDocument.mock.calls[0]?.[0];
    expect(request.preferSelection).toBe(true);
    // The words the editor is to look for, read at send time by the same call
    // the runtime path uses.
    expect(request.selection).toEqual({
      label: "MO launch plan.docx · Heading",
      text: "A better everyday workspace",
    });
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
    const canvas = createTestCanvasAdapter();
    const shell = await renderShell({ canvas: canvas.adapter, fastAgent: true });
    await shell.dispatch({ type: "open-file", fileId: SEED_ACTIVE_FILE_ID });

    const input = shell.view.container.querySelector<HTMLTextAreaElement>("[data-draft=dex]")!;
    await act(async () => {
      fireEvent.change(input, { target: { value: "Tighten the summary" } });
    });
    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter" });
    });
    await waitFor(() => {
      expect(canvas.showDraft).toHaveBeenCalledWith(
        expect.objectContaining({ fileId: expect.any(String), text: expect.any(String) }),
      );
    });
    return { ...canvas, shell };
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
    const canvas = createTestCanvasAdapter();
    const plain: CanvasAdapter = { ...canvas.adapter };
    delete plain.showDraft;
    delete plain.onDraftAction;
    const shell = await renderShell({ canvas: plain, fastAgent: true });
    await shell.dispatch({ type: "open-file", fileId: SEED_ACTIVE_FILE_ID });
    expect(shell.view.container.querySelector("#shell")).not.toBeNull();
  });
});
