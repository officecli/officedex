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
import { PROTOTYPE_CHAT_IDS, PROTOTYPE_FOLDER_IDS, prototypeFiles, prototypeFolders, prototypeTasks } from "../port/fake/prototypeSeed";
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

/**
 * 1.0.12 §一: a chat is not named up front. A project's New chat puts Home's
 * composer on a draft chat in that project; the chat has an id and a row from
 * that moment, but only a sent message opens the conversation workspace.
 */
describe("a project's New chat starts on Home", () => {
  const launch = PROTOTYPE_FOLDER_IDS.launch;

  /** Project ⋯ → New Chat. No dialog: Home, with the project chosen. */
  async function startChat(view: Shell) {
    fireEvent.click(view.find(`#dx-sidebar [data-act=project-menu][data-id=${launch}]`)!);
    const item = [...document.querySelectorAll<HTMLElement>("[role=menuitem]")].find((entry) => entry.textContent === "New Chat")!;
    await act(async () => {
      fireEvent.click(item);
    });
    expect(document.querySelector("dialog#dx-modal[open]")).toBeNull();
    await waitFor(() => {
      if (!view.state().homeChat?.conversationId) throw new Error("Home has no draft chat");
    });
    return view.state().homeChat!.conversationId!;
  }

  const row = (view: Shell, id: string) =>
    view.find(`#dx-sidebar [data-act=open-chat][data-id="${id}"]`)?.closest(".dx-chat-tree") ?? null;
  const homeInput = (view: Shell) => view.find<HTMLTextAreaElement>(".dx-home-composer textarea[data-draft]")!;
  const picker = (view: Shell) => view.find(".dx-home-context-bar [data-act=home-project-picker]")!;

  it("has an id and a row at once, and lives on Home until it is sent", async () => {
    const view = await shell();
    const id = await startChat(view);

    expect(id).toMatch(/^conv-/);
    expect(view.state()).toMatchObject({ page: "home", chat: null, homeChat: { folderId: launch, conversationId: id } });
    expect(view.find("#dx-conversation .dx-pane-top")).toBeNull();
    expect(picker(view).textContent).toContain("MO product launch");
    expect(row(view, id)?.textContent).toContain("New chat");
    expect(row(view, id)?.getAttribute("aria-selected")).toBe("true");
    expect(row(view, id)?.querySelector("[data-act=chat-menu]")).not.toBeNull();
  });

  it("reuses an untouched draft, and never one that has words in it", async () => {
    const view = await shell();
    const first = await startChat(view);
    expect(await startChat(view)).toBe(first);

    fireEvent.change(homeInput(view), { target: { value: "Pricing questions for the launch" } });
    const second = await startChat(view);
    expect(second).not.toBe(first);
    // The one with words is still there, with its words.
    await act(async () => {
      fireEvent.click(view.find(`#dx-sidebar [data-act=open-chat][data-id="${first}"]`)!);
    });
    expect(view.state().homeChat?.conversationId).toBe(first);
    expect(homeInput(view).value).toBe("Pricing questions for the launch");
  });

  it("comes back with its project and words after Local", async () => {
    const view = await shell();
    const id = await startChat(view);
    fireEvent.change(homeInput(view), { target: { value: "Draft the FAQ" } });

    await view.dispatch({ type: "go", page: "local" });
    await act(async () => {
      fireEvent.click(view.find(`#dx-sidebar [data-act=open-chat][data-id="${id}"]`)!);
    });
    expect(view.state()).toMatchObject({ page: "home", homeChat: { folderId: launch, conversationId: id } });
    expect(homeInput(view).value).toBe("Draft the FAQ");
    expect(picker(view).textContent).toContain("MO product launch");
  });

  it("is not inherited by the global New chat", async () => {
    const view = await shell();
    const id = await startChat(view);
    fireEvent.change(homeInput(view), { target: { value: "Only for the launch" } });

    await view.dispatch({ type: "go", page: "home" });
    expect(view.state().homeChat).toBeNull();
    expect(picker(view).textContent).toContain("Choose project");
    expect(homeInput(view).value).toBe("");
    expect(row(view, id)).not.toBeNull();
  });

  it("survives a relaunch", async () => {
    const first = await shell();
    const id = await startChat(first);
    cleanup();

    const second = await shell({ keepStorage: true });
    expect(row(second, id)?.textContent).toContain("New chat");
  });

  it("sends its first message under its own id, and the message names it", async () => {
    const view = await shell();
    const id = await startChat(view);

    await view.send(view.find(".dx-home-composer")!, "What should the launch price be?");
    await waitFor(() => {
      if (!view.find("#dx-conversation .dx-agent-run")) throw new Error("the run has not reached the conversation");
    });

    expect(view.state().chat).toEqual({ folderId: launch, conversationId: id });
    expect(view.state().homeChat).toBeNull();
    const rows = await view.port.agent.list();
    const own = rows.find((entry) => entry.conversationId === id);
    expect(own?.folderId).toBe(launch);
    // One row, named from what was asked — not a second conversation beside an empty one.
    await waitFor(() => expect(row(view, id)?.textContent).toContain("What should the launch price be?"));
    expect(view.all(`#dx-sidebar [data-act=open-chat][data-id="${id}"]`)).toHaveLength(1);
  });

  it("keeps a name given with Rename", async () => {
    const view = await shell();
    const id = await startChat(view);
    fireEvent.click(row(view, id)!.querySelector("[data-act=chat-menu]")!);
    fireEvent.click([...document.querySelectorAll<HTMLElement>("[role=menuitem]")].find((entry) => entry.textContent === "Rename")!);
    const dialog = document.querySelector<HTMLDialogElement>("dialog#dx-modal")!;
    fireEvent.change(dialog.querySelector("input[name=name]")!, { target: { value: "Pricing" } });
    await act(async () => {
      fireEvent.submit(dialog.querySelector("form")!);
    });
    // A named draft is the user's: New chat makes another rather than reuse it.
    expect(await startChat(view)).not.toBe(id);

    await act(async () => {
      fireEvent.click(view.find(`#dx-sidebar [data-act=open-chat][data-id="${id}"]`)!);
    });
    await view.send(view.find(".dx-home-composer")!, "What should the launch price be?");
    await waitFor(() => {
      if (!view.find("#dx-conversation .dx-agent-run")) throw new Error("the run has not reached the conversation");
    });
    expect(row(view, id)?.textContent).toContain("Pricing");
    expect(row(view, id)?.textContent).not.toContain("launch price");
  });

  it("can be archived from its menu like any other conversation", async () => {
    const view = await shell();
    const id = await startChat(view);

    fireEvent.click(row(view, id)!.querySelector("[data-act=chat-menu]")!);
    const archive = [...document.querySelectorAll<HTMLElement>("[role=menuitem]")].find((entry) => entry.textContent === "Archive")!;
    await act(async () => {
      fireEvent.click(archive);
    });
    expect(row(view, id)).toBeNull();
  });

  it("is where a new project lands, with the project chosen", async () => {
    const view = await shell();
    fireEvent.click(view.find("#dx-sidebar [data-act=new-project]")!);
    const dialog = document.querySelector<HTMLDialogElement>("dialog#dx-modal")!;
    expect(dialog.querySelector("form")?.dataset.form).toBe("new-project");
    fireEvent.change(dialog.querySelector("input[name=name]")!, { target: { value: "Other work" } });
    await act(async () => {
      fireEvent.submit(dialog.querySelector("form")!);
    });
    await waitFor(() => {
      if (!view.state().homeChat) throw new Error("Home has no draft for the new project");
    });
    expect(view.state()).toMatchObject({ page: "home", chat: null });
    expect(picker(view).textContent).toContain("Other work");
  });
});

/**
 * 1.0.12 §一, §四: a chat with history opens beside the file it last showed —
 * not Assets — and never borrows another chat's or Local's file.
 */
describe("opening a chat that has history", () => {
  const openRow = async (view: Shell, id: string) => {
    await view.dispatch({ type: "reveal-folder", folderId: PROTOTYPE_FOLDER_IDS.launch });
    await act(async () => {
      fireEvent.click(view.find(`#dx-sidebar [data-act=open-chat][data-id="${id}"]`)!);
    });
  };

  it("comes back to the file it last showed", async () => {
    const view = await shell();
    await openRow(view, PROTOTYPE_CHAT_IDS.sales);
    await view.dispatch({ type: "open-file", fileId: "budget" });
    await view.dispatch({ type: "go", page: "local" });

    await openRow(view, PROTOTYPE_CHAT_IDS.sales);
    expect(view.state()).toMatchObject({ page: "editor", activeFileId: "budget" });
    expect(view.state().chat).toEqual({ folderId: PROTOTYPE_FOLDER_IDS.launch, conversationId: PROTOTYPE_CHAT_IDS.sales });
  });

  it("opens its own result the first time, not Assets", async () => {
    const view = await shell();
    await openRow(view, PROTOTYPE_CHAT_IDS.plan);
    expect(view.state()).toMatchObject({ page: "editor", activeFileId: "doc" });
  });

  it("does not take a file another chat or Local showed", async () => {
    const view = await shell();
    await view.dispatch({ type: "open-local-file", fileId: "brief" });
    await openRow(view, PROTOTYPE_CHAT_IDS.deck);
    expect(view.state().activeFileId).not.toBe("brief");
    expect(view.state().activeFileId).toBe("slides");
  });

  it("shows an empty editor area when it has nothing to show", async () => {
    const view = await shell({ files: prototypeFiles().filter((file) => file.originConversationId !== PROTOTYPE_CHAT_IDS.deck) });
    await openRow(view, PROTOTYPE_CHAT_IDS.deck);
    expect(view.state()).toMatchObject({ page: "editor", activeFileId: null });
    expect(view.find("[data-view=chat-empty]")).not.toBeNull();
    expect(view.find("[data-view=chat-empty] [data-act=show-assets]")).not.toBeNull();
  });
});
