import { describe, expect, it } from "vitest";

import type { FileMeta } from "../../shared/uiPort";
import {
  CHAT_DEFAULT_WIDTH,
  CHAT_MAX_WIDTH,
  CHAT_MIN_WIDTH,
  hydrateShellState,
  initialShellState,
  sameChat,
  shellReducer,
  showsEditor,
  showsTabStrip,
  tabIsChat,
  toPersisted,
  workspaceClosed,
  type ChatRef,
  type ShellAction,
  type ShellState,
} from "./shellReducer";

const run = (state: ShellState, ...actions: ShellAction[]) => actions.reduce(shellReducer, state);

const PLAN: ChatRef = { folderId: "launch", conversationId: "plan" };
const SALES: ChatRef = { folderId: "launch", conversationId: "sales" };
const NEW_CHAT: ChatRef = { folderId: "launch", conversationId: null };

const file = (id: string): FileMeta => ({
  id,
  name: `${id}.docx`,
  type: "doc",
  folderId: "launch",
  createdAt: 0,
  updatedAt: 0,
  lastOpenedAt: null,
  dirty: false,
  pinned: false,
});

describe("launch", () => {
  it("lands on Home with the sidebar showing, no conversation and no tabs (§02)", () => {
    expect(initialShellState).toMatchObject({
      page: "home",
      chat: null,
      navCollapsed: false,
      openFileIds: [],
      activeFileId: null,
      chatWidth: CHAT_DEFAULT_WIDTH,
      chatPosition: "left",
    });
  });
});

describe("opening a conversation (§16)", () => {
  it("shows the chat beside the project's Assets and opens no file", () => {
    const state = run(initialShellState, { type: "open-chat", chat: PLAN });
    expect(state).toMatchObject({ page: "assets", chat: PLAN, panel: "chat", workspaceOpen: true, activeFileId: null });
    expect(state.openFileIds).toEqual([]);
    expect(state.expandedFolderIds).toContain("launch");
  });

  it("does not touch the sidebar", () => {
    const hidden = run(initialShellState, { type: "toggle-nav" }, { type: "open-chat", chat: PLAN });
    expect(hidden.navCollapsed).toBe(true);
    const shown = run(initialShellState, { type: "open-chat", chat: PLAN });
    expect(shown.navCollapsed).toBe(false);
  });

  it("keeps the name of a chat that has not been spoken in, until a run names it", () => {
    const pending = run(initialShellState, { type: "open-chat", chat: NEW_CHAT, name: "  Launch copy  " });
    expect(pending.pendingChatName).toBe("Launch copy");

    const adopted = run(pending, { type: "adopt-conversation", folderId: "launch", conversationId: "c-1" });
    expect(adopted.chat).toEqual({ folderId: "launch", conversationId: "c-1" });
    expect(adopted.pendingChatName).toBeNull();
  });

  it("hands tabs opened in a new chat to the conversation it becomes", () => {
    const state = run(
      initialShellState,
      { type: "open-chat", chat: NEW_CHAT },
      { type: "open-file", fileId: "a" },
      { type: "adopt-conversation", folderId: "launch", conversationId: "c-1" },
    );
    expect(state.tabContexts.a).toEqual({ folderId: "launch", conversationId: "c-1" });
  });

  it("ignores an adoption meant for another project, or for a chat that already has an id", () => {
    const pending = run(initialShellState, { type: "open-chat", chat: NEW_CHAT });
    expect(run(pending, { type: "adopt-conversation", folderId: "other", conversationId: "x" })).toBe(pending);
    const named = run(initialShellState, { type: "open-chat", chat: PLAN });
    expect(run(named, { type: "adopt-conversation", folderId: "launch", conversationId: "x" })).toBe(named);
  });
});

describe("going somewhere else", () => {
  it("leaves the conversation and keeps the tabs", () => {
    const state = run(
      initialShellState,
      { type: "open-chat", chat: PLAN },
      { type: "open-file", fileId: "a" },
      { type: "go", page: "local" },
    );
    expect(state).toMatchObject({ page: "local", chat: null, activeFileId: null, workspaceOpen: false });
    expect(state.openFileIds).toEqual(["a"]);
  });

  it("opens Settings at the section asked for, or the last one", () => {
    const account = run(initialShellState, { type: "go", page: "settings", section: "account" });
    expect(account.settingsSection).toBe("account");
    const again = run(account, { type: "go", page: "home" }, { type: "go", page: "settings" });
    expect(again.settingsSection).toBe("account");
  });
});

describe("tabs remember how they were opened (§18)", () => {
  const twoContexts = run(
    initialShellState,
    { type: "open-local-file", fileId: "local" },
    { type: "open-chat", chat: PLAN },
    { type: "open-file", fileId: "chat" },
  );

  it("records the conversation a file was opened from, and null for Local", () => {
    expect(twoContexts.tabContexts).toEqual({ local: null, chat: PLAN });
    expect(tabIsChat(twoContexts, "chat")).toBe(true);
    expect(tabIsChat(twoContexts, "local")).toBe(false);
  });

  it("restores Local when a Local tab is activated beside a conversation", () => {
    const state = run(twoContexts, { type: "activate-file", fileId: "local" });
    expect(state).toMatchObject({ page: "editor", activeFileId: "local", chat: null, workspaceOpen: false });
  });

  it("restores the conversation when a Chat tab is activated from Local", () => {
    const state = run(twoContexts, { type: "activate-file", fileId: "local" }, { type: "activate-file", fileId: "chat" });
    expect(state).toMatchObject({ page: "editor", activeFileId: "chat", chat: PLAN, workspaceOpen: true });
  });

  it("moves between two conversations of one project", () => {
    const state = run(
      twoContexts,
      { type: "open-chat", chat: SALES },
      { type: "open-file", fileId: "forecast" },
      { type: "activate-file", fileId: "chat" },
    );
    expect(state.chat).toEqual(PLAN);
    expect(state.tabContexts.forecast).toEqual(SALES);
  });

  it("re-files a tab under the context it is opened from again", () => {
    const state = run(twoContexts, { type: "open-file", fileId: "local" });
    expect(state.tabContexts.local).toEqual(PLAN);
  });

  it("opening Local from a conversation leaves the conversation", () => {
    const state = run(initialShellState, { type: "open-chat", chat: PLAN }, { type: "open-local-file", fileId: "a" });
    expect(state).toMatchObject({ chat: null, page: "editor", activeFileId: "a" });
    expect(state.tabContexts.a).toBeNull();
  });

  it("does nothing for a file that has no tab", () => {
    expect(run(twoContexts, { type: "activate-file", fileId: "missing" })).toBe(twoContexts);
  });
});

describe("closing a tab", () => {
  it("activates the last remaining tab, in that tab's context", () => {
    const state = run(
      initialShellState,
      { type: "open-local-file", fileId: "local" },
      { type: "open-chat", chat: PLAN },
      { type: "open-file", fileId: "chat" },
      { type: "close-file", fileId: "chat" },
    );
    expect(state).toMatchObject({ activeFileId: "local", chat: null, page: "editor" });
    expect(state.tabContexts).toEqual({ local: null });
  });

  it("returns to Assets from a conversation, and Home from Local, when nothing is left", () => {
    const chat = run(
      initialShellState,
      { type: "open-chat", chat: PLAN },
      { type: "open-file", fileId: "a" },
      { type: "close-file", fileId: "a" },
    );
    expect(chat).toMatchObject({ page: "assets", chat: PLAN, activeFileId: null });

    const local = run(initialShellState, { type: "open-local-file", fileId: "a" }, { type: "close-file", fileId: "a" });
    expect(local).toMatchObject({ page: "home", chat: null, activeFileId: null });
  });

  it("leaves the screen alone when a background tab closes", () => {
    const state = run(
      initialShellState,
      { type: "open-local-file", fileId: "a" },
      { type: "open-local-file", fileId: "b" },
      { type: "close-file", fileId: "a" },
    );
    expect(state).toMatchObject({ activeFileId: "b", page: "editor" });
    expect(state.openFileIds).toEqual(["b"]);
  });

  it("reopens the most recently closed tab first", () => {
    const state = run(
      initialShellState,
      { type: "open-local-file", fileId: "a" },
      { type: "open-local-file", fileId: "b" },
      { type: "close-file", fileId: "a" },
      { type: "close-file", fileId: "b" },
      { type: "reopen-tab" },
    );
    expect(state.activeFileId).toBe("b");
    expect(state.closedFileIds).toEqual(["a"]);
    expect(run(initialShellState, { type: "reopen-tab" })).toBe(initialShellState);
  });

  it("reorders within the strip and clamps the index", () => {
    const three = run(
      initialShellState,
      { type: "open-local-file", fileId: "a" },
      { type: "open-local-file", fileId: "b" },
      { type: "open-local-file", fileId: "c" },
    );
    expect(run(three, { type: "move-tab", fileId: "a", toIndex: 99 }).openFileIds).toEqual(["b", "c", "a"]);
    expect(run(three, { type: "move-tab", fileId: "c", toIndex: -4 }).openFileIds).toEqual(["c", "a", "b"]);
    expect(run(three, { type: "move-tab", fileId: "x", toIndex: 0 })).toBe(three);
  });
});

describe("a finished run's result (§10)", () => {
  it("adds a tab without taking the screen, and marks it unread", () => {
    const before = run(initialShellState, { type: "open-chat", chat: PLAN }, { type: "open-file", fileId: "a" });
    const state = run(before, { type: "add-tab", fileId: "result", chat: PLAN, unread: true });
    expect(state.activeFileId).toBe("a");
    expect(state.openFileIds).toEqual(["a", "result"]);
    expect(state.unreadFileIds).toEqual(["result"]);
    expect(state.tabContexts.result).toEqual(PLAN);
  });

  it("clears unread when the file is opened or its tab is activated", () => {
    const unread = run(initialShellState, { type: "add-tab", fileId: "result", chat: null, unread: true });
    expect(run(unread, { type: "activate-file", fileId: "result" }).unreadFileIds).toEqual([]);
    expect(run(unread, { type: "open-file", fileId: "result" }).unreadFileIds).toEqual([]);
    expect(run(unread, { type: "open-local-file", fileId: "other" }).unreadFileIds).toEqual(["result"]);
  });

  it("never marks the file on screen as unread", () => {
    const watching = run(initialShellState, { type: "open-local-file", fileId: "a" });
    expect(run(watching, { type: "mark-unread", fileId: "a" })).toBe(watching);
    expect(run(watching, { type: "add-tab", fileId: "a", chat: null, unread: true })).toBe(watching);
    expect(run(watching, { type: "mark-unread", fileId: "b" }).unreadFileIds).toEqual(["b"]);
  });
});

describe("the conversation column (§03)", () => {
  const chat = run(initialShellState, { type: "open-chat", chat: PLAN });

  it("clamps its width to 320–520", () => {
    expect(run(chat, { type: "set-chat-width", width: 10 }).chatWidth).toBe(CHAT_MIN_WIDTH);
    expect(run(chat, { type: "set-chat-width", width: 9000 }).chatWidth).toBe(CHAT_MAX_WIDTH);
    expect(run(chat, { type: "set-chat-width", width: 401.6 }).chatWidth).toBe(402);
  });

  it("swaps sides and back", () => {
    expect(run(chat, { type: "swap-chat" }).chatPosition).toBe("right");
    expect(run(chat, { type: "swap-chat" }, { type: "swap-chat" }).chatPosition).toBe("left");
  });

  it("closes the content region, which leaves the conversation filling the window", () => {
    const closed = run(chat, { type: "toggle-workspace" });
    expect(workspaceClosed(closed)).toBe(true);
    expect(workspaceClosed(run(closed, { type: "toggle-workspace" }))).toBe(false);
  });

  it("re-docks a floating conversation when the content region closes", () => {
    const state = run(chat, { type: "toggle-chat-display" }, { type: "toggle-workspace" });
    expect(state).toMatchObject({ chatFloating: false, workspaceOpen: false });
  });

  it("floating opens the content region it floats over", () => {
    const state = run(chat, { type: "toggle-workspace" }, { type: "toggle-chat-display" });
    expect(state).toMatchObject({ chatFloating: true, workspaceOpen: true, page: "assets" });
  });

  it("keeps the document on screen when it floats over one", () => {
    const state = run(chat, { type: "open-file", fileId: "a" }, { type: "toggle-chat-display" });
    expect(state).toMatchObject({ chatFloating: true, page: "editor", activeFileId: "a" });
  });

  it("shows the compact Assets list in place of the conversation, and only beside one", () => {
    expect(run(chat, { type: "set-panel", panel: "assets" }).panel).toBe("assets");
    expect(run(initialShellState, { type: "set-panel", panel: "assets" })).toBe(initialShellState);
  });

  it("has nothing to toggle without a conversation", () => {
    expect(run(initialShellState, { type: "toggle-workspace" })).toBe(initialShellState);
    expect(run(initialShellState, { type: "toggle-chat-display" })).toBe(initialShellState);
  });
});

describe("the sidebar (§16)", () => {
  it("moves only when the user moves it", () => {
    const navigation: ShellAction[] = [
      { type: "open-chat", chat: PLAN },
      { type: "open-file", fileId: "a" },
      { type: "open-local-file", fileId: "b" },
      { type: "activate-file", fileId: "a" },
      { type: "toggle-workspace" },
      { type: "close-file", fileId: "a" },
      { type: "go", page: "settings" },
      { type: "go", page: "home" },
    ];
    for (const collapsed of [false, true]) {
      let state: ShellState = { ...initialShellState, navCollapsed: collapsed };
      for (const action of navigation) {
        state = shellReducer(state, action);
        expect(state.navCollapsed, action.type).toBe(collapsed);
      }
    }
  });

  it("opens and closes a project in the tree", () => {
    const open = run(initialShellState, { type: "toggle-folder", folderId: "launch" });
    expect(open.expandedFolderIds).toEqual(["launch"]);
    expect(run(open, { type: "toggle-folder", folderId: "launch" }).expandedFolderIds).toEqual([]);
    expect(run(open, { type: "reveal-folder", folderId: "launch" })).toBe(open);
  });
});

describe("what the content region shows", () => {
  it("has a tab strip everywhere but Home, Local and Settings", () => {
    const at = (page: ShellState["page"]) => showsTabStrip({ ...initialShellState, page });
    expect(["home", "local", "settings"].map((page) => at(page as ShellState["page"]))).toEqual([false, false, false]);
    expect(["projects", "assets", "editor", "image"].map((page) => at(page as ShellState["page"]))).toEqual([
      true,
      true,
      true,
      true,
    ]);
  });

  it("shows the canvas for a file, a stage or the recording", () => {
    expect(showsEditor(run(initialShellState, { type: "open-local-file", fileId: "a" }))).toBe(true);
    expect(showsEditor(run(initialShellState, { type: "enter-stage" }))).toBe(true);
    expect(showsEditor(run(initialShellState, { type: "enter-stage", demo: true }))).toBe(true);
    expect(showsEditor(initialShellState)).toBe(false);
  });
});

describe("a run's stage", () => {
  it("puts the canvas on screen with no file selected", () => {
    const state = run(
      initialShellState,
      { type: "open-chat", chat: PLAN },
      { type: "open-file", fileId: "a" },
      { type: "enter-stage" },
    );
    expect(state).toMatchObject({ page: "editor", stage: true, demo: false, activeFileId: null, workspaceOpen: true });
    expect(state.openFileIds).toEqual(["a"]);
  });

  it("is left behind by opening a file", () => {
    const state = run(initialShellState, { type: "enter-stage" }, { type: "open-local-file", fileId: "a" });
    expect(state).toMatchObject({ stage: false, activeFileId: "a" });
  });

  it("stamps each request for the recording later than the last", () => {
    const first = run(initialShellState, { type: "enter-stage", demo: true });
    const second = run(first, { type: "enter-stage", demo: true });
    expect(Date.parse(second.demoStartedAt!)).toBeGreaterThan(Date.parse(first.demoStartedAt!));
    const left = run(second, { type: "leave-demo" });
    expect(left).toMatchObject({ demo: false, demoStartedAt: null });
    expect(run(left, { type: "leave-demo" })).toBe(left);
  });
});

describe("files that disappear", () => {
  const open = run(
    initialShellState,
    { type: "open-chat", chat: PLAN },
    { type: "open-file", fileId: "a" },
    { type: "open-file", fileId: "b" },
    { type: "add-tab", fileId: "c", chat: PLAN, unread: true },
  );

  it("drops their tabs, contexts and unread marks", () => {
    const state = run(open, { type: "prune-files", files: [file("a")] });
    expect(state.openFileIds).toEqual(["a"]);
    expect(state.tabContexts).toEqual({ a: PLAN });
    expect(state.unreadFileIds).toEqual([]);
    expect(state.activeFileId).toBe("a");
  });

  it("falls back to Assets when nothing is left to show", () => {
    const state = run(open, { type: "prune-files", files: [] });
    expect(state).toMatchObject({ page: "assets", activeFileId: null, openFileIds: [] });
  });

  it("returns the same state when nothing was lost", () => {
    expect(run(open, { type: "prune-files", files: [file("a"), file("b"), file("c")] })).toBe(open);
  });
});

describe("preferences", () => {
  it("creates the gift button the first time the features are closed, for good (§21)", () => {
    const closed = run(initialShellState, { type: "set-features", visible: false });
    expect(closed).toMatchObject({ featuresVisible: false, featuresDocked: true });
    expect(run(closed, { type: "set-features", visible: true })).toMatchObject({
      featuresVisible: true,
      featuresDocked: true,
    });
  });

  it("resets appearance and layout, and keeps what is open", () => {
    const changed = run(
      initialShellState,
      { type: "open-chat", chat: PLAN },
      { type: "open-file", fileId: "a" },
      { type: "set-theme", theme: "dark" },
      { type: "set-avatar", avatar: "think" },
      { type: "set-chat-width", width: 500 },
      { type: "swap-chat" },
      { type: "toggle-nav" },
      { type: "set-features", visible: false },
    );
    const reset = run(changed, { type: "reset-preferences" });
    expect(reset).toMatchObject({
      theme: "light",
      avatar: "ready",
      chatWidth: CHAT_DEFAULT_WIDTH,
      chatPosition: "left",
      navCollapsed: false,
      featuresVisible: true,
      // The gift button, once made, stays.
      featuresDocked: true,
      chat: PLAN,
      activeFileId: "a",
    });
  });
});

describe("hydration", () => {
  it("round-trips a session", () => {
    const state = run(
      initialShellState,
      { type: "open-local-file", fileId: "local" },
      { type: "open-chat", chat: PLAN },
      { type: "open-file", fileId: "a" },
      { type: "set-chat-width", width: 444 },
      { type: "swap-chat" },
      { type: "set-avatar", avatar: "write" },
    );
    const restored = hydrateShellState(toPersisted(state));
    expect(restored).toMatchObject({
      page: "editor",
      chat: PLAN,
      activeFileId: "a",
      openFileIds: ["local", "a"],
      tabContexts: { local: null, a: PLAN },
      chatWidth: 444,
      chatPosition: "right",
      avatar: "write",
    });
  });

  it("treats what it reads as untrusted", () => {
    const state = hydrateShellState({
      page: "nowhere" as never,
      chatWidth: Number.NaN,
      chatPosition: "top" as never,
      avatar: "clown" as never,
      theme: "sepia" as never,
      settingsSection: "secret" as never,
      openFileIds: ["a", 7 as never],
      activeFileId: "gone",
      tabContexts: { a: { folderId: "" } as never },
      chat: { conversationId: "x" } as never,
    });
    expect(state).toMatchObject({
      page: "home",
      chatWidth: CHAT_DEFAULT_WIDTH,
      chatPosition: "left",
      avatar: "ready",
      theme: "light",
      settingsSection: "general",
      openFileIds: ["a"],
      activeFileId: null,
      tabContexts: { a: null },
      chat: null,
    });
  });

  it("falls to Home from a page whose subject did not come back", () => {
    expect(hydrateShellState({ page: "assets" }).page).toBe("home");
    expect(hydrateShellState({ page: "editor", openFileIds: [] }).page).toBe("home");
    expect(hydrateShellState({ page: "editor", stage: true }).page).toBe("editor");
  });

  it("has no floating or Assets panel without a conversation", () => {
    expect(hydrateShellState({ chatFloating: true, panel: "assets", workspaceOpen: true })).toMatchObject({
      chatFloating: false,
      panel: "chat",
      workspaceOpen: false,
    });
  });
});

describe("sameChat", () => {
  it("compares by project and conversation", () => {
    expect(sameChat(PLAN, { ...PLAN })).toBe(true);
    expect(sameChat(PLAN, SALES)).toBe(false);
    expect(sameChat(null, null)).toBe(true);
    expect(sameChat(PLAN, null)).toBe(false);
  });
});
