import { act, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { toast } from "../../renderer/ui";
import { resetComposerDrafts } from "../composer/Composer";
import { createTestCanvasAdapter } from "../editor/testCanvasAdapter";
import { resetLayers } from "../kit/layers";
import { SEED_ACTIVE_FILE_ID } from "../port/fake/seed";
import { renderShell } from "../test/renderShell";

afterEach(() => {
  resetComposerDrafts();
  resetLayers();
  toast.destroy();
  cleanup();
});

/**
 * "Saved" is an assertion, not the absence of a dirty flag.
 *
 * Before this, the status button read the dirty flag and nothing else: a write
 * the disk refused left the editor holding changes, the file marked clean by
 * nobody, and the button saying Saved — while the only trace of the refusal
 * was a toast gone in three seconds. These pin the third state: a failed save
 * or open is written against the file, shown as Failed with a Retry, kept
 * dirty, and cleared only by a retry that goes through.
 */
const saveButton = (container: HTMLElement) => container.querySelector<HTMLButtonElement>(".dx-source-saved")!;
const retryButton = (container: HTMLElement) =>
  container.querySelector<HTMLButtonElement>("[data-act=retry-save], [data-act=reopen]");
const tab = (container: HTMLElement) => container.querySelector<HTMLElement>(`.dx-file-tab[data-tab="${SEED_ACTIVE_FILE_ID}"]`)!;
const dirtyMark = (container: HTMLElement) => tab(container).querySelector(".dx-dirty-mark");
const failureToast = () => document.body.querySelector(".od-toast-slot");

async function openEditor() {
  const canvas = createTestCanvasAdapter();
  const shell = await renderShell({ canvas: canvas.adapter });
  await shell.dispatch({ type: "open-file", fileId: SEED_ACTIVE_FILE_ID });
  await waitFor(() => expect(saveButton(shell.view.container).textContent).toContain("Saved"));
  return { canvas, shell, container: shell.view.container };
}

describe("file status", () => {
  it("shows a refused save as Failed with a Retry, keeps the dot, and never says Saved", async () => {
    const { canvas, shell, container } = await openEditor();
    await act(async () => {
      canvas.report(true);
    });
    await waitFor(() => expect(saveButton(container).textContent).toContain("Unsaved"));

    canvas.save.mockRejectedValueOnce(new Error("save docx: write: open /Users/qa/readonly.docx: permission denied"));
    await act(async () => {
      fireEvent.click(saveButton(container));
    });

    await waitFor(() => expect(saveButton(container).textContent).toContain("Failed"));
    expect(saveButton(container).textContent).not.toContain("Saved");
    expect(retryButton(container)?.dataset.act).toBe("retry-save");
    expect(dirtyMark(container)).not.toBeNull();
    expect(tab(container).dataset.failed).toBe("save");
    // Written against the file, not just drawn: the port carries it.
    const file = (await shell.port.files.list()).find((entry) => entry.id === SEED_ACTIVE_FILE_ID)!;
    expect(file.dirty).toBe(true);
    expect(file.failure).toMatchObject({ kind: "save", reason: "permission-denied" });
    // Said in words, with the host's text behind Details rather than in the headline.
    await waitFor(() => expect(failureToast()).not.toBeNull());
    expect(failureToast()?.textContent).toContain("not allowed to write this file");
    expect(failureToast()?.querySelector(".dx-failure-details pre")?.textContent).toContain("permission denied");

    // The disk relents; Retry is the same save, and only now does it read Saved.
    await act(async () => {
      fireEvent.click(retryButton(container)!);
    });
    await waitFor(() => expect(saveButton(container).textContent).toContain("Saved"));
    expect(retryButton(container)).toBeNull();
    expect(dirtyMark(container)).toBeNull();
    expect(tab(container).dataset.failed).toBeUndefined();
    expect((await shell.port.files.list()).find((entry) => entry.id === SEED_ACTIVE_FILE_ID)?.failure).toBeUndefined();
    await waitFor(() => expect(failureToast()).toBeNull());
  });

  it("records a save the editor ran by itself and failed", async () => {
    const { canvas, shell, container } = await openEditor();
    await act(async () => {
      canvas.report(true);
    });
    await act(async () => {
      canvas.failFile(SEED_ACTIVE_FILE_ID, {
        kind: "save",
        reason: "source-changed",
        detail: "save docx: source file changed outside OfficeDex; reopen it before saving",
        at: 1,
      });
    });

    await waitFor(() => expect(saveButton(container).textContent).toContain("Failed"));
    expect(retryButton(container)?.dataset.act).toBe("retry-save");
    expect(dirtyMark(container)).not.toBeNull();
    expect((await shell.port.files.list()).find((entry) => entry.id === SEED_ACTIVE_FILE_ID)?.failure).toMatchObject({
      reason: "source-changed",
    });

    // The editor's next autosave got through.
    await act(async () => {
      canvas.failFile(SEED_ACTIVE_FILE_ID, null);
      canvas.report(false);
    });
    await waitFor(() => expect(saveButton(container).textContent).toContain("Saved"));
    expect(retryButton(container)).toBeNull();
  });

  it("shows a document the editor could not open as Failed, with a way to try again, and not as Saved", async () => {
    const { canvas, shell, container } = await openEditor();
    await act(async () => {
      canvas.failFile(SEED_ACTIVE_FILE_ID, {
        kind: "open",
        reason: "invalid-docx",
        detail: 'DOCX import failed with HTTP 400: {"error":"DOCX_CONVERSION_FAILED","detail":"/var/folders/x/input.docx"}',
        at: 1,
      });
    });

    await waitFor(() => expect(saveButton(container).textContent).toContain("Failed"));
    expect(saveButton(container).textContent).not.toContain("Saved");
    expect(saveButton(container).title).toContain("damaged or is not a valid Word document");
    expect(retryButton(container)?.dataset.act).toBe("reopen");
    // The status line carries our sentence; the converter's text stays in Details.
    expect(container.querySelector(".dx-tabs-strip")?.textContent).not.toContain("/var/folders");
    expect(container.querySelector(".dx-tabs-strip")?.textContent).not.toContain("HTTP 400");
    expect(failureToast()?.textContent).toContain("damaged or is not a valid Word document");
    expect(failureToast()?.querySelector("pre")?.textContent).toContain("HTTP 400");

    // Reopen asks the adapter for a fresh editor. The failure stays until that
    // editor says the document loaded: a retry is not a success.
    await act(async () => {
      fireEvent.click(retryButton(container)!);
    });
    expect(canvas.reopen).toHaveBeenCalledWith(expect.objectContaining({ id: SEED_ACTIVE_FILE_ID }));
    expect(saveButton(container).textContent).toContain("Failed");
    await waitFor(() => expect(failureToast()).toBeNull());

    await act(async () => {
      canvas.failFile(SEED_ACTIVE_FILE_ID, null);
    });
    await waitFor(() => expect(saveButton(container).textContent).toContain("Saved"));
    expect(retryButton(container)).toBeNull();
    expect((await shell.port.files.list()).find((entry) => entry.id === SEED_ACTIVE_FILE_ID)?.failure).toBeUndefined();
  });

  it("lists the failure on Home and in Details, in the same words", async () => {
    const { canvas, shell, container } = await openEditor();
    await act(async () => {
      canvas.failFile(SEED_ACTIVE_FILE_ID, { kind: "save", reason: "unknown", detail: "boom", at: 1 });
    });
    await waitFor(() => expect(saveButton(container).textContent).toContain("Failed"));

    await shell.dispatch({ type: "go", page: "home" });
    await waitFor(() => {
      const row = container.querySelector(`.dx-home-recent tr[data-row="${SEED_ACTIVE_FILE_ID}"]`);
      expect(row?.querySelector("[data-status]")?.textContent).toBe("Save failed");
    });
  });
});
