import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { toast } from "../../renderer/ui";
import type { AgentImageRun, AgentTask, FileMeta } from "../../shared/uiPort";
import { SEED_FOLDER_ID, seedFiles } from "../port/fake/seed";
import { renderShell } from "../test/renderShell";

/**
 * The picture surface, over the canvas.
 *
 * These assert the four states it can be in and the two things it can do with a
 * finished picture, because those are the parts that have no equivalent
 * anywhere else in the shell: a document surface never has to draw its own
 * bytes, never has a version strip, and never offers "save this somewhere".
 */

afterEach(() => {
  cleanup();
  toast.destroy();
});

function run(partial: Partial<AgentImageRun> & { taskId: string }): AgentImageRun {
  return { status: "done", prompt: "A warm desk lamp", ...partial };
}

function imageTask(runs: AgentImageRun[]): AgentTask {
  return {
    id: runs[0].taskId,
    title: "A warm desk lamp",
    folderId: SEED_FOLDER_ID,
    documentType: "img",
    status: runs.some((entry) => entry.status === "running") ? "writing" : "done",
    phase: "Creating image",
    steps: [],
    messages: [],
    suggestion: null,
    question: null,
    image: { runs },
  };
}

function picture(id: string, taskId: string, folderId = SEED_FOLDER_ID): FileMeta {
  return {
    id,
    name: `${id}.png`,
    type: "image",
    folderId,
    createdAt: 0,
    updatedAt: 0,
    lastOpenedAt: null,
    dirty: false,
    pinned: false,
    artifactTaskId: taskId,
  };
}

const surface = () => document.querySelector(".shell-image-surface");
const text = () => surface()?.textContent ?? "";
const buttonWith = (label: string) =>
  [...document.querySelectorAll<HTMLButtonElement>(".shell-image-surface button")].find((button) =>
    (button.textContent ?? "").includes(label),
  );

/** Two finished versions, the newer one open. */
async function readyShell() {
  const shell = await renderShell({
    fastAgent: true,
    tasks: [imageTask([run({ taskId: "r1" }), run({ taskId: "r2" })])],
    files: [...seedFiles(), picture("f1", "r1"), picture("f2", "r2")],
  });
  await shell.dispatch({ type: "select-folder", folderId: SEED_FOLDER_ID });
  await shell.dispatch({ type: "open-file", fileId: "f2" });
  await waitFor(() => expect(surface()).not.toBeNull());
  return shell;
}

describe("the image workspace while a picture is being made", () => {
  it("says so on the canvas and offers a way out", async () => {
    const shell = await renderShell({
      fastAgent: true,
      tasks: [imageTask([run({ taskId: "r1", status: "running" })])],
    });
    await shell.dispatch({ type: "select-folder", folderId: SEED_FOLDER_ID });
    await shell.dispatch({ type: "enter-workspace" });

    await waitFor(() => expect(text()).toContain("Creating your image"));
    expect(text()).toContain("You can leave this task and come back.");

    /*
     * Stopping is `agent.stop`, which is the port's `finish` — the same call
     * the composer's Stop makes. The fake marks every running run cancelled
     * there, which is what turns this canvas into the "Try again" one; asserted
     * at the port because a seeded task never became the fake's *running* task,
     * and the wiring is what this owns.
     */
    const finish = vi.spyOn(shell.port.agent, "finish");
    fireEvent.click(buttonWith("Stop generation")!);
    await waitFor(() => expect(finish).toHaveBeenCalled());
  });

  /* The run is the folder's; a deck the user clicked is what they are looking at. */
  it("stands aside for a document opened while it runs, and comes back without one", async () => {
    const shell = await renderShell({
      fastAgent: true,
      tasks: [imageTask([run({ taskId: "r1", status: "running" })])],
    });
    await shell.dispatch({ type: "select-folder", folderId: SEED_FOLDER_ID });
    await shell.dispatch({ type: "enter-workspace" });
    await waitFor(() => expect(text()).toContain("Creating your image"));

    await shell.dispatch({ type: "open-file", fileId: "file-deck" });
    await waitFor(() => expect(surface()).toBeNull());

    await shell.dispatch({ type: "enter-workspace" });
    await waitFor(() => expect(text()).toContain("Creating your image"));
  });

  it("does not cover a document with a failed run's Try again", async () => {
    const shell = await renderShell({
      fastAgent: true,
      tasks: [imageTask([run({ taskId: "r1", status: "cancelled" })])],
    });
    await shell.dispatch({ type: "select-folder", folderId: SEED_FOLDER_ID });
    await shell.dispatch({ type: "open-file", fileId: "file-plan" });
    await waitFor(() => expect(document.querySelector(".shell-task")).not.toBeNull());
    expect(surface()).toBeNull();
  });

  it("offers the instruction again when a run ended with nothing", async () => {
    const shell = await renderShell({
      fastAgent: true,
      tasks: [imageTask([run({ taskId: "r1", status: "cancelled" })])],
    });
    await shell.dispatch({ type: "select-folder", folderId: SEED_FOLDER_ID });
    await shell.dispatch({ type: "enter-workspace" });

    await waitFor(() => expect(text()).toContain("Try again"));
    expect(text()).toContain("Your prompt and reference files are still here.");

    const send = vi.spyOn(shell.port.agent, "send");
    fireEvent.click(buttonWith("Try again")!);
    await waitFor(() =>
      expect(send).toHaveBeenCalledWith(
        expect.objectContaining({
          documentType: "img",
          imageGeneration: expect.objectContaining({ prompt: "A warm desk lamp" }),
        }),
      ),
    );
  });
});

describe("the image workspace with a finished picture", () => {
  it("shows the picture, its version and the versions that came before", async () => {
    await readyShell();

    expect(document.querySelector(".shell-image-figure")).not.toBeNull();
    expect(document.querySelector("figcaption")?.textContent).toContain("Version 2");

    const tiles = document.querySelectorAll(".shell-image-version");
    expect(tiles).toHaveLength(2);
    expect(tiles[1].getAttribute("aria-pressed")).toBe("true");
    expect(text()).toContain("Create another");
  });

  it("opens the version that was picked", async () => {
    const shell = await readyShell();

    fireEvent.click(document.querySelectorAll<HTMLButtonElement>(".shell-image-version")[0]);

    await waitFor(() => expect(shell.state().activeFileId).toBe("f1"));
    await waitFor(() =>
      expect(document.querySelector("figcaption")?.textContent).toContain("Version 1"),
    );
  });

  it("saves a copy through the system dialog and says where it went", async () => {
    const shell = await readyShell();
    const saveCopy = vi.spyOn(shell.port.images!, "saveCopy");

    fireEvent.click(buttonWith("Download")!);

    await waitFor(() => expect(saveCopy).toHaveBeenCalledWith("f2"));
    await waitFor(() => expect(document.body.textContent).toContain("Saved to"));
  });

  /*
   * "Save to folder" is a file move, not a copy: a generated picture already
   * lives in the library, and the only question left is which folder it belongs
   * to. The button then reads "Saved to folder", which is the state of the file
   * rather than the memory of a click.
   */
  it("moves the picture into the folder that was chosen", async () => {
    const shell = await renderShell({
      fastAgent: true,
      tasks: [imageTask([run({ taskId: "r1" })])],
      // The default folder: nothing has been filed anywhere yet.
      files: [...seedFiles(), picture("f1", "r1", "folder-inbox")],
    });
    await shell.dispatch({ type: "select-folder", folderId: SEED_FOLDER_ID });
    await shell.dispatch({ type: "open-file", fileId: "f1" });
    await waitFor(() => expect(text()).toContain("Save to folder"));

    fireEvent.click(buttonWith("Save to folder")!);
    const item = [...document.querySelectorAll<HTMLButtonElement>(".shell-menu-item")].find(
      (button) => (button.textContent ?? "").includes("Customer research"),
    );
    fireEvent.click(item!);

    await waitFor(async () => {
      const files = await shell.port.files.list();
      expect(files.find((file) => file.id === "f1")?.folderId).toBe("folder-research");
    });
    await waitFor(() => expect(text()).toContain("Saved to folder"));
    expect(document.body.textContent).toContain("Image saved to Customer research");
  });
});

/*
 * The canvas shows the picture at whatever size the frame leaves it; the viewer
 * is how you see it bigger. jsdom has no layout, so these assert the viewer's
 * contract — it opens from the picture, it is modal, it steps through versions
 * and it gives focus back — and leave the zoom arithmetic to the browser.
 */
describe("the full-size viewer", () => {
  const viewer = () => document.querySelector<HTMLElement>(".shell-image-viewer");
  const trigger = () => document.querySelector<HTMLButtonElement>(".shell-image-zoom-trigger")!;

  // jsdom has no blob URLs, and the picture is only a button once it has one.
  beforeEach(() => {
    let count = 0;
    vi.stubGlobal("URL", Object.assign(URL, {
      createObjectURL: vi.fn(() => `blob:picture-${++count}`),
      revokeObjectURL: vi.fn(),
    }));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete (URL as { createObjectURL?: unknown }).createObjectURL;
    delete (URL as { revokeObjectURL?: unknown }).revokeObjectURL;
  });

  async function openViewer() {
    const shell = await readyShell();
    await waitFor(() => expect(trigger().disabled).toBe(false));
    trigger().focus();
    fireEvent.click(trigger());
    await waitFor(() => expect(viewer()).not.toBeNull());
    return shell;
  }

  it("opens from the picture as a modal dialog inside the shell", async () => {
    await openViewer();

    expect(viewer()!.getAttribute("role")).toBe("dialog");
    expect(viewer()!.getAttribute("aria-modal")).toBe("true");
    expect(viewer()!.closest("#shell")).not.toBeNull();
    expect(viewer()!.textContent).toContain("Version 2 · 2 of 2");
    expect(document.activeElement).toBe(viewer());
  });

  it("closes on Escape and gives focus back to the picture", async () => {
    await openViewer();

    fireEvent.keyDown(window, { key: "Escape" });

    await waitFor(() => expect(viewer()).toBeNull());
    expect(document.activeElement).toBe(trigger());
  });

  it("closes from its close button", async () => {
    await openViewer();

    fireEvent.click(viewer()!.querySelector<HTMLButtonElement>('button[aria-label^="Close"]')!);

    await waitFor(() => expect(viewer()).toBeNull());
  });

  /*
   * The real app keeps the presentation and Word editors mounted under the
   * picture as <iframe>s, and a key pressed inside a frame never reaches this
   * window — which is how Esc stopped working there and nowhere else.
   */
  it("makes the rest of the shell inert while it is up, and gives it back", async () => {
    await openViewer();
    const others = [...document.getElementById("shell")!.children].filter((element) => element !== viewer());
    expect(others.length).toBeGreaterThan(0);
    expect(others.every((element) => element.hasAttribute("inert"))).toBe(true);

    fireEvent.keyDown(window, { key: "Escape" });

    await waitFor(() => expect(viewer()).toBeNull());
    expect(others.some((element) => element.hasAttribute("inert"))).toBe(false);
  });

  it("takes focus back when something underneath grabs it, so Esc still closes", async () => {
    await openViewer();
    const frame = document.createElement("iframe");
    document.body.append(frame);

    frame.focus();
    fireEvent.focusIn(frame);
    expect(document.activeElement).toBe(viewer());

    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    await waitFor(() => expect(viewer()).toBeNull());
    frame.remove();
  });

  it("steps through the versions with the arrow keys, and only where there is one", async () => {
    const shell = await openViewer();
    expect(viewer()!.querySelector('[data-side="next"]')).toBeNull();

    fireEvent.keyDown(window, { key: "ArrowLeft" });

    await waitFor(() => expect(shell.state().activeFileId).toBe("f1"));
    await waitFor(() => expect(viewer()!.textContent).toContain("Version 1 · 1 of 2"));
    expect(viewer()!.querySelector('[data-side="previous"]')).toBeNull();
    expect(viewer()!.querySelector('[data-side="next"]')).not.toBeNull();
  });

  it("downloads the picture it is showing", async () => {
    const shell = await openViewer();
    const saveCopy = vi.spyOn(shell.port.images!, "saveCopy");

    fireEvent.click(viewer()!.querySelector<HTMLButtonElement>('button[aria-label="Download"]')!);

    await waitFor(() => expect(saveCopy).toHaveBeenCalledWith("f2"));
  });
});

describe("the image workspace when there is no picture", () => {
  it("stays out of the way of a document", async () => {
    const shell = await renderShell({ fastAgent: true });
    const [open] = await shell.port.files.list();
    await shell.dispatch({ type: "open-file", fileId: open.id });

    await waitFor(() => expect(shell.state().activeFileId).toBe(open.id));
    expect(surface()).toBeNull();
  });
});
