import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ToastHost, toast } from "../renderer/ui";
import { NotImplementedError } from "../shared/notImplemented";
import { Layers, resetLayers } from "./kit/layers";
import { SEED_ACTIVE_FILE_ID } from "./port/fake/seed";
import { reportPortFailure } from "./port/reportPortFailure";
import { renderShell } from "./test/renderShell";

/**
 * The rule these guard: **a control the user can press always answers.**
 *
 * This shell was built against a fake port that implements all of `UiPort`, so
 * every button worked during design. Against the real service layer several do
 * not — some because the service layer has not caught up, some because they
 * were drawn for a capability that has no port method at all. The rule the
 * project settled on is that those controls keep their place and say so when
 * pressed: not hidden, and above all not silent, because a click that vanishes
 * is indistinguishable from a bug in the user's own document.
 *
 * Toasts portal to document.body, so assertions read from there rather than
 * from the render container.
 */

afterEach(() => {
  toast.destroy();
  resetLayers();
  cleanup();
});

const notice = () => document.body.textContent ?? "";

const untilNotice = (needle: string) =>
  waitFor(() => {
    if (!notice().includes(needle)) throw new Error(`waiting for “${needle}” — saw: ${notice().slice(0, 200)}`);
  });

describe("reportPortFailure", () => {
  // The shell mounts both hosts inside App; these exercise the reporter on its
  // own, so they bring their own.
  const host = () =>
    render(
      <>
        <ToastHost />
        <Layers />
      </>,
    );

  // Two different things to tell someone, said in two different places: a
  // missing feature is the workspace's own one-line notice, which asks nothing
  // of the user; a real failure is an error with a headline.
  it("separates a missing feature from a real failure", async () => {
    host();
    reportPortFailure(new NotImplementedError("files.create", "Creating a blank document is not built yet."));
    await untilNotice("Creating a blank document is not built yet.");
    expect(document.querySelector("#dx-notice")?.textContent).toBe("Creating a blank document is not built yet.");
    expect(document.body.querySelectorAll(".od-toast-slot")).toHaveLength(0);

    reportPortFailure(new Error("the disk is full"));
    await untilNotice("That did not work");
    expect(notice()).toContain("the disk is full");
  });

  it("survives something thrown that is not an Error", async () => {
    host();
    reportPortFailure("just a string");
    await untilNotice("just a string");
  });
});

describe("controls with nothing behind them", () => {
  /*
   * Share is where this class of control is now reached from, and it is worth
   * being precise about which half is missing.
   *
   * Sharing itself is implemented: a local file is shared as a copy, and
   * pressing Share opens that dialog (§09). "Export file copy" inside it is the
   * one with no port method behind it, and it is the representative here —
   * saying "Share is not built yet" was itself the bug (S8-011).
   *
   * Share only exists while a document is open, so these open one first.
   * Toasts portal outside the render container; the modal is drawn inside it.
   */
  async function shellWithShareDialog() {
    const shell = await renderShell();
    await shell.dispatch({ type: "open-file", fileId: SEED_ACTIVE_FILE_ID });

    const share = shell.view.container.querySelector<HTMLElement>(".dx-source-share");
    expect(share, "the Share button is still in the UI").not.toBeNull();
    fireEvent.click(share!);

    const dialog = await waitFor(() => {
      const node = shell.view.container.querySelector<HTMLElement>("#dx-modal");
      if (!node?.textContent?.includes("Share a copy")) {
        throw new Error(`waiting for the share dialog — saw: ${node?.textContent?.slice(0, 200) ?? "nothing"}`);
      }
      return node;
    });
    const exportCopy = dialog.querySelector<HTMLElement>("[data-act=export]");
    expect(exportCopy, "Export file copy is still in the dialog").not.toBeNull();
    return { shell, exportCopy: exportCopy! };
  }

  it("answers when pressed", async () => {
    const { exportCopy } = await shellWithShareDialog();

    fireEvent.click(exportCopy);

    await untilNotice("Export is not available yet");
    expect(document.querySelector("#dx-notice")?.textContent).toContain("Export is not available yet");
  });

  // Three presses should leave one notice on screen, not three: the workspace
  // has one notice, and saying a thing again replaces it.
  it("does not stack one notice per click", async () => {
    const { exportCopy } = await shellWithShareDialog();

    fireEvent.click(exportCopy);
    fireEvent.click(exportCopy);
    fireEvent.click(exportCopy);
    await untilNotice("Export is not available yet");

    expect(document.body.querySelectorAll("#dx-notice.dx-visible")).toHaveLength(1);
    expect(document.body.querySelectorAll(".od-toast-slot")).toHaveLength(0);
  });
});
