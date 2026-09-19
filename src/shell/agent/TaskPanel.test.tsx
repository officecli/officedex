import { cleanup, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { toast } from "../../renderer/ui";
import type { AgentTask, FileMeta } from "../../shared/uiPort";
import { SEED_FOLDER_ID, seedFiles } from "../port/fake/seed";
import { renderShell } from "../test/renderShell";

afterEach(() => {
  cleanup();
  toast.destroy();
});

const TASK_ID = "task-under-test";

function runningTask(): AgentTask {
  return {
    id: TASK_ID,
    title: "Prepare a launch presentation",
    folderId: SEED_FOLDER_ID,
    status: "working",
    phase: "Writing content",
    steps: [],
    messages: [],
    suggestion: null,
    question: null,
  };
}

/** A file the library says this run produced. */
function producedFile(now = Date.now()): FileMeta {
  return {
    id: "file-produced",
    name: "MO launch deck.pptx",
    type: "slides",
    folderId: SEED_FOLDER_ID,
    createdAt: now,
    updatedAt: now,
    lastOpenedAt: null,
    dirty: false,
    pinned: false,
    artifactTaskId: TASK_ID,
  };
}

const card = () => document.querySelector(".shell-task-artifact");
const cardText = () => card()?.textContent ?? "";

/**
 * The file named in the task panel.
 *
 * This card used to render whatever document was open in the editor. Ask for a
 * brand new deck with an unrelated file on screen — which is the normal state,
 * since you have to be somewhere while you type — and the panel put that file's
 * name under the task's own title, next to "Open in Editor". Every reading of
 * that card was wrong: the run had not touched that file and was not going to.
 */
describe("the task panel's file card", () => {
  it("names the file this run produced", async () => {
    const shell = await renderShell({
      fastAgent: true,
      tasks: [runningTask()],
      files: [...seedFiles(), producedFile()],
    });
    await shell.dispatch({ type: "open-file", fileId: "file-produced" });

    await waitFor(() => expect(card()).not.toBeNull());
    expect(cardText()).toContain("MO launch deck.pptx");
  });

  /** The case the card got wrong, and the reason it was rebuilt. */
  it("shows nothing while the run has produced no file, whatever is open", async () => {
    const shell = await renderShell({
      fastAgent: true,
      tasks: [runningTask()],
    });
    const [open] = await shell.port.files.list();
    await shell.dispatch({ type: "open-file", fileId: open.id });

    // The document is open — the tab bar and status bar both say so — and the
    // task panel still must not imply the agent made it.
    await waitFor(() => expect(shell.state().activeFileId).toBe(open.id));
    expect(card()).toBeNull();
  });

  it("keeps naming the artifact when a different document is open", async () => {
    const shell = await renderShell({
      fastAgent: true,
      tasks: [runningTask()],
      files: [...seedFiles(), producedFile()],
    });
    const unrelated = (await shell.port.files.list()).find((file) => file.id !== "file-produced");
    await shell.dispatch({ type: "open-file", fileId: unrelated!.id });

    await waitFor(() => expect(card()).not.toBeNull());
    expect(cardText()).toContain("MO launch deck.pptx");
    expect(cardText()).not.toContain(unrelated!.name);
  });
});

/**
 * The deck's pages belong beside the conversation.
 *
 * They used to live on the canvas — outline, per-page status and the request
 * echoed back — which left the deck being written with nowhere to be. Titles
 * and marks only: the runtime writes a sentence of intent per page, and eight
 * of those in a 320px column stop being a list.
 */
describe("the task panel's page list", () => {
  const withOutline = (): AgentTask => ({
    ...runningTask(),
    outline: [
      { slide: 1, title: "Product Launch", state: "ready" },
      { slide: 2, title: "How We Position", state: "generating" },
      { slide: 3, title: "Launch Timeline", state: null },
    ],
  });

  it("lists every page with its own mark", async () => {
    const shell = await renderShell({ fastAgent: true, tasks: [withOutline()] });
    // The seeded run lives in `folder-launch`; the default scope is
    // `folder-inbox`, so without this the panel is asking about a folder that
    // has no task and renders its empty state.
    await shell.dispatch({ type: "select-folder", folderId: SEED_FOLDER_ID });
    await shell.dispatch({ type: "enter-workspace" });

    await waitFor(() => expect(document.querySelectorAll(".shell-task-outline-row")).toHaveLength(3));
    const rows = [...document.querySelectorAll(".shell-task-outline-row")];
    expect(rows.map((row) => row.getAttribute("data-state"))).toEqual([
      "ready",
      "generating",
      "planned",
    ]);
    expect(rows[0].textContent).toContain("Product Launch");
  });

  /*
   * A run with no page-level plan must not draw an empty frame where the list
   * would be. Both shapes count: `toOutline` returns `[]` for a run the runtime
   * gave no outline, and a task recorded before the field existed has none at
   * all. They mean the same thing to a reader, so they have to look the same.
   */
  it.each([
    ["an empty list", [] as AgentTask["outline"]],
    ["no list at all", undefined],
  ])("renders nothing for a run with %s", async (_label, outline) => {
    const shell = await renderShell({
      fastAgent: true,
      tasks: [{ ...runningTask(), outline }],
    });
    await shell.dispatch({ type: "select-folder", folderId: SEED_FOLDER_ID });
    await shell.dispatch({ type: "enter-workspace" });

    await waitFor(() => expect(document.querySelector(".shell-task")).not.toBeNull());
    expect(document.querySelector(".shell-task-outline")).toBeNull();
  });
});
