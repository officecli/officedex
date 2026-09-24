import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { toast } from "../../renderer/ui";
import { renderShell } from "../test/renderShell";

afterEach(() => {
  cleanup();
  toast.destroy();
});

/**
 * Editor Home opens files dragged in from the desktop.
 *
 * The native half — Wails resolving real paths — cannot run in jsdom, so the
 * port's drop subscription is captured and fired by hand. Everything from the
 * paths onward is the production path.
 */
async function editorHomeWithDrop() {
  const harness = await renderShell();
  let emit: ((paths: string[]) => void) | null = null;
  harness.port.files.onDropFromDisk = (callback) => {
    emit = callback;
    return () => {
      emit = null;
    };
  };
  await harness.dispatch({ type: "set-mode", mode: "editor" });
  await waitFor(() => expect(emit).not.toBeNull());
  const drop = async (paths: string[]) => {
    await act(async () => {
      emit!(paths);
    });
  };
  return { ...harness, drop };
}

describe("Editor Home · drop files from the desktop", () => {
  it("opens each dropped document in a tab, the last one in front", async () => {
    const { drop, state, port } = await editorHomeWithDrop();

    await drop(["/Users/me/Plan.docx", "/Users/me/Budget.xlsx"]);

    await waitFor(() => expect(state().home).toBe(false));
    const files = await port.files.list();
    const plan = files.find((file) => file.name === "Plan.docx")!;
    const budget = files.find((file) => file.name === "Budget.xlsx")!;
    expect(state().openFileIds).toEqual(expect.arrayContaining([plan.id, budget.id]));
    expect(state().activeFileId).toBe(budget.id);
  });

  it("opens what it can and names what it cannot", async () => {
    const { drop, state, port } = await editorHomeWithDrop();

    await drop(["/Users/me/notes.txt", "/Users/me/Deck.pptx"]);

    const deck = (await port.files.list()).find((file) => file.name === "Deck.pptx")!;
    await waitFor(() => expect(state().activeFileId).toBe(deck.id));
    expect(await screen.findByText("notes.txt")).toBeTruthy();
  });

  it("shows the overlay only while desktop files are over the page", async () => {
    const { view } = await editorHomeWithDrop();
    const zone = view.container.querySelector<HTMLElement>("[data-testid='shell-home-dropzone']")!;
    const files = { types: ["Files"], dropEffect: "none" };

    fireEvent.dragEnter(zone, { dataTransfer: files });
    expect(view.container.querySelector("[data-testid='shell-home-drop']")).not.toBeNull();

    fireEvent.dragLeave(zone, { dataTransfer: files });
    expect(view.container.querySelector("[data-testid='shell-home-drop']")).toBeNull();

    // A row dragged onto a folder is not a file from disk.
    fireEvent.dragEnter(zone, { dataTransfer: { types: ["application/x-officedex-file"] } });
    expect(view.container.querySelector("[data-testid='shell-home-drop']")).toBeNull();
  });
});
