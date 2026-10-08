import { act, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { toast } from "../../renderer/ui";
import type { AgentTask, FileMeta, SendInput } from "../../shared/uiPort";
import { resetLayers } from "../kit/layers";
import { SEED_FOLDER_ID, seedFiles } from "../port/fake/seed";
import { resetComposerDrafts } from "./Composer";
import { renderShell } from "../test/renderShell";

/**
 * The conversation's task is the project's latest run, not the open file's.
 *
 * A project whose last run made a picture kept its composer in image mode for
 * every file opened after it — so "what is this deck about", typed beside an
 * open deck, went to the image model as a brief and the canvas turned into
 * "Creating your image". The document on screen decides instead, and r10 says
 * out loud which of the two a message is about.
 */

afterEach(() => {
  cleanup();
  resetLayers();
  resetComposerDrafts();
  toast.destroy();
});

function imageTask(): AgentTask {
  return {
    id: "r1",
    title: "A warm desk lamp",
    folderId: SEED_FOLDER_ID,
    documentType: "img",
    status: "done",
    phase: "Image ready",
    steps: [],
    messages: [{ id: "m1", role: "user", text: "A warm desk lamp", createdAt: 0 }],
    suggestion: null,
    question: null,
    image: { runs: [{ taskId: "r1", status: "done", prompt: "A warm desk lamp" }] },
  };
}

const picture: FileMeta = {
  id: "f1",
  name: "f1.png",
  type: "image",
  folderId: SEED_FOLDER_ID,
  createdAt: 0,
  updatedAt: 0,
  lastOpenedAt: null,
  dirty: false,
  pinned: false,
  artifactTaskId: "r1",
};

/*
 * Queries are scoped to the conversation column on purpose: with a document
 * open, the Dex panel's composer is in the tree too (hidden, not unmounted), so
 * an unscoped "Send message" finds two.
 */
const column = (shell: Awaited<ReturnType<typeof renderShell>>) =>
  within(shell.view.container.querySelector<HTMLElement>("#dx-conversation")!);

/** The composer in the conversation column, whichever interface it is wearing. */
const chatComposer = () => document.querySelector("#dx-conversation .dx-composer, #dx-conversation .shell-cx");
const chatIsImageMode = () => Boolean(document.querySelector("#dx-conversation .shell-cx.is-image"));

async function besideImageTask() {
  const shell = await renderShell({ fastAgent: true, tasks: [imageTask()], files: [...seedFiles(), picture] });
  const sent: SendInput[] = [];
  const send = shell.port.agent.send.bind(shell.port.agent);
  shell.port.agent.send = async (input) => {
    sent.push(input);
    await send(input);
  };
  await shell.dispatch({ type: "open-chat", chat: { folderId: SEED_FOLDER_ID, conversationId: null } });
  return { shell, sent };
}

async function sendFromChat(shell: Awaited<ReturnType<typeof renderShell>>, text: string) {
  await act(async () => {
    fireEvent.change(column(shell).getByLabelText("Message OfficeDex"), { target: { value: text } });
  });
  await act(async () => {
    fireEvent.click(column(shell).getByTitle("Send message"));
  });
}

describe("the conversation composer beside an image task", () => {
  it("talks about the open deck, not the project's last picture", async () => {
    const { shell, sent } = await besideImageTask();
    await shell.dispatch({ type: "open-file", fileId: "file-deck" });
    await waitFor(() => expect(chatComposer()).not.toBeNull());

    expect(chatIsImageMode()).toBe(false);
    await sendFromChat(shell, "这个ppt在讲什么，总结一下");

    expect(sent).toHaveLength(1);
    expect(sent[0].activeFileId).toBe("file-deck");
    expect(sent[0].documentType).not.toBe("img");
    expect(sent[0].imageGeneration).toBeUndefined();
  });

  /*
   * Deciding correctly is half of it. Which of the two a message is about is
   * exactly what the user cannot see from a panel showing a picture's
   * conversation, so the composer says it, with the picture one click away.
   */
  it("says that the message changes the document, and offers the picture instead", async () => {
    const { shell } = await besideImageTask();
    await shell.dispatch({ type: "open-file", fileId: "file-deck" });

    await waitFor(() => {
      expect(column(shell).getByText("This message changes MO launch deck.pptx")).toBeInTheDocument();
    });
    const switchToPicture = column(shell).getByRole("button", { name: /Edit the picture \(Version 1\)/ });

    await act(async () => {
      fireEvent.click(switchToPicture);
    });

    // The picture is now what the canvas shows, and the deck keeps its tab.
    await waitFor(() => expect(shell.state().activeFileId).toBe("f1"));
    expect(shell.state().openFileIds).toContain("file-deck");
  });

  it("stays in image mode with the picture open", async () => {
    const { shell } = await besideImageTask();
    await shell.dispatch({ type: "open-file", fileId: "f1" });
    await waitFor(() => expect(chatIsImageMode()).toBe(true));
  });
});

/**
 * The Dex panel is the other composer that can sit over a document while the
 * project's last run was a picture — same rule, different placement.
 */
describe("the Dex panel beside an image task", () => {
  it("keeps a message about the document it sits over", async () => {
    const shell = await renderShell({
      fastAgent: true,
      tasks: [imageTask()],
      files: [...seedFiles(), picture],
    });
    const sent: SendInput[] = [];
    const send = shell.port.agent.send.bind(shell.port.agent);
    shell.port.agent.send = async (input) => {
      sent.push(input);
      await send(input);
    };

    await shell.dispatch({ type: "open-local-file", fileId: "file-plan" });
    await act(async () => {
      fireEvent.click(shell.view.container.querySelector<HTMLElement>("button.dx-dex[data-act=dex]")!);
    });

    const panel = shell.view.container.querySelector(".dx-dex-panel")!;
    expect(panel.querySelector(".dx-composer")).not.toBeNull();
    expect(panel.querySelector(".shell-cx")).toBeNull();

    await act(async () => {
      fireEvent.change(shell.view.getByLabelText("Message Dex about this document"), {
        target: { value: "Shorten the opening." },
      });
    });
    await act(async () => {
      fireEvent.click(shell.view.getByTitle("Send message"));
    });

    expect(sent).toHaveLength(1);
    expect(sent[0].activeFileId).toBe("file-plan");
    expect(sent[0].imageGeneration).toBeUndefined();
  });
});
