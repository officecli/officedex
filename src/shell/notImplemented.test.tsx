import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ToastHost, toast } from "../renderer/ui";
import { NotImplementedError } from "../shared/notImplemented";
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
  cleanup();
});

const notice = () => document.body.textContent ?? "";

const untilNotice = (needle: string) =>
  waitFor(() => {
    if (!notice().includes(needle)) throw new Error(`waiting for “${needle}” — saw: ${notice().slice(0, 200)}`);
  });

describe("reportPortFailure", () => {
  // The shell mounts ToastHost inside App; these two exercise the reporter on
  // its own, so they bring their own host.
  const host = () => render(<ToastHost />);

  // Two different things to tell someone, so two different tones and two
  // different headlines.
  it("separates a missing feature from a real failure", async () => {
    host();
    reportPortFailure(new NotImplementedError("files.create", "Creating a blank document is not built yet."));
    await untilNotice("Not built yet");
    expect(notice()).toContain("Creating a blank document is not built yet.");

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
   * Share used to be the representative of this class, and these two cases
   * asserted it said "Not built yet".
   *
   * It is not in that class, and saying so was the bug (S8-011): sharing *is*
   * implemented — the system share sheet when there is one, the file's path on
   * the clipboard otherwise — it just needs a document. The old notice ran
   * "Sharing a file from OfficeDex is not built yet. Open a local file first.",
   * two sentences that cancel each other out, and the assertion below was
   * keeping them that way.
   *
   * What the rule actually requires is unchanged and still asserted here: press
   * the control, and it answers. Toasts portal outside the render container, so
   * the assertions read from `document.body`.
   */
  it("answers when pressed", async () => {
    const shell = await renderShell();
    await shell.dispatch({ type: "go-home" });

    const share = shell.view.container.querySelector<HTMLElement>(".shell-share");
    expect(share, "the Share button is still in the UI").not.toBeNull();

    fireEvent.click(share!);
    await untilNotice("Open a file to share it");
    // And it no longer claims the feature is missing.
    expect(notice()).not.toContain("not built yet");
  });

  // Six clicks on six formatting tools should leave one notice on screen, not
  // six. The key is what makes that true.
  it("does not stack one notice per click", async () => {
    const shell = await renderShell();
    const share = shell.view.container.querySelector<HTMLElement>(".shell-share")!;

    fireEvent.click(share);
    fireEvent.click(share);
    fireEvent.click(share);
    await untilNotice("Open a file to share it");

    expect(document.body.querySelectorAll(".od-toast-slot")).toHaveLength(1);
  });
});
