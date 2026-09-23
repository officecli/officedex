import { act, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { toast } from "../../renderer/ui";
import type { AgentTask, FileMeta, SendInput } from "../../shared/uiPort";
import { SEED_FOLDER_ID, seedFiles } from "../port/fake/seed";
import { resetComposerDrafts } from "./Composer";
import { renderShell } from "../test/renderShell";

/**
 * The panel's task is the folder's latest run, not the open file's.
 *
 * A folder whose last run made a picture kept its task panel in image mode for
 * every file opened after it — so "what is this deck about", typed beside an
 * open deck, went to the image model as a brief and the canvas turned into
 * "Creating your image".
 */

afterEach(() => {
  cleanup();
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

const composer = () => document.querySelector(".shell-task .shell-cx");

async function besideImageTask() {
  const shell = await renderShell({ fastAgent: true, tasks: [imageTask()], files: [...seedFiles(), picture] });
  const sent: SendInput[] = [];
  const send = shell.port.agent.send.bind(shell.port.agent);
  shell.port.agent.send = async (input) => {
    sent.push(input);
    await send(input);
  };
  await shell.dispatch({ type: "select-folder", folderId: SEED_FOLDER_ID });
  return { shell, sent };
}

async function sendFromPanel(shell: Awaited<ReturnType<typeof renderShell>>, text: string) {
  await act(async () => {
    fireEvent.change(shell.view.getByLabelText("Message Agent"), { target: { value: text } });
  });
  await act(async () => {
    fireEvent.click(shell.view.getByTitle("Send message"));
  });
}

describe("the task composer beside an image task", () => {
  it("talks about the open deck, not the folder's last picture", async () => {
    const { shell, sent } = await besideImageTask();
    await shell.dispatch({ type: "open-file", fileId: "file-deck" });
    await waitFor(() => expect(composer()).not.toBeNull());

    expect(composer()!.classList.contains("is-image")).toBe(false);
    await sendFromPanel(shell, "这个ppt在讲什么，总结一下");

    expect(sent).toHaveLength(1);
    expect(sent[0].activeFileId).toBe("file-deck");
    expect(sent[0].documentType).not.toBe("img");
    expect(sent[0].imageGeneration).toBeUndefined();
  });

  it("still stays in image mode with the picture open", async () => {
    const { shell } = await besideImageTask();
    await shell.dispatch({ type: "open-file", fileId: "f1" });
    await waitFor(() => expect(composer()?.classList.contains("is-image")).toBe(true));
  });

  it("steps off the document when a picture is asked for beside it", async () => {
    const { shell, sent } = await besideImageTask();
    await shell.dispatch({ type: "open-file", fileId: "file-deck" });
    await waitFor(() => expect(composer()).not.toBeNull());

    await act(async () => {
      fireEvent.click(shell.view.getByTitle("Generate image"));
    });
    await sendFromPanel(shell, "A cover picture for this deck");

    expect(sent[0].documentType).toBe("img");
    expect(sent[0].activeFileId).toBeNull();
    // Off the deck — onto the workspace, then the finished picture — with the
    // deck's tab left open.
    expect(shell.state().activeFileId).not.toBe("file-deck");
    expect(shell.state().openFileIds).toContain("file-deck");

    // Back on the deck, the next message is about the deck again.
    await shell.dispatch({ type: "open-file", fileId: "file-deck" });
    await waitFor(() => expect(composer()!.classList.contains("is-image")).toBe(false));
  });

  it("drops a hand-picked image mode when a document is opened", async () => {
    const { shell } = await besideImageTask();
    await shell.dispatch({ type: "open-file", fileId: "file-deck" });
    await waitFor(() => expect(composer()).not.toBeNull());

    await act(async () => {
      fireEvent.click(shell.view.getByTitle("Generate image"));
    });
    expect(composer()!.classList.contains("is-image")).toBe(true);

    await shell.dispatch({ type: "open-file", fileId: "file-plan" });
    await waitFor(() => expect(composer()!.classList.contains("is-image")).toBe(false));
  });

  /* The panel remounts on the way back from Home; the kept draft must not win. */
  it("does not carry image mode into a document opened from Home", async () => {
    const { shell } = await besideImageTask();
    // A folder with no image task, so the mode is the draft's and nothing else's.
    await shell.dispatch({ type: "select-folder", folderId: "folder-research" });
    await shell.dispatch({ type: "enter-workspace" });
    await waitFor(() => expect(composer()).not.toBeNull());
    await act(async () => {
      fireEvent.click(shell.view.getByTitle("Generate image"));
    });
    expect(composer()!.classList.contains("is-image")).toBe(true);

    await shell.dispatch({ type: "go-home" });
    await waitFor(() => expect(composer()).toBeNull());
    await shell.dispatch({ type: "open-file", fileId: "file-readout" });
    await waitFor(() => expect(composer()).not.toBeNull());
    expect(composer()!.classList.contains("is-image")).toBe(false);
  });
});
