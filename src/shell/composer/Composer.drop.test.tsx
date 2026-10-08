import { act, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { toast } from "../../renderer/ui";
import type { FileDropPoint, SendInput } from "../../shared/uiPort";
import { resetLayers } from "../kit/layers";
import { SEED_FOLDER_ID } from "../port/fake/seed";
import { renderShell } from "../test/renderShell";
import { dropLandedIn } from "../home/useDiskDrop";
import { resetComposerDrafts } from "./Composer";

afterEach(() => {
  cleanup();
  toast.destroy();
  resetLayers();
  resetComposerDrafts();
  vi.restoreAllMocks();
});

type DropListener = (paths: string[], point?: FileDropPoint) => void;

/**
 * A composer with the port's native drop captured.
 *
 * On the desktop Wails keeps a file drop from the webview: the page sees
 * `dragenter`/`dragover`, then nothing — no DOM `drop`, no `dragleave` — and
 * the paths arrive through the port. That is the sequence these tests replay.
 * The composer subscribes on mount, so the subscription is swapped in before
 * the composer that uses it is mounted.
 *
 * `where` picks the placement: the conversation column, or Home's main input.
 */
async function composerWithDrop(where: "chat" | "home" = "chat") {
  const shell = await renderShell({ fastAgent: true });
  const listeners = new Set<DropListener>();
  shell.port.files.onDropFromDisk = (callback) => {
    listeners.add(callback);
    return () => {
      listeners.delete(callback);
    };
  };
  if (where === "chat") {
    await shell.dispatch({ type: "open-chat", chat: { folderId: SEED_FOLDER_ID, conversationId: null } });
  } else {
    // A fresh render is already on Home; remount its composer against the
    // captured subscription.
    await shell.dispatch({ type: "go", page: "projects" });
    await shell.dispatch({ type: "go", page: "home" });
  }
  await waitFor(() => expect(listeners.size).toBeGreaterThan(0));
  const composer = () => shell.view.container.querySelector<HTMLElement>(".dx-composer")!;
  /* The drop target is the composer itself; r10 marks the state on it rather
     than drawing a panel of its own. */
  const dragging = () => composer().dataset.dragging === "true";
  const dragIn = () => {
    fireEvent.dragEnter(composer(), { dataTransfer: { types: ["Files"], dropEffect: "none" } });
    fireEvent.dragOver(composer(), { dataTransfer: { types: ["Files"], dropEffect: "none" } });
  };
  const nativeDrop = async (paths: string[], point?: FileDropPoint) => {
    await act(async () => {
      for (const listener of [...listeners]) listener(paths, point);
    });
  };
  return { ...shell, composer, dragging, dragIn, nativeDrop };
}

describe("Composer · files dragged in from the desktop", () => {
  it("ends the drag when the drop arrives natively, with no DOM drop", async () => {
    const shell = await composerWithDrop();

    shell.dragIn();
    expect(shell.dragging()).toBe(true);

    await shell.nativeDrop(["/Users/me/Downloads/交付清单.xlsx"]);

    // The regression: `dragging` waited for a DOM drop that never comes, and
    // the drop state sat over the whole composer for good.
    expect(shell.dragging()).toBe(false);
  });

  it("attaches the dropped files by path, and sends the paths", async () => {
    const shell = await composerWithDrop();
    const sent: SendInput["attachments"][] = [];
    const send = shell.port.agent.send.bind(shell.port.agent);
    shell.port.agent.send = async (input) => {
      sent.push(input.attachments);
      return send(input);
    };

    shell.dragIn();
    await shell.nativeDrop(["/Users/me/Downloads/交付清单.xlsx"]);

    expect(shell.view.getByLabelText("Remove 交付清单.xlsx")).toBeInTheDocument();

    await act(async () => {
      fireEvent.change(shell.view.getByLabelText("Message OfficeDex"), {
        target: { value: "Summarise this." },
      });
    });
    await act(async () => {
      fireEvent.click(shell.view.getByTitle("Send message"));
    });

    expect(sent).toHaveLength(1);
    expect(sent[0]).toEqual([
      expect.objectContaining({ name: "交付清单.xlsx", path: "/Users/me/Downloads/交付清单.xlsx" }),
    ]);
  });

  it("ends the drag on the first mouse move, however it finished", async () => {
    const shell = await composerWithDrop();

    shell.dragIn();
    expect(shell.dragging()).toBe(true);

    // No drop and no dragleave reached the page; the pointer moving again
    // means the drag is over.
    fireEvent.mouseMove(window);

    expect(shell.dragging()).toBe(false);
  });

  /* Home's main input is where a file dragged off the desktop most often lands. */
  it("attaches a drop on Home, and sends the path from there", async () => {
    const shell = await composerWithDrop("home");
    const sent: SendInput["attachments"][] = [];
    const send = shell.port.agent.send.bind(shell.port.agent);
    shell.port.agent.send = async (input) => {
      sent.push(input.attachments);
      return send(input);
    };

    shell.dragIn();
    expect(shell.dragging()).toBe(true);
    await shell.nativeDrop(["/Users/me/Downloads/Plan.docx"]);

    expect(shell.dragging()).toBe(false);
    expect(shell.view.getByLabelText("Remove Plan.docx")).toBeInTheDocument();

    await act(async () => {
      fireEvent.change(shell.view.getByLabelText("Describe your task"), {
        target: { value: "Summarise this." },
      });
    });
    await act(async () => {
      fireEvent.click(shell.view.getByTitle("Send message"));
    });

    expect(sent).toEqual([
      [expect.objectContaining({ name: "Plan.docx", path: "/Users/me/Downloads/Plan.docx" })],
    ]);
  });

  it("does not attach a drop that landed somewhere else", async () => {
    const shell = await composerWithDrop();
    const elsewhere = document.createElement("div");
    document.body.appendChild(elsewhere);
    const hitTest = vi.fn(() => elsewhere);
    Object.defineProperty(document, "elementFromPoint", { configurable: true, value: hitTest });

    try {
      shell.dragIn();
      await shell.nativeDrop(["/Users/me/Plan.docx"], { x: 10, y: 10 });

      expect(hitTest).toHaveBeenCalledWith(10, 10);
      expect(shell.view.queryByLabelText("Remove Plan.docx")).toBeNull();
      // It still ended the drag.
      expect(shell.dragging()).toBe(false);
    } finally {
      delete (document as { elementFromPoint?: unknown }).elementFromPoint;
      elsewhere.remove();
    }
  });
});

describe("dropLandedIn", () => {
  function nestedZones() {
    const outer = document.createElement("div");
    outer.setAttribute("data-disk-drop-zone", "");
    const inner = document.createElement("div");
    inner.setAttribute("data-disk-drop-zone", "");
    const textarea = document.createElement("textarea");
    inner.appendChild(textarea);
    const plain = document.createElement("p");
    outer.append(inner, plain);
    document.body.appendChild(outer);
    return { outer, inner, textarea, plain };
  }

  function hitting(element: Element) {
    Object.defineProperty(document, "elementFromPoint", { configurable: true, value: () => element });
  }

  afterEach(() => {
    delete (document as { elementFromPoint?: unknown }).elementFromPoint;
    document.body.innerHTML = "";
  });

  it("gives a drop to the innermost zone under the point", () => {
    const { outer, inner, textarea, plain } = nestedZones();

    hitting(textarea);
    expect(dropLandedIn(inner, { x: 1, y: 1 })).toBe(true);
    expect(dropLandedIn(outer, { x: 1, y: 1 })).toBe(false);

    hitting(plain);
    expect(dropLandedIn(inner, { x: 1, y: 1 })).toBe(false);
    expect(dropLandedIn(outer, { x: 1, y: 1 })).toBe(true);
  });

  it("gives it to every zone when there is nothing to decide with", () => {
    const { outer, inner } = nestedZones();

    expect(dropLandedIn(inner)).toBe(true);
    expect(dropLandedIn(outer)).toBe(true);
    expect(dropLandedIn(null)).toBe(false);
  });
});
