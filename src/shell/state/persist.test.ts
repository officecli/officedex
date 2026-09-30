import { afterEach, describe, expect, it } from "vitest";

import {
  bootPersisted,
  omitSessionNavigation,
  readPersisted,
  shouldRestoreSession,
  writePersisted,
  type PersistedShellState,
} from "./persist";

const PLAN = { folderId: "launch", conversationId: "plan" };

const SESSION: PersistedShellState = {
  page: "editor",
  chat: PLAN,
  panel: "assets",
  workspaceOpen: true,
  chatFloating: true,
  chatPosition: "right",
  chatWidth: 400,
  navCollapsed: true,
  expandedFolderIds: ["launch"],
  openFileIds: ["file-plan", "file-deck"],
  activeFileId: "file-plan",
  tabContexts: { "file-plan": PLAN, "file-deck": null },
  settingsSection: "models",
  avatar: "think",
  theme: "dark",
  featuresVisible: false,
  featuresDocked: true,
  demo: true,
  demoStartedAt: "2026-09-20T00:00:00.000Z",
  stage: false,
};

afterEach(() => {
  localStorage.clear();
});

describe("omitSessionNavigation", () => {
  it("keeps the window's preferences", () => {
    const kept = omitSessionNavigation(SESSION);
    expect(kept).toMatchObject({
      chatPosition: "right",
      chatWidth: 400,
      navCollapsed: true,
      expandedFolderIds: ["launch"],
      settingsSection: "models",
      avatar: "think",
      theme: "dark",
      featuresVisible: false,
      featuresDocked: true,
    });
  });

  it("drops the page, the conversation, the tabs and the recording (§02)", () => {
    const kept = omitSessionNavigation(SESSION);
    for (const key of [
      "page",
      "chat",
      "panel",
      "workspaceOpen",
      "chatFloating",
      "openFileIds",
      "activeFileId",
      "tabContexts",
      "demo",
      "demoStartedAt",
      "stage",
    ]) {
      expect(kept, key).not.toHaveProperty(key);
    }
  });
});

describe("bootPersisted", () => {
  it("does not restore last session's tabs on a cold launch", () => {
    writePersisted(SESSION);
    const boot = bootPersisted({}, "");
    expect(boot.openFileIds).toBeUndefined();
    expect(boot.page).toBeUndefined();
    expect(boot.chat).toBeUndefined();
    expect(boot.chatWidth).toBe(400);
    expect(boot.avatar).toBe("think");
  });

  it("lets an explicit override still open a workspace", () => {
    writePersisted(SESSION);
    const boot = bootPersisted({ page: "editor", openFileIds: ["file-deck"], activeFileId: "file-deck" }, "");
    expect(boot.page).toBe("editor");
    expect(boot.openFileIds).toEqual(["file-deck"]);
    expect(boot.activeFileId).toBe("file-deck");
  });

  it("restores the session when asked", () => {
    writePersisted(SESSION);
    expect(shouldRestoreSession("?restoreSession=1")).toBe(true);
    const boot = bootPersisted({}, "?restoreSession=1");
    expect(boot.page).toBe("editor");
    expect(boot.chat).toEqual(PLAN);
    expect(boot.openFileIds).toEqual(["file-plan", "file-deck"]);
    expect(readPersisted().openFileIds).toEqual(["file-plan", "file-deck"]);
  });

  it("reads nothing from the Agent/Editor shell's key", () => {
    localStorage.setItem("officedex.shell.v1", JSON.stringify({ mode: "editor", navWidth: 200 }));
    expect(readPersisted()).toEqual({});
  });

  it("survives a value that is not an object", () => {
    localStorage.setItem("officedex.shell.v2", "not json");
    expect(readPersisted()).toEqual({});
    localStorage.setItem("officedex.shell.v2", "7");
    expect(readPersisted()).toEqual({});
  });
});
