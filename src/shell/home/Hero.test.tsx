import { act, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { toast } from "../../renderer/ui";
import { renderShell } from "../test/renderShell";
import { resetComposerDrafts } from "../composer/Composer";

afterEach(() => {
  cleanup();
  toast.destroy();
  resetComposerDrafts();
});

async function agentHome() {
  const shell = await renderShell({ fastAgent: true });
  await shell.dispatch({ type: "go-home" });
  return shell;
}

const send = async (shell: Awaited<ReturnType<typeof agentHome>>, text: string) => {
  await act(async () => {
    fireEvent.change(shell.view.getByLabelText("New task instructions"), { target: { value: text } });
  });
  await act(async () => {
    fireEvent.click(shell.view.getByTitle("Send message"));
  });
};

/**
 * Where Home goes once a task has been asked for.
 *
 * This is guarded because getting it wrong is invisible in the worst way. Home
 * used to fall back to "the first file of the scoped folder, in load order" —
 * a file with no relation to the request. Ask for a new deck in a folder of
 * forty documents and the shell opened document number one; the task panel's
 * artifact card names whatever is open, so the entire screen then agreed that
 * an unrelated file was the thing the agent had just made.
 */
describe("Home after sending", () => {
  it("opens no file when the task is making something new", async () => {
    const shell = await agentHome();
    await send(shell, "Build a launch deck for the new workspace line.");

    await waitFor(() => {
      expect(shell.state().home).toBe(false);
    });
    // The run fills a canvas; ShellContext opens the real artifact by
    // `artifactTaskId` when it completes. Until then there is nothing honest
    // to show, and showing a stand-in is what caused the confusion.
    expect(shell.state().activeFileId).toBeNull();
  });

  it("stays with the open document when the task is about it", async () => {
    const shell = await renderShell({ fastAgent: true });
    const [file] = await shell.port.files.list();
    await shell.dispatch({ type: "open-file", fileId: file.id });
    await shell.dispatch({ type: "go-home" });

    await send(shell, "Tighten the wording on slide two.");

    await waitFor(() => {
      expect(shell.state().home).toBe(false);
    });
    expect(shell.state().activeFileId).toBe(file.id);
  });
});
