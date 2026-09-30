/**
 * The window's own furniture — OD-UI-1.2 §03, §07, §10, §17, §18.
 *
 * The sidebar, the top-left band, the document tabs, the divider and the
 * shortcuts. What they have in common is that none of them is about a document's
 * content: they are how the user moves between things, so what is asserted here
 * is where a gesture lands, not what it draws.
 *
 * The one rule worth naming is §18: a tab remembers how it was opened. Bringing
 * a Local tab forward leaves the conversation, because that tab was never part
 * of it — the alternative is a Local file silently joining whatever chat happens
 * to be beside it.
 */
import { act, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { resetLayers } from "../kit/layers";
import {
  PROTOTYPE_CHAT_IDS,
  PROTOTYPE_FOLDER_IDS,
  prototypeFiles,
  prototypeFolders,
  prototypeTasks,
} from "../port/fake/prototypeSeed";
import { CHAT_DEFAULT_WIDTH, CHAT_MAX_WIDTH, CHAT_MIN_WIDTH } from "../state/shellReducer";
import { renderShell } from "../test/renderShell";
import type { FileMeta } from "../../shared/uiPort";

afterEach(() => {
  resetLayers();
  cleanup();
});

/** The prototype's workspace, with the projects' conversations loaded. */
async function shell(files: FileMeta[] = prototypeFiles()) {
  const harness = await renderShell({
    folders: prototypeFolders(),
    files,
    tasks: prototypeTasks().reverse(),
  });
  const find = <T extends HTMLElement>(selector: string) => harness.view.container.querySelector<T>(selector);
  const all = (selector: string) => [...harness.view.container.querySelectorAll<HTMLElement>(selector)];
  await waitFor(() => {
    if (!find("#dx-sidebar [data-act=toggle-project]")) throw new Error("the project tree is still loading");
  });
  return { ...harness, find, all };
}

type Shell = Awaited<ReturnType<typeof shell>>;

const openLaunchChat = async (view: Shell) => {
  await view.dispatch({
    type: "open-chat",
    chat: { folderId: PROTOTYPE_FOLDER_IDS.launch, conversationId: PROTOTYPE_CHAT_IDS.plan },
  });
};

describe("the sidebar's project tree", () => {
  it("lists the projects closed, with no files in the tree", async () => {
    const view = await shell();
    const projects = view.all("#dx-sidebar [data-act=toggle-project]");

    expect(projects.map((row) => row.dataset.id)).toEqual([PROTOTYPE_FOLDER_IDS.launch, PROTOTYPE_FOLDER_IDS.quarter]);
    expect(projects.every((row) => row.getAttribute("aria-expanded") === "false")).toBe(true);
    expect(view.all("#dx-sidebar [data-act=open-chat]")).toHaveLength(0);
    // Files live in Local, Home's Recent or a project's Assets — never here.
    expect(view.find("#dx-sidebar")?.textContent).not.toContain("MO launch plan.docx");
  });

  it("opens and closes a project", async () => {
    const view = await shell();
    const toggle = () => view.find("#dx-sidebar [data-act=toggle-project][data-id=launch]")!;

    fireEvent.click(toggle());
    expect(toggle().getAttribute("aria-expanded")).toBe("true");
    expect(view.all("#dx-sidebar [data-act=open-chat] .dx-ellipsis").map((row) => row.textContent)).toEqual([
      "Launch plan & copy",
      "Sales forecast review",
      "Launch presentation",
    ]);

    fireEvent.click(toggle());
    expect(toggle().getAttribute("aria-expanded")).toBe("false");
    expect(view.all("#dx-sidebar [data-act=open-chat]")).toHaveLength(0);
  });

  // The port shows one conversation per folder, so it has to be told which
  // before the second column can show it.
  it("tells the port which conversation, then shows it", async () => {
    const view = await shell();
    const openConversation = vi.spyOn(view.port.agent, "openConversation");

    fireEvent.click(view.find("#dx-sidebar [data-act=toggle-project][data-id=launch]")!);
    fireEvent.click(view.find("#dx-sidebar [data-act=open-chat][data-id=plan]")!);

    await waitFor(() => {
      if (!view.state().chat) throw new Error("no conversation open");
    });
    expect(openConversation).toHaveBeenCalledWith(PROTOTYPE_FOLDER_IDS.launch, PROTOTYPE_CHAT_IDS.plan);
    expect(view.find("#dx-conversation .dx-conversation-title")?.textContent).toBe("Launch plan & copy");
    expect(view.find("#dx-sidebar [data-act=open-chat][data-id=plan]")?.closest(".dx-chat-tree")?.getAttribute("aria-selected")).toBe("true");
  });

  /*
   * A chat that has been started but not spoken in has no conversation id yet —
   * the runtime names a conversation after its first run. It still has a row,
   * under the project it belongs to, so it is not invisible while it is empty.
   */
  it("shows a chat that has not been spoken in yet", async () => {
    const view = await shell();
    await view.dispatch({
      type: "open-chat",
      chat: { folderId: PROTOTYPE_FOLDER_IDS.launch, conversationId: null },
      name: "Pricing questions",
    });

    const rows = view.all("#dx-sidebar .dx-chat-tree");
    expect(rows[0].textContent).toContain("Pricing questions");
    expect(rows[0].getAttribute("aria-selected")).toBe("true");
    // Nothing to manage yet, so no menu button on that row.
    expect(rows[0].querySelector("[data-act=chat-menu]")).toBeNull();
  });

  it("falls back to a name for an unnamed new chat", async () => {
    const view = await shell();
    await view.dispatch({
      type: "open-chat",
      chat: { folderId: PROTOTYPE_FOLDER_IDS.launch, conversationId: null },
    });
    expect(view.all("#dx-sidebar .dx-chat-tree")[0].textContent).toContain("New chat");
  });
});

describe("the top-left band", () => {
  it("hides and shows the sidebar, and says which it is doing", async () => {
    const view = await shell();
    const toggle = () => view.find("#dx-global-controls [data-act=toggle-sidebar]")!;

    expect(toggle().getAttribute("aria-expanded")).toBe("true");
    expect(toggle().getAttribute("aria-label")).toBe("Hide sidebar");

    fireEvent.click(toggle());
    expect(view.state().navCollapsed).toBe(true);
    expect(toggle().getAttribute("aria-expanded")).toBe("false");
    expect(toggle().getAttribute("aria-label")).toBe("Show sidebar");
    expect(view.find("#dx-workspace")?.className).toContain("dx-compact");
    // Hidden means out of the tab order as well as out of sight.
    expect(view.find("#dx-sidebar")?.hasAttribute("inert")).toBe(true);

    fireEvent.click(toggle());
    expect(view.state().navCollapsed).toBe(false);
    expect(view.find("#dx-sidebar")?.hasAttribute("inert")).toBe(false);
  });

  // The Logo tab is a permanent page tab, not a document tab: it does not close,
  // and it stays where it is when the sidebar goes.
  it("keeps a Home tab that always goes Home", async () => {
    const view = await shell();
    const home = () => view.find("#dx-global-controls [data-act=home]")!;

    expect(home().getAttribute("aria-current")).toBe("page");
    expect(home().getAttribute("aria-label")).toBe("OfficeDex Home");
    expect(home().dataset.tooltip).toBe("Home");

    await view.dispatch({ type: "go", page: "local" });
    expect(home().getAttribute("aria-current")).toBe("false");

    fireEvent.click(home());
    expect(view.state().page).toBe("home");
    expect(home().getAttribute("aria-current")).toBe("page");

    // And it is still there with the sidebar hidden.
    fireEvent.click(view.find("#dx-global-controls [data-act=toggle-sidebar]")!);
    expect(view.find("#dx-global-controls [data-act=home]")).not.toBeNull();
  });

  it("leaves a conversation when it goes Home", async () => {
    const view = await shell();
    await openLaunchChat(view);
    fireEvent.click(view.find("#dx-global-controls [data-act=home]")!);

    expect(view.state().chat).toBeNull();
    expect(view.state().page).toBe("home");
  });
});

describe("the document tabs", () => {
  const tab = (view: Shell, fileId: string) => view.find(`[data-tab="${fileId}"]`);

  it("marks a Local tab and a Chat tab differently", async () => {
    const view = await shell();
    await view.dispatch({ type: "open-local-file", fileId: "brief" });
    expect(tab(view, "brief")?.dataset.context).toBe("local");
    expect(tab(view, "brief")?.querySelector(".dx-tab-dex-watermark")).toBeNull();

    await openLaunchChat(view);
    await view.dispatch({ type: "open-file", fileId: "doc" });
    expect(tab(view, "doc")?.dataset.context).toBe("chat");
    // The watermark is what says a tab belongs to a conversation.
    expect(tab(view, "doc")?.querySelector(".dx-tab-dex-watermark")).not.toBeNull();
    expect(tab(view, "brief")?.dataset.context).toBe("local");
  });

  // §18: a tab remembers how it was opened, and activating it restores that.
  it("leaves the conversation when a Local tab is brought forward", async () => {
    const view = await shell();
    await view.dispatch({ type: "open-local-file", fileId: "brief" });
    await openLaunchChat(view);
    await view.dispatch({ type: "open-file", fileId: "doc" });
    expect(view.state().chat).not.toBeNull();

    fireEvent.click(tab(view, "brief")!.querySelector<HTMLElement>(".dx-tab-title")!);

    expect(view.state().activeFileId).toBe("brief");
    expect(view.state().chat).toBeNull();
    // And it did not quietly become a Chat tab on the way.
    expect(tab(view, "brief")?.dataset.context).toBe("local");
  });

  it("returns to the conversation when its own tab is brought forward", async () => {
    const view = await shell();
    await openLaunchChat(view);
    await view.dispatch({ type: "open-file", fileId: "doc" });
    await view.dispatch({ type: "open-local-file", fileId: "brief" });
    expect(view.state().chat).toBeNull();

    fireEvent.click(tab(view, "doc")!.querySelector<HTMLElement>(".dx-tab-title")!);
    expect(view.state().chat).toEqual({
      folderId: PROTOTYPE_FOLDER_IDS.launch,
      conversationId: PROTOTYPE_CHAT_IDS.plan,
    });
  });

  it("closes a tab from its own close button", async () => {
    const view = await shell();
    await view.dispatch({ type: "open-local-file", fileId: "brief" });
    await view.dispatch({ type: "open-local-file", fileId: "doc" });

    fireEvent.click(view.find("[data-act=close-file][data-id=brief]")!);

    expect(tab(view, "brief")).toBeNull();
    expect(tab(view, "doc")).not.toBeNull();
    expect(view.state().openFileIds).toEqual(["doc"]);
  });

  /*
   * A finished run does not take the screen: its result becomes a tab with the
   * unread dot, and opening the file is what clears it.
   */
  it("marks a tab a run added as unread, until it is opened", async () => {
    const view = await shell();
    await view.dispatch({ type: "open-local-file", fileId: "brief" });
    await view.dispatch({ type: "add-tab", fileId: "slides", chat: null, unread: true });

    expect(tab(view, "slides")?.querySelector(".dx-dot")).not.toBeNull();
    // Added, not activated: the document being read is still the one on screen.
    expect(view.state().activeFileId).toBe("brief");
    expect(tab(view, "slides")?.className).not.toContain("dx-active");

    fireEvent.click(tab(view, "slides")!.querySelector<HTMLElement>(".dx-tab-title")!);
    expect(tab(view, "slides")?.querySelector(".dx-dot")).toBeNull();
  });

  it("adds no dot for a tab that was not flagged", async () => {
    const view = await shell();
    await view.dispatch({ type: "open-local-file", fileId: "brief" });
    await view.dispatch({ type: "add-tab", fileId: "slides", chat: null });

    expect(tab(view, "slides")).not.toBeNull();
    expect(tab(view, "slides")?.querySelector(".dx-dot")).toBeNull();
  });

  it("says whether the document on screen is saved", async () => {
    const dirty = prototypeFiles().map((file) => (file.id === "sheet" ? { ...file, dirty: true } : file));
    const view = await shell(dirty);

    await view.dispatch({ type: "open-local-file", fileId: "brief" });
    expect(view.find(".dx-source-saved")?.textContent).toBe("Saved");

    await view.dispatch({ type: "open-local-file", fileId: "sheet" });
    expect(view.find(".dx-source-saved")?.textContent).toBe("Unsaved");
    // The tab itself carries the same news, for a file that is not on screen.
    expect(tab(view, "sheet")?.querySelector(".dx-dirty-mark")).not.toBeNull();
  });
});

describe("the divider between the columns", () => {
  /** jsdom has neither PointerEvent nor pointer capture; a drag needs both. */
  function capturable(element: HTMLElement) {
    Object.assign(element, { setPointerCapture: () => {}, releasePointerCapture: () => {} });
  }
  const pointer = (type: string, clientX: number) => {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX, button: 0 });
    Object.defineProperty(event, "pointerId", { value: 1 });
    return event;
  };

  const openSplitter = async () => {
    const view = await shell();
    await openLaunchChat(view);
    const handle = view.find(".dx-resize-handle")!;
    return { view, handle, width: () => view.state().chatWidth };
  };

  it("steps the conversation's width with the arrow keys", async () => {
    const { view, handle, width } = await openSplitter();
    expect(width()).toBe(CHAT_DEFAULT_WIDTH);
    expect(handle.getAttribute("aria-valuenow")).toBe(String(CHAT_DEFAULT_WIDTH));

    fireEvent.keyDown(handle, { key: "ArrowRight" });
    expect(width()).toBe(CHAT_DEFAULT_WIDTH + 16);

    fireEvent.keyDown(handle, { key: "ArrowLeft" });
    fireEvent.keyDown(handle, { key: "ArrowLeft" });
    expect(width()).toBe(CHAT_DEFAULT_WIDTH - 16);
    expect(view.find(".dx-resize-handle")?.getAttribute("aria-valuenow")).toBe(String(CHAT_DEFAULT_WIDTH - 16));
  });

  it("goes to the limits with Home and End, and stays inside them", async () => {
    const { handle, width } = await openSplitter();

    fireEvent.keyDown(handle, { key: "Home" });
    expect(width()).toBe(CHAT_MIN_WIDTH);
    // Already at the minimum: a further step changes nothing.
    fireEvent.keyDown(handle, { key: "ArrowLeft" });
    expect(width()).toBe(CHAT_MIN_WIDTH);

    fireEvent.keyDown(handle, { key: "End" });
    expect(width()).toBe(CHAT_MAX_WIDTH);
    fireEvent.keyDown(handle, { key: "ArrowRight" });
    expect(width()).toBe(CHAT_MAX_WIDTH);
  });

  it("puts the width back when a drag is abandoned with Escape", async () => {
    const { handle, width } = await openSplitter();
    capturable(handle);

    act(() => {
      handle.dispatchEvent(pointer("pointerdown", 400));
    });
    act(() => {
      handle.dispatchEvent(pointer("pointermove", 460));
    });
    expect(width()).toBe(CHAT_DEFAULT_WIDTH + 60);

    fireEvent.keyDown(handle, { key: "Escape" });
    expect(width()).toBe(CHAT_DEFAULT_WIDTH);
  });

  it("swaps which side the conversation is on", async () => {
    const { view } = await openSplitter();
    expect(view.state().chatPosition).toBe("left");
    expect(view.find("#dx-workspace")?.className).not.toContain("dx-chat-right");

    fireEvent.click(view.find("[data-act=swap]")!);
    expect(view.state().chatPosition).toBe("right");
    expect(view.find("#dx-workspace")?.className).toContain("dx-chat-right");

    fireEvent.click(view.find("[data-act=swap]")!);
    expect(view.state().chatPosition).toBe("left");
  });
});

describe("the workspace switch", () => {
  // It appears once there is work beside the conversation, and only then.
  it("is absent with no conversation, and with a conversation that has nothing beside it", async () => {
    const view = await shell();
    expect(view.find("#dx-workspace-toggle")).toBeNull();

    await openLaunchChat(view);
    expect(view.find("#dx-workspace-toggle")).toBeNull();
  });

  it("appears once a document is open beside the conversation, and closes the content region", async () => {
    const view = await shell();
    await openLaunchChat(view);
    await view.dispatch({ type: "open-file", fileId: "doc" });

    const toggle = () => view.find("#dx-workspace-toggle")!;
    expect(toggle().getAttribute("aria-pressed")).toBe("true");
    expect(toggle().getAttribute("aria-label")).toBe("Close workspace");

    fireEvent.click(toggle());
    expect(view.state().workspaceOpen).toBe(false);
    expect(view.find("#dx-workspace")?.className).toContain("dx-workspace-closed");
    expect(view.find("#dx-content")?.hasAttribute("inert")).toBe(true);

    fireEvent.click(toggle());
    expect(view.state().workspaceOpen).toBe(true);
    expect(view.find("#dx-content")?.hasAttribute("inert")).toBe(false);
  });
});

describe("the keyboard shortcuts", () => {
  const chord = (key: string) => fireEvent.keyDown(window, { key, metaKey: true });

  it("⌘O opens a file from the system picker, as Local", async () => {
    const view = await shell();
    await openLaunchChat(view);

    chord("o");
    await waitFor(() => {
      if (view.state().page !== "editor") throw new Error(`still on ${view.state().page}`);
    });
    // Opened from outside any project, so it brings no conversation with it.
    expect(view.state().chat).toBeNull();
    expect(view.find(".dx-tabs-strip")?.textContent).toContain("From this computer 1");
  });

  it("⌘N opens the New picker", async () => {
    const view = await shell();
    chord("n");
    expect(view.find("#dx-new-popover")).not.toBeNull();
  });

  it("⌘, opens Settings", async () => {
    const view = await shell();
    chord(",");
    expect(view.state().page).toBe("settings");
  });

  it("⌘S saves the document on screen", async () => {
    const view = await shell();
    await view.dispatch({ type: "open-local-file", fileId: "brief" });
    const save = vi.spyOn(view.port.files, "save");

    chord("s");
    await waitFor(() => {
      if (save.mock.calls.length === 0) throw new Error("the port was not asked to save");
    });
    expect(save).toHaveBeenCalledWith("brief");
  });

  // With nothing on screen ⌘S is not the shell's to take; it keeps its usual
  // meaning for whatever has focus.
  it("⌘S is left alone with no document on screen", async () => {
    const view = await shell();
    const save = vi.spyOn(view.port.files, "save");

    chord("s");
    await act(async () => {
      await Promise.resolve();
    });
    expect(save).not.toHaveBeenCalled();
  });
});
