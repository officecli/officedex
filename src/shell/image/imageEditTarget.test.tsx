import { act, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { toast } from "../../renderer/ui";
import type { AgentImageRun, AgentTask, FileMeta, SendInput } from "../../shared/uiPort";
import { SEED_ACTIVE_FILE_ID, SEED_FOLDER_ID, seedFiles } from "../port/fake/seed";
import { renderShell } from "../test/renderShell";
import { imageBesideDocumentFor, imageEditTargetFor } from "./useImageEditTarget";

afterEach(() => {
  cleanup();
  toast.destroy();
});

/*
 * Which picture a follow-up changes, and that the user can see which.
 *
 * With a version open, that version. With nothing open under a picture's
 * conversation, a follow-up used to become an unrelated new image; it now
 * continues from the newest version — and the header says it picked that one,
 * shows it, and offers "New image instead".
 */

const version = (n: number) => ({ version: n, file: { id: `f${n}` } as FileMeta, run: null });

describe("imageEditTargetFor", () => {
  const series = { isImageTask: true, selected: version(2) };

  it("changes the picture on the canvas", () => {
    expect(imageEditTargetFor({ home: false, activeFile: { type: "image" }, series })).toEqual({
      fileId: "f2",
      version: 2,
      source: "open",
    });
  });

  it("continues from the newest version when nothing is open", () => {
    expect(imageEditTargetFor({ home: false, activeFile: null, series })).toEqual({
      fileId: "f2",
      version: 2,
      source: "latest",
    });
  });

  it("leaves a document on screen alone", () => {
    expect(imageEditTargetFor({ home: false, activeFile: { type: "doc" }, series })).toBeNull();
  });

  it("does not pick a version for a conversation that is not a picture's", () => {
    expect(imageEditTargetFor({ home: false, activeFile: null, series: { isImageTask: false, selected: version(1) } })).toBeNull();
  });

  it("never edits from Home", () => {
    expect(imageEditTargetFor({ home: true, activeFile: { type: "image" }, series })).toBeNull();
  });
});

function run(taskId: string): AgentImageRun {
  return { taskId, status: "done", prompt: "A warm desk lamp" };
}

function picture(id: string, taskId: string): FileMeta {
  return {
    id,
    name: `${id}.png`,
    type: "image",
    folderId: SEED_FOLDER_ID,
    createdAt: 0,
    updatedAt: 0,
    lastOpenedAt: null,
    dirty: false,
    pinned: false,
    artifactTaskId: taskId,
  };
}

function imageTask(runs: AgentImageRun[]): AgentTask {
  return {
    id: runs[0].taskId,
    title: "A warm desk lamp",
    folderId: SEED_FOLDER_ID,
    documentType: "img",
    status: "done",
    phase: "Image ready",
    steps: [],
    messages: [],
    suggestion: null,
    question: null,
    image: { runs },
  };
}

const head = () => document.querySelector<HTMLElement>(".shell-task .shell-ig-head");

async function pictureConversation() {
  const shell = await renderShell({
    fastAgent: true,
    tasks: [imageTask([run("r1"), run("r2")])],
    files: [...seedFiles(), picture("f1", "r1"), picture("f2", "r2")],
  });
  await shell.dispatch({ type: "select-folder", folderId: SEED_FOLDER_ID });
  await shell.dispatch({ type: "enter-workspace" });
  await waitFor(() => expect(head()).not.toBeNull());
  const sent: SendInput[] = [];
  const send = shell.port.agent.send.bind(shell.port.agent);
  shell.port.agent.send = async (input) => {
    sent.push(input);
    await send(input);
  };
  return { shell, sent };
}

async function type(text: string) {
  const box = [...document.querySelectorAll<HTMLTextAreaElement>(".shell-task-composer textarea")][0];
  await act(async () => {
    fireEvent.change(box, { target: { value: text } });
  });
  const button = [...document.querySelectorAll<HTMLButtonElement>(".shell-task-composer [title='Send message']")][0];
  await act(async () => {
    fireEvent.click(button);
  });
}

describe("the composer header under a picture's conversation", () => {
  it("says it will change the newest version, and sends that one", async () => {
    const { sent } = await pictureConversation();
    expect(head()!.dataset.target).toBe("latest");
    expect(head()!.textContent).toContain("Editing Version 2 (latest)");

    await type("Make the light warmer");
    expect(sent[0].imageGeneration?.baseFileId).toBe("f2");
  });

  it("opens the picked version on the canvas when its chip is clicked", async () => {
    const { shell } = await pictureConversation();
    await act(async () => {
      fireEvent.click(head()!.querySelector(".shell-ig-head-target")!);
    });
    await waitFor(() => expect(shell.state().activeFileId).toBe("f2"));
    await waitFor(() => expect(head()!.dataset.target).toBe("open"));
    expect(head()!.textContent).toContain("Editing Version 2");
    expect(head()!.textContent).not.toContain("(latest)");
  });

  it("makes a new image instead when asked, and can go back", async () => {
    const { sent } = await pictureConversation();
    await act(async () => {
      fireEvent.click(document.querySelector<HTMLButtonElement>(".shell-task .shell-ig-head-switch")!);
    });
    expect(head()!.dataset.target).toBe("declined");
    expect(head()!.textContent).toContain("New image");
    expect(head()!.textContent).toContain("Edit Version 2");

    await act(async () => {
      fireEvent.click(document.querySelector<HTMLButtonElement>(".shell-task .shell-ig-head-switch")!);
    });
    expect(head()!.dataset.target).toBe("latest");

    await act(async () => {
      fireEvent.click(document.querySelector<HTMLButtonElement>(".shell-task .shell-ig-head-switch")!);
    });
    await type("A blue armchair");
    expect(sent[0].imageGeneration?.baseFileId).toBeUndefined();
  });

  it("does not pick a picture while a document is open", async () => {
    const { shell } = await pictureConversation();
    await shell.dispatch({ type: "open-file", fileId: SEED_ACTIVE_FILE_ID });
    await waitFor(() => expect(head()).toBeNull());
  });
});

describe("imageBesideDocumentFor", () => {
  const series = { isImageTask: true, selected: version(3) };

  it("names the document and the newest version", () => {
    expect(imageBesideDocumentFor({ home: false, activeFile: { type: "doc", name: "Plan.docx" }, series })).toEqual({
      documentName: "Plan.docx",
      documentType: "doc",
      fileId: "f3",
      version: 3,
    });
  });

  it("says nothing with the picture itself open, or nothing open", () => {
    expect(imageBesideDocumentFor({ home: false, activeFile: { type: "image", name: "f3.png" }, series })).toBeNull();
    expect(imageBesideDocumentFor({ home: false, activeFile: null, series })).toBeNull();
  });

  it("says nothing when the panel is not a picture's conversation", () => {
    expect(
      imageBesideDocumentFor({ home: false, activeFile: { type: "doc", name: "Plan.docx" }, series: { isImageTask: false, selected: version(1) } }),
    ).toBeNull();
  });

  it("says nothing on Home", () => {
    expect(imageBesideDocumentFor({ home: true, activeFile: { type: "doc", name: "Plan.docx" }, series })).toBeNull();
  });
});

/*
 * The common way into a document beside a picture's conversation: the
 * picture's tab is closed and the next tab is a document. The message goes to
 * the document — that rule stays — and the composer now says so, with the
 * picture one click away.
 */
describe("a document on the canvas beside a picture's conversation", () => {
  const aside = () => document.querySelector<HTMLElement>(".shell-task .shell-ig-aside");

  it("says the message is about the document, and switches to the picture", async () => {
    const { shell, sent } = await pictureConversation();
    await shell.dispatch({ type: "open-file", fileId: SEED_ACTIVE_FILE_ID });
    const documentName = seedFiles().find((file) => file.id === SEED_ACTIVE_FILE_ID)!.name;

    await waitFor(() => expect(aside()).not.toBeNull());
    expect(aside()!.textContent).toContain(`This message changes ${documentName}`);
    expect(aside()!.textContent).toContain("Edit the picture (Version 2)");

    await act(async () => {
      fireEvent.click(aside()!.querySelector("button")!);
    });
    await waitFor(() => expect(shell.state().activeFileId).toBe("f2"));
    await waitFor(() => expect(aside()).toBeNull());
    await waitFor(() => expect(head()!.dataset.target).toBe("open"));

    await type("Make the light warmer");
    expect(sent[0].imageGeneration?.baseFileId).toBe("f2");
  });

  it("leaves a message typed there going to the document", async () => {
    const { shell, sent } = await pictureConversation();
    await shell.dispatch({ type: "open-file", fileId: SEED_ACTIVE_FILE_ID });
    await waitFor(() => expect(aside()).not.toBeNull());

    await type("Summarise this");
    expect(sent[0].imageGeneration).toBeUndefined();
    expect(sent[0].activeFileId).toBe(SEED_ACTIVE_FILE_ID);
  });
});
