/**
 * Dex over an open document — BRAND-DEX-STANDARD §04–§10, OD-UI-1.2 §10.
 *
 * Two promises are worth testing without a browser. The first is where it
 * exists: only over an editable document, so Home, a file list and an empty
 * workspace have none. The second is what it speaks for — Dex sits on a file, so
 * it shows work on *that* file. A conversation beside the editor may be about any
 * of the project's assets, and a panel that showed all of it would be claiming
 * the document on screen was being changed when it was not.
 *
 * Placement and dragging are geometry, which jsdom has none of; those belong to
 * the browser suite.
 */
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { resetLayers } from "../kit/layers";
import {
  PROTOTYPE_CHAT_IDS,
  PROTOTYPE_FOLDER_IDS,
  prototypeFiles,
  prototypeFolders,
  prototypeRun,
  prototypeTasks,
} from "../port/fake/prototypeSeed";
import { renderShell } from "../test/renderShell";

afterEach(() => {
  resetLayers();
  cleanup();
});

/**
 * The prototype's workspace, optionally with one run staged in the "Launch plan
 * & copy" conversation.
 */
async function shell(run?: string) {
  const now = Date.now();
  const staged = run ? prototypeRun(run, now) : null;
  const seeded = prototypeTasks().reverse();
  const harness = await renderShell({
    folders: prototypeFolders(),
    files: prototypeFiles(now),
    tasks: staged
      ? seeded.map((task) => (task.conversationId === staged.conversationId ? staged : task))
      : seeded,
  });
  const find = <T extends HTMLElement>(selector: string) => harness.view.container.querySelector<T>(selector);
  return {
    ...harness,
    find,
    bubble: () => find<HTMLButtonElement>("button.dx-dex[data-act=dex]"),
    panel: () => find<HTMLElement>(".dx-dex-panel"),
    /** The panel is hidden rather than unmounted, so "open" is the attribute. */
    isOpen: () => find(".dx-dex-panel")?.hidden === false,
  };
}

type Shell = Awaited<ReturnType<typeof shell>>;

const openChat = (view: Shell) =>
  view.dispatch({
    type: "open-chat",
    chat: { folderId: PROTOTYPE_FOLDER_IDS.launch, conversationId: PROTOTYPE_CHAT_IDS.plan },
  });

describe("where the bubble exists", () => {
  it("is absent on Home, Local, Assets and Settings", async () => {
    const view = await shell();
    expect(view.bubble()).toBeNull();

    for (const page of ["local", "projects", "settings"] as const) {
      await view.dispatch({ type: "go", page });
      expect(view.bubble(), page).toBeNull();
    }

    await openChat(view);
    expect(view.state().page).toBe("assets");
    expect(view.bubble()).toBeNull();
  });

  it("appears over an open document, closed", async () => {
    const view = await shell();
    await view.dispatch({ type: "open-local-file", fileId: "brief" });

    expect(view.bubble()).not.toBeNull();
    expect(view.bubble()?.getAttribute("aria-expanded")).toBe("false");
    expect(view.isOpen()).toBe(false);
  });

  it("goes away again when the document is closed", async () => {
    const view = await shell();
    await view.dispatch({ type: "open-local-file", fileId: "brief" });
    await view.dispatch({ type: "close-file", fileId: "brief" });
    expect(view.bubble()).toBeNull();
  });
});

describe("opening and closing the panel", () => {
  const openPanel = async () => {
    const view = await shell();
    await view.dispatch({ type: "open-local-file", fileId: "brief" });
    fireEvent.click(view.bubble()!);
    return view;
  };

  it("names the document it is sitting on", async () => {
    const view = await openPanel();

    expect(view.isOpen()).toBe(true);
    expect(view.bubble()?.getAttribute("aria-expanded")).toBe("true");
    expect(view.find(".dx-dex-heading")?.textContent).toContain("Project brief.docx");
    expect(view.panel()?.getAttribute("aria-label")).toBe("Dex");
  });

  it("closes from the panel's own close button", async () => {
    const view = await openPanel();
    fireEvent.click(view.find(".dx-dex-panel header [data-act=dex]")!);

    expect(view.isOpen()).toBe(false);
    expect(view.state().dexOpen).toBe(false);
  });

  it("closes on Escape", async () => {
    const view = await openPanel();
    fireEvent.keyDown(document, { key: "Escape" });

    expect(view.isOpen()).toBe(false);
    expect(view.state().dexOpen).toBe(false);
  });

  it("closes again from the bubble", async () => {
    const view = await openPanel();
    fireEvent.click(view.bubble()!);
    expect(view.isOpen()).toBe(false);
  });

  // Out of sight is also out of the tab order, since the panel stays mounted.
  it("keeps the closed panel out of reach", async () => {
    const view = await shell();
    await view.dispatch({ type: "open-local-file", fileId: "brief" });
    expect(view.panel()?.hasAttribute("inert")).toBe(true);

    fireEvent.click(view.bubble()!);
    expect(view.panel()?.hasAttribute("inert")).toBe(false);
  });
});

describe("what the panel shows", () => {
  it("invites a first instruction when no run touches this file", async () => {
    const view = await shell();
    await view.dispatch({ type: "open-local-file", fileId: "brief" });
    fireEvent.click(view.bubble()!);

    expect(view.find(".dx-dex-empty")?.textContent).toContain("What can we work on?");
    expect(view.panel()?.querySelector(".dx-agent-run")).toBeNull();
  });

  it("shows the run that is about this file", async () => {
    const view = await shell("review");
    await openChat(view);
    // The run's request quoted this file, and its suggestion changes it.
    await view.dispatch({ type: "open-file", fileId: "readme" });
    await waitFor(() => {
      if (!view.bubble()) throw new Error("no Dex over the document");
    });
    fireEvent.click(view.bubble()!);

    const panel = view.panel()!;
    await waitFor(() => {
      if (!panel.querySelector(".dx-agent-run")) throw new Error("the run card is not in the panel");
    });
    expect(panel.querySelector(".dx-agent-run-status")?.textContent).toContain("Ready for review");
    // And the instruction that started it, so the card is not floating free.
    expect(panel.textContent).toContain("Review the launch plan and clarify the next steps.");
    expect(panel.querySelector(".dx-dex-empty")).toBeNull();
  });

  /*
   * A run about another of the project's assets is not this document's business.
   * The conversation beside the editor still shows it; Dex does not.
   */
  it("shows nothing for a run about a different file", async () => {
    const view = await shell("review");
    await openChat(view);
    await view.dispatch({ type: "open-file", fileId: "sheet" });
    await waitFor(() => {
      if (!view.bubble()) throw new Error("no Dex over the document");
    });
    fireEvent.click(view.bubble()!);

    expect(view.panel()?.querySelector(".dx-agent-run")).toBeNull();
    expect(view.find(".dx-dex-empty")?.textContent).toContain("What can we work on?");
    // The conversation column is where that run is read.
    expect(view.find("#dx-conversation")?.querySelector(".dx-agent-run")).not.toBeNull();
  });

  // Words exchanged are the conversation's; Dex shows runs.
  it("shows nothing for a conversation that has only been talked in", async () => {
    const view = await shell("talk");
    await openChat(view);
    await view.dispatch({ type: "open-file", fileId: "readme" });
    await waitFor(() => {
      if (!view.bubble()) throw new Error("no Dex over the document");
    });
    fireEvent.click(view.bubble()!);

    const panel = view.panel()!;
    expect(panel.querySelector(".dx-agent-run")).toBeNull();
    expect(panel.textContent).not.toContain("Summarize the launch priorities");
    expect(panel.querySelector(".dx-dex-empty")).not.toBeNull();
    // Those messages are in the conversation, which is where they belong.
    expect(view.find("#dx-conversation")?.textContent).toContain("Summarize the launch priorities");
  });
});

describe("the panel's composer", () => {
  // §16: opening and closing must not rebuild the draft. A half-written
  // instruction lost to a stray click is the user's words, not view state.
  it("keeps a half-written instruction across a close and reopen", async () => {
    const view = await shell();
    await view.dispatch({ type: "open-local-file", fileId: "brief" });
    fireEvent.click(view.bubble()!);

    const draft = () => view.find<HTMLTextAreaElement>(".dx-dex-panel textarea[data-draft]")!;
    fireEvent.change(draft(), { target: { value: "Shorten the second paragraph" } });
    expect(draft().value).toBe("Shorten the second paragraph");

    fireEvent.click(view.find(".dx-dex-panel header [data-act=dex]")!);
    expect(view.isOpen()).toBe(false);

    fireEvent.click(view.bubble()!);
    expect(view.isOpen()).toBe(true);
    expect(draft().value).toBe("Shorten the second paragraph");
  });
});
