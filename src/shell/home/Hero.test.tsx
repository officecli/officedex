import { act, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { toast } from "../../renderer/ui";
import type { SendInput } from "../../shared/uiPort";
import { renderShell } from "../test/renderShell";
import { resetComposerDrafts } from "../composer/Composer";

afterEach(() => {
  cleanup();
  toast.destroy();
  resetComposerDrafts();
});

/** Records what the shell actually handed the port, which is the thing at issue. */
function captureSends(port: Awaited<ReturnType<typeof renderShell>>["port"]) {
  const sent: SendInput[] = [];
  const original = port.agent.send.bind(port.agent);
  port.agent.send = async (input) => {
    sent.push(input);
    return original(input);
  };
  return sent;
}

const send = async (shell: Awaited<ReturnType<typeof renderShell>>, text: string) => {
  await act(async () => {
    fireEvent.change(shell.view.getByLabelText("New task instructions"), { target: { value: text } });
  });
  await act(async () => {
    fireEvent.click(shell.view.getByTitle("Send message"));
  });
};

/**
 * What a task asked for from Home is, and is not, about.
 *
 * This is guarded because getting it wrong rewrote a user's file. The service
 * layer treats `SendInput.activeFileId` as the entire routing decision — with
 * one it runs `office.modify` against that document instead of generating
 * anything — and Home used to pass whichever tab was open behind it. Opening a
 * deck from disk, returning to Home and asking for a *new* presentation edited
 * the deck in place, seven operations deep, with the artifact card then naming
 * that same file as though the agent had produced it.
 */
describe("a task started from Home", () => {
  it("is not aimed at whatever document happens to be open", async () => {
    const shell = await renderShell({ fastAgent: true });
    const [file] = await shell.port.files.list();
    await shell.dispatch({ type: "open-file", fileId: file.id });
    await shell.dispatch({ type: "go-home" });
    // The tab is still open behind Home — that is the whole trap.
    expect(shell.state().activeFileId).toBe(file.id);

    const sent = captureSends(shell.port);
    await send(shell, "Build a launch deck for the new workspace line.");

    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0].activeFileId).toBeNull();
  });

  it("leaves Home for the canvas the run fills, opening nothing on the way", async () => {
    const shell = await renderShell({ fastAgent: true });
    await shell.dispatch({ type: "go-home" });
    await send(shell, "Draft a plan for the launch.");

    await waitFor(() => {
      expect(shell.state().home).toBe(false);
    });
    // `ShellContext` opens the real artifact by `artifactTaskId` when the run
    // finishes. Anything shown before that is a stand-in the user did not ask
    // for, and a stand-in is what made the agent look like it had written to
    // the wrong document.
    expect(shell.state().activeFileId).toBeNull();
  });

  // The docked composer is about the document it sits beside; that is what
  // makes "rewrite this paragraph" mean anything there.
  it("still aims at the open document when sent from the task column", async () => {
    const shell = await renderShell({ fastAgent: true });
    const [file] = await shell.port.files.list();
    await shell.dispatch({ type: "open-file", fileId: file.id });

    const sent = captureSends(shell.port);
    await act(async () => {
      fireEvent.change(shell.view.getByLabelText("Message Agent"), {
        target: { value: "Tighten the wording on slide two." },
      });
    });
    await act(async () => {
      fireEvent.click(shell.view.getByTitle("Send message"));
    });

    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0].activeFileId).toBe(file.id);
  });
});
