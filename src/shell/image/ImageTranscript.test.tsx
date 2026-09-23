import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { toast } from "../../renderer/ui";
import type { AgentImageRun, AgentTask, FileMeta } from "../../shared/uiPort";
import { SEED_FOLDER_ID, seedFiles } from "../port/fake/seed";
import { renderShell } from "../test/renderShell";

/**
 * The conversation beside a picture.
 *
 * What it must not do is show the generic transcript, which for an image run is
 * a list of steps that never tick and an artifact card for a run that produced
 * four files. What it must do is say what was asked for, once per message, and
 * give every picture a way back onto the canvas.
 */

afterEach(() => {
  cleanup();
  toast.destroy();
});

function run(partial: Partial<AgentImageRun> & { taskId: string }): AgentImageRun {
  return { status: "done", prompt: "A warm desk lamp", ...partial };
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
    messages: [
      // The runtime also records the prompts as ordinary messages. The image
      // transcript draws the *runs*, so these must not appear twice.
      { id: "m1", role: "user", text: "A warm desk lamp", createdAt: 0 },
    ],
    suggestion: null,
    question: null,
    image: { runs },
  };
}

const panel = () => document.querySelector(".shell-task");
const text = () => panel()?.textContent ?? "";

async function openTranscript(runs: AgentImageRun[], files: FileMeta[]) {
  const shell = await renderShell({ fastAgent: true, tasks: [imageTask(runs)], files });
  await shell.dispatch({ type: "select-folder", folderId: SEED_FOLDER_ID });
  await shell.dispatch({ type: "enter-workspace" });
  await waitFor(() => expect(text()).toContain("Image creation"));
  return shell;
}

describe("the image transcript", () => {
  it("shows one bubble per message, whatever the batch size", async () => {
    await openTranscript(
      [
        run({ taskId: "r1", prompt: "A warm desk lamp" }),
        run({ taskId: "r2", prompt: "A warm desk lamp" }),
        run({ taskId: "r3", prompt: "Cooler light", baseTaskId: "r1" }),
      ],
      [...seedFiles(), picture("f1", "r1"), picture("f2", "r2"), picture("f3", "r3")],
    );

    const bubbles = document.querySelectorAll(".shell-task .shell-task-user");
    expect(bubbles).toHaveLength(2);
    expect(bubbles[1].textContent).toContain("Based on Version 1");
    expect(bubbles[0].textContent).not.toContain("Based on Version");

    // One card per picture, and the invitation to keep going.
    expect(document.querySelectorAll(".shell-image-result")).toHaveLength(3);
    expect(text()).toContain("Describe a change below. Your original stays in version history.");
  });

  it("opens the version a result card names", async () => {
    const shell = await openTranscript(
      [run({ taskId: "r1" })],
      [...seedFiles(), picture("f1", "r1")],
    );

    const card = document.querySelector<HTMLButtonElement>(".shell-image-result")!;
    expect(card.textContent).toContain("f1.png");
    expect(card.textContent).toContain("Version 1");

    fireEvent.click(card);
    await waitFor(() => expect(shell.state().activeFileId).toBe("f1"));
  });

  it("says what the next message will change once a version is open", async () => {
    const shell = await openTranscript(
      [run({ taskId: "r1" })],
      [...seedFiles(), picture("f1", "r1")],
    );
    await shell.dispatch({ type: "open-file", fileId: "f1" });

    await waitFor(() =>
      expect(document.querySelector(".shell-image-edit-target")?.textContent).toContain(
        "Editing Version 1",
      ),
    );
    expect(document.querySelector(".shell-image-edit-target")?.textContent).toContain(
      "Original preserved",
    );
  });

  it("keeps the instruction and offers it again when a run failed", async () => {
    const shell = await openTranscript([run({ taskId: "r1", status: "failed" })], [...seedFiles()]);

    const box = document.querySelector('.shell-image-error[role="alert"]');
    expect(box?.textContent).toContain("The image couldn't be created. Your instructions are saved.");

    const send = vi.spyOn(shell.port.agent, "send");
    fireEvent.click(box!.querySelector("button")!);
    await waitFor(() =>
      expect(send).toHaveBeenCalledWith(expect.objectContaining({ documentType: "img" })),
    );
  });

  it("reports a stopped run as a status rather than an alarm", async () => {
    await openTranscript([run({ taskId: "r1", status: "cancelled" })], [...seedFiles()]);
    expect(document.querySelector('.shell-image-error[role="status"]')?.textContent).toContain(
      "Generation stopped. Your previous images are safe.",
    );
  });

  /* The generic column's furniture has nothing to say about a picture. */
  it("does not also render the document transcript", async () => {
    await openTranscript([run({ taskId: "r1" })], [...seedFiles(), picture("f1", "r1")]);
    expect(document.querySelector(".shell-task-steps")).toBeNull();
    expect(document.querySelector(".shell-task-artifact")).toBeNull();
    expect(document.querySelectorAll(".shell-task .shell-task-user")).toHaveLength(1);
  });
});
