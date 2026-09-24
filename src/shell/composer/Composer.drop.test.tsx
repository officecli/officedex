import { act, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { toast } from "../../renderer/ui";
import type { FileDropPoint, SendInput } from "../../shared/uiPort";
import { SEED_ACTIVE_FILE_ID } from "../port/fake/seed";
import { renderShell } from "../test/renderShell";
import { dropLandedIn } from "../home/useDiskDrop";
import { resetComposerDrafts } from "./Composer";

afterEach(() => {
  cleanup();
  toast.destroy();
  resetComposerDrafts();
  vi.restoreAllMocks();
});

type DropListener = (paths: string[], point?: FileDropPoint) => void;

/**
 * Agent Home with the port's native drop captured.
 *
 * On the desktop Wails keeps a file drop from the webview: the page sees
 * `dragenter`/`dragover`, then nothing — no DOM `drop`, no `dragleave` — and
 * the paths arrive through the port. That is the sequence these tests replay.
 * The composer subscribes on mount, so the shell goes to a file and back to
 * remount it against the captured subscription.
 */
async function agentHomeWithDrop() {
  const shell = await renderShell({ fastAgent: true });
  const listeners = new Set<DropListener>();
  shell.port.files.onDropFromDisk = (callback) => {
    listeners.add(callback);
    return () => {
      listeners.delete(callback);
    };
  };
  await shell.dispatch({ type: "open-file", fileId: SEED_ACTIVE_FILE_ID });
  await shell.dispatch({ type: "go-home" });
  await waitFor(() => expect(listeners.size).toBeGreaterThan(0));
  const composer = () => shell.view.container.querySelector<HTMLElement>(".shell-cx--home")!;
  const overlay = () => shell.view.container.querySelector(".shell-cx-drop");
  const dragIn = () => {
    fireEvent.dragEnter(composer(), { dataTransfer: { types: ["Files"], dropEffect: "none" } });
    fireEvent.dragOver(composer(), { dataTransfer: { types: ["Files"], dropEffect: "none" } });
  };
  const nativeDrop = async (paths: string[], point?: FileDropPoint) => {
    await act(async () => {
      for (const listener of [...listeners]) listener(paths, point);
    });
  };
  return { ...shell, composer, overlay, dragIn, nativeDrop };
}

describe("Composer · files dragged in from the desktop", () => {
  it("takes the overlay down when the drop arrives natively, with no DOM drop", async () => {
    const shell = await agentHomeWithDrop();

    shell.dragIn();
    expect(shell.overlay()).not.toBeNull();

    await shell.nativeDrop(["/Users/me/Downloads/交付清单.xlsx"]);

    // The regression: `dragging` waited for a DOM drop that never comes, and
    // the overlay sat over the whole composer for good.
    expect(shell.overlay()).toBeNull();
  });

  it("attaches the dropped files by path, and sends the paths", async () => {
    const shell = await agentHomeWithDrop();
    const sent: SendInput["attachments"][] = [];
    const send = shell.port.agent.send.bind(shell.port.agent);
    shell.port.agent.send = async (input) => {
      sent.push(input.attachments);
      return send(input);
    };

    shell.dragIn();
    await shell.nativeDrop(["/Users/me/Downloads/交付清单.xlsx"]);

    expect(shell.view.getByText("交付清单.xlsx")).toBeInTheDocument();

    await act(async () => {
      fireEvent.change(shell.view.getByLabelText("New task instructions"), {
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

  it("drops the overlay on the first mouse move, however the drag ended", async () => {
    const shell = await agentHomeWithDrop();

    shell.dragIn();
    expect(shell.overlay()).not.toBeNull();

    // No drop and no dragleave reached the page; the pointer moving again
    // means the drag is over.
    fireEvent.mouseMove(window);

    expect(shell.overlay()).toBeNull();
  });

  it("does not attach a drop that landed somewhere else", async () => {
    const shell = await agentHomeWithDrop();
    const elsewhere = document.createElement("div");
    document.body.appendChild(elsewhere);
    const hitTest = vi.fn(() => elsewhere);
    Object.defineProperty(document, "elementFromPoint", { configurable: true, value: hitTest });

    try {
      shell.dragIn();
      await shell.nativeDrop(["/Users/me/Plan.docx"], { x: 10, y: 10 });

      expect(hitTest).toHaveBeenCalledWith(10, 10);
      expect(shell.view.queryByText("Plan.docx")).toBeNull();
      // It still ended the drag.
      expect(shell.overlay()).toBeNull();
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
