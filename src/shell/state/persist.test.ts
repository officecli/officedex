import { afterEach, describe, expect, it } from "vitest";

import {
  bootPersisted,
  omitSessionNavigation,
  readPersisted,
  shouldRestoreSession,
  writePersisted,
  type PersistedShellState,
} from "./persist";

const SESSION: PersistedShellState = {
  mode: "editor",
  navWidth: 200,
  navCollapsed: false,
  taskWidth: 400,
  selectedFolderId: "folder-launch",
  expandedFolderIds: ["folder-launch"],
  revealedFolderIds: [],
  openFileIds: ["file-plan", "file-deck"],
  activeFileId: "file-plan",
  home: false,
  homeList: "pinned",
  demo: true,
  demoStartedAt: "2026-09-20T00:00:00.000Z",
  presence: { placement: "floating", expanded: true, x: 10, y: 20, edge: "right" },
};

afterEach(() => {
  localStorage.clear();
});

describe("omitSessionNavigation", () => {
  it("keeps chrome preferences and drops Home, tabs and the recording", () => {
    const chrome = omitSessionNavigation(SESSION);
    expect(chrome.mode).toBe("editor");
    expect(chrome.navWidth).toBe(200);
    expect(chrome.navCollapsed).toBe(false);
    expect(chrome.homeList).toBe("pinned");
    expect(chrome.presence?.x).toBe(10);
    expect(chrome).not.toHaveProperty("home");
    expect(chrome).not.toHaveProperty("openFileIds");
    expect(chrome).not.toHaveProperty("activeFileId");
    expect(chrome).not.toHaveProperty("demo");
    expect(chrome).not.toHaveProperty("demoStartedAt");
  });
});

describe("bootPersisted", () => {
  it("does not restore last session's tabs on a cold launch", () => {
    writePersisted(SESSION);
    const boot = bootPersisted({}, "");
    expect(boot.openFileIds).toBeUndefined();
    expect(boot.home).toBeUndefined();
    expect(boot.activeFileId).toBeUndefined();
    expect(boot.navWidth).toBe(200);
    expect(boot.mode).toBe("editor");
  });

  it("lets an explicit override still open a workspace", () => {
    writePersisted(SESSION);
    const boot = bootPersisted({ home: false, openFileIds: ["file-deck"], activeFileId: "file-deck" }, "");
    expect(boot.home).toBe(false);
    expect(boot.openFileIds).toEqual(["file-deck"]);
    expect(boot.activeFileId).toBe("file-deck");
  });

  it("restores the session when asked", () => {
    writePersisted(SESSION);
    expect(shouldRestoreSession("?restoreSession=1")).toBe(true);
    const boot = bootPersisted({}, "?restoreSession=1");
    expect(boot.home).toBe(false);
    expect(boot.openFileIds).toEqual(["file-plan", "file-deck"]);
    expect(readPersisted().openFileIds).toEqual(["file-plan", "file-deck"]);
  });
});
