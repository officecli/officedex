import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { toast } from "../../renderer/ui";
import type { AgentImageRun, FileMeta } from "../../shared/uiPort";
import { seedFiles } from "../port/fake/seed";
import { imageRun, imageTask, openImageChat, picture } from "./imageHarness";

/**
 * The conversation beside a picture.
 *
 * What it must not do is show the generic transcript, which for an image run is
 * a list of steps that never tick and an artifact card for a run that produced
 * four files. What it must do is say what was asked for, once per message, and
 * give every picture a way back onto the canvas.
 *
 * It is the second column of the r10 workspace (`#dx-conversation`), reached by
 * opening the conversation rather than by entering a mode.
 */

afterEach(() => {
  cleanup();
  toast.destroy();
});

const pane = () => document.querySelector("#dx-conversation");
const text = () => pane()?.textContent ?? "";

async function openTranscript(runs: AgentImageRun[], files: FileMeta[]) {
  const shell = await openImageChat({
    task: imageTask(runs, {
      // The runtime also records the prompts as ordinary messages. The image
      // transcript draws the *runs*, so these must not appear twice.
      messages: [{ id: "m1", role: "user", text: "A warm desk lamp", createdAt: 0 }],
    }),
    files,
  });
  await waitFor(() => expect(text()).toContain("Image creation"));
  return shell;
}

describe("the image transcript", () => {
  it("shows one bubble per message, whatever the batch size", async () => {
    await openTranscript(
      [
        imageRun({ taskId: "r1", prompt: "A warm desk lamp" }),
        imageRun({ taskId: "r2", prompt: "A warm desk lamp" }),
        imageRun({ taskId: "r3", prompt: "Cooler light", baseTaskId: "r1" }),
      ],
      [...seedFiles(), picture("f1", "r1"), picture("f2", "r2"), picture("f3", "r3")],
    );

    const bubbles = document.querySelectorAll("#dx-conversation .shell-task-user");
    expect(bubbles).toHaveLength(2);
    expect(bubbles[1].textContent).toContain("Based on Version 1");
    expect(bubbles[0].textContent).not.toContain("Based on Version");

    // One card per picture, and the invitation to keep going.
    expect(document.querySelectorAll(".shell-image-result")).toHaveLength(3);
    expect(text()).toContain("Describe a change below. Your original stays in version history.");
  });

  it("opens the version a result card names", async () => {
    const shell = await openTranscript(
      [imageRun({ taskId: "r1" })],
      [...seedFiles(), picture("f1", "r1")],
    );

    const card = document.querySelector<HTMLButtonElement>(".shell-image-result")!;
    expect(card.textContent).toContain("f1.png");
    expect(card.textContent).toContain("Version 1");

    fireEvent.click(card);
    await waitFor(() => expect(shell.state().activeFileId).toBe("f1"));
  });

  it("says what the next message will change once a version is open, inside the composer", async () => {
    const shell = await openTranscript(
      [imageRun({ taskId: "r1" })],
      [...seedFiles(), picture("f1", "r1")],
    );
    await shell.dispatch({ type: "open-file", fileId: "f1" });

    // The header is the card's first line, not a bar floating above it.
    const head = () => document.querySelector(".shell-cx--task .shell-ig-head");
    await waitFor(() => expect(head()?.textContent).toContain("Editing Version 1"));
    expect(head()?.textContent).toContain("Original preserved");
    expect(document.querySelector(".shell-cx--task")?.firstElementChild).toBe(head());
  });

  it("keeps the instruction and offers it again when a run failed", async () => {
    const shell = await openTranscript(
      [imageRun({ taskId: "r1", status: "failed" })],
      [...seedFiles()],
    );

    const box = document.querySelector('.shell-image-error[role="alert"]');
    expect(box?.textContent).toContain("The image couldn't be created. Your instructions are saved.");

    const send = vi.spyOn(shell.port.agent, "send");
    fireEvent.click(box!.querySelector("button")!);
    await waitFor(() =>
      expect(send).toHaveBeenCalledWith(expect.objectContaining({ documentType: "img" })),
    );
  });

  it("reports a stopped run as a status rather than an alarm", async () => {
    await openTranscript([imageRun({ taskId: "r1", status: "cancelled" })], [...seedFiles()]);
    expect(document.querySelector('.shell-image-error[role="status"]')?.textContent).toContain(
      "Generation stopped. Your previous images are safe.",
    );
  });

  /* The generic column's furniture has nothing to say about a picture. */
  it("does not also render the document transcript", async () => {
    await openTranscript([imageRun({ taskId: "r1" })], [...seedFiles(), picture("f1", "r1")]);
    expect(document.querySelector(".dx-agent-run")).toBeNull();
    expect(document.querySelector(".dx-agent-steps")).toBeNull();
    // The prompt the runtime also recorded as a message is not drawn a second
    // time as an ordinary bubble.
    expect(document.querySelectorAll("#dx-conversation .dx-message")).toHaveLength(0);
    expect(document.querySelectorAll("#dx-conversation .shell-task-user")).toHaveLength(1);
  });
});
