/**
 * Which conversation a message joins, and which one the panel shows — the
 * `ShellContext.scope` rules, exercised through the shell.
 *
 * Two things went wrong before these rules existed, and each is a test here:
 *
 *  - Dex over a Local document asked the folder for "the current
 *    conversation". Every Local file lives in the default folder, so a DOCX
 *    opened after an XLSX showed the XLSX's thread, and Home's run showed up
 *    on whatever file was opened next (1.0.11 acceptance F04).
 *  - A chat that was named but not spoken in existed only as a name in view
 *    state. Leaving for Home, or for another project, dropped it (F06).
 *
 * Both come down to the same fact: a conversation now has an id from the
 * moment it exists, and the shell says which one a message is for.
 */
import { act, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { resetLayers } from "../kit/layers";
import { PROTOTYPE_FOLDER_IDS, prototypeFiles, prototypeFolders, prototypeTasks } from "../port/fake/prototypeSeed";
import { renderShell, type RenderShellOptions } from "../test/renderShell";

afterEach(() => {
  resetLayers();
  cleanup();
});

async function shell(options: Partial<RenderShellOptions> = {}) {
  const harness = await renderShell({
    folders: prototypeFolders(),
    files: prototypeFiles(),
    tasks: prototypeTasks().reverse(),
    fastAgent: true,
    ...options,
  });
  const find = <T extends HTMLElement>(selector: string) => harness.view.container.querySelector<T>(selector);
  const all = (selector: string) => [...harness.view.container.querySelectorAll<HTMLElement>(selector)];
  await waitFor(() => {
    if (!find("#dx-sidebar [data-act=toggle-project]")) throw new Error("the project tree is still loading");
  });
  return {
    ...harness,
    find,
    all,
    /** Opens the Dex panel over the active document. */
    async openDex() {
      await waitFor(() => {
        if (!find("button.dx-dex[data-act=dex]")) throw new Error("no Dex over the document");
      });
      if (find(".dx-dex-panel")?.hidden !== false) fireEvent.click(find("button.dx-dex[data-act=dex]")!);
      return find<HTMLElement>(".dx-dex-panel")!;
    },
    /** Types into a composer and sends. */
    async send(root: Element, text: string) {
      const input = root.querySelector<HTMLTextAreaElement>("textarea[data-draft]")!;
      fireEvent.change(input, { target: { value: text } });
      await act(async () => {
        fireEvent.click(root.querySelector("[data-act=send]")!);
      });
    },
  };
}

type Shell = Awaited<ReturnType<typeof shell>>;

const untilRun = (panel: Element) =>
  waitFor(() => {
    if (!panel.querySelector(".dx-agent-run")) throw new Error("the run has not reached the panel");
  });

describe("a Local document owns its conversation", () => {
  it("keeps two Local files' threads apart and follows the active file", async () => {
    const view = await shell();

    // A: the brief gets an instruction of its own.
    await view.dispatch({ type: "open-local-file", fileId: "brief" });
    const dexA = await view.openDex();
    await view.send(dexA, "Shorten the brief");
    await untilRun(dexA);
    expect(dexA.textContent).toContain("Shorten the brief");

    const rows = await view.port.agent.list();
    expect(rows).toHaveLength(prototypeTasks().length + 1);
    const briefRow = rows.find((row) => row.title === "Shorten the brief")!;
    expect(briefRow.conversationId).toMatch(/^conv-/);
    expect(briefRow.folderId).toBe(PROTOTYPE_FOLDER_IDS.local);

    // B: another Local file in the same folder has nothing to show — not the
    // brief's run, which is what "the folder's current conversation" was.
    await view.dispatch({ type: "open-local-file", fileId: "rich" });
    const dexB = await view.openDex();
    expect(dexB.querySelector(".dx-agent-run")).toBeNull();
    expect(dexB.querySelector(".dx-dex-empty")).not.toBeNull();
    expect(dexB.textContent).not.toContain("Shorten the brief");

    // Back to A: the thread is the file's, and comes back with it.
    await view.dispatch({ type: "activate-file", fileId: "brief" });
    const dexAgain = await view.openDex();
    await untilRun(dexAgain);
    expect(dexAgain.textContent).toContain("Shorten the brief");

    // A second message from B starts B's own conversation, not a follow-up to A's.
    await view.dispatch({ type: "activate-file", fileId: "rich" });
    const dexB2 = await view.openDex();
    await view.send(dexB2, "Tidy the notes");
    await untilRun(dexB2);
    const after = await view.port.agent.list();
    const ids = new Set(after.map((row) => row.conversationId));
    expect(after).toHaveLength(prototypeTasks().length + 2);
    expect(ids.size).toBe(after.length);
    expect(after.find((row) => row.title === "Tidy the notes")?.conversationId).not.toBe(briefRow.conversationId);
  });

  it("does not show Home's conversation on a Local document", async () => {
    const view = await shell();

    await view.send(view.find(".dx-home-composer")!, "Write a launch memo");
    await waitFor(() => {
      if (!view.state().chat?.conversationId) throw new Error("Home's run has not named its conversation");
    });
    const home = view.state().chat!;
    expect(home.folderId).toBe(PROTOTYPE_FOLDER_IDS.local);

    await view.dispatch({ type: "open-local-file", fileId: "brief" });
    const dex = await view.openDex();
    expect(dex.querySelector(".dx-agent-run")).toBeNull();
    expect(dex.querySelector(".dx-dex-empty")).not.toBeNull();
    expect(dex.textContent).not.toContain("Write a launch memo");

    // And a message from the brief is the brief's, not a follow-up to Home's.
    await view.send(dex, "Shorten the brief");
    await untilRun(dex);
    const rows = await view.port.agent.list();
    const brief = rows.find((row) => row.title === "Shorten the brief")!;
    expect(brief.conversationId).not.toBe(home.conversationId);
    expect(brief.conversationId).toMatch(/^conv-/);
  });
});

describe("a named chat exists before it is spoken in", () => {
  const launch = PROTOTYPE_FOLDER_IDS.launch;

  /** Project ⋯ → New chat, named. */
  async function nameChat(view: Shell, name: string) {
    fireEvent.click(view.find(`#dx-sidebar [data-act=project-menu][data-id=${launch}]`)!);
    const item = [...document.querySelectorAll<HTMLElement>("[role=menuitem]")].find((entry) => entry.textContent === "New Chat")!;
    fireEvent.click(item);
    const dialog = document.querySelector<HTMLDialogElement>("dialog#dx-modal")!;
    fireEvent.change(dialog.querySelector("input[name=name]")!, { target: { value: name } });
    await act(async () => {
      fireEvent.submit(dialog.querySelector("form")!);
    });
    await waitFor(() => {
      if (!view.state().chat?.conversationId) throw new Error("the chat has no id");
    });
    return view.state().chat!.conversationId!;
  }

  const row = (view: Shell, id: string) =>
    view.find(`#dx-sidebar [data-act=open-chat][data-id="${id}"]`)?.closest(".dx-chat-tree") ?? null;

  it("has an id and a row the moment it is named", async () => {
    const view = await shell();
    const id = await nameChat(view, "Pricing questions");

    expect(id).toMatch(/^conv-/);
    expect(view.state().chat).toEqual({ folderId: launch, conversationId: id });
    expect(row(view, id)?.textContent).toContain("Pricing questions");
    expect(row(view, id)?.getAttribute("aria-selected")).toBe("true");
    // A real row: it can be managed like any other conversation.
    expect(row(view, id)?.querySelector("[data-act=chat-menu]")).not.toBeNull();
    expect(view.find("#dx-conversation .dx-conversation-title")?.textContent).toBe("Pricing questions");
  });

  it("is still there after Home and after another project", async () => {
    const view = await shell();
    const id = await nameChat(view, "Pricing questions");

    await view.dispatch({ type: "go", page: "home" });
    expect(view.state().chat).toBeNull();
    expect(row(view, id)?.textContent).toContain("Pricing questions");

    // Another project, created and looked at, then back.
    fireEvent.click(view.find("#dx-sidebar [data-act=new-project]")!);
    const dialog = document.querySelector<HTMLDialogElement>("dialog#dx-modal")!;
    fireEvent.change(dialog.querySelector("input[name=name]")!, { target: { value: "Other work" } });
    await act(async () => {
      fireEvent.submit(dialog.querySelector("form")!);
    });
    await waitFor(() => {
      if (!view.find("#dx-sidebar [aria-label='Other work']")) throw new Error("the new project is not in the tree");
    });
    expect(row(view, id)?.textContent).toContain("Pricing questions");

    await view.dispatch({ type: "open-chat", chat: { folderId: launch, conversationId: id } });
    expect(row(view, id)?.getAttribute("aria-selected")).toBe("true");
    expect(view.find("#dx-conversation .dx-conversation-title")?.textContent).toBe("Pricing questions");
  });

  it("survives a relaunch", async () => {
    const first = await shell();
    const id = await nameChat(first, "Pricing questions");
    cleanup();

    const second = await shell({ keepStorage: true });
    expect(row(second, id)?.textContent).toContain("Pricing questions");
  });

  it("sends its first message under its own id", async () => {
    const view = await shell();
    const id = await nameChat(view, "Pricing questions");

    await view.send(view.find("#dx-conversation")!, "What should the launch price be?");
    await waitFor(() => {
      if (!view.find("#dx-conversation .dx-agent-run")) throw new Error("the run has not reached the conversation");
    });

    const rows = await view.port.agent.list();
    const own = rows.find((entry) => entry.conversationId === id);
    expect(own).toBeDefined();
    expect(own?.folderId).toBe(launch);
    // One row, still under its name — not a second conversation beside an empty one.
    expect(view.all(`#dx-sidebar [data-act=open-chat][data-id="${id}"]`)).toHaveLength(1);
    expect(row(view, id)?.textContent).toContain("Pricing questions");
    expect(view.state().chat).toEqual({ folderId: launch, conversationId: id });
  });

  it("can be archived from its menu like any other conversation", async () => {
    const view = await shell();
    const id = await nameChat(view, "Pricing questions");

    fireEvent.click(row(view, id)!.querySelector("[data-act=chat-menu]")!);
    const archive = [...document.querySelectorAll<HTMLElement>("[role=menuitem]")].find((entry) => entry.textContent === "Archive")!;
    await act(async () => {
      fireEvent.click(archive);
    });
    expect(row(view, id)).toBeNull();
    expect(view.state().chat).toBeNull();
  });
});
