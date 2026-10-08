import { describe, expect, it } from "vitest";

import { readDevFixture, SHELL_COMBINATIONS } from "./fixture";

/**
 * The guard first, because it is the only thing standing between a debugging
 * convenience and a shipped build that will hand anyone who types a query
 * parameter a workspace full of invented documents.
 */
describe("the production guard", () => {
  it("returns null for every fixture parameter when disabled", () => {
    for (const search of [
      "?shellFixture=1",
      "?shell=C7",
      "?page=editor&nav=expanded&float=1&chat=plan",
      "?forceUpdate=downloading",
      "?shellFixture=1&shell=C9&forceUpdate=error",
    ]) {
      expect(readDevFixture(search, false), search).toBeNull();
    }
  });

  it("is on in development", () => {
    // Guards the default argument itself: if `import.meta.env.DEV` stopped
    // reaching this module the suite above would still pass, because it passes
    // `false` explicitly, and the fixture would be silently dead in dev too.
    expect(readDevFixture("?shellFixture=1")).not.toBeNull();
  });
});

describe("shell combinations", () => {
  it("covers the ten the audit plan walks", () => {
    expect(Object.keys(SHELL_COMBINATIONS)).toEqual([
      "C1", "C2", "C3", "C4", "C5", "C6", "C7", "C8", "C9", "C10",
    ]);
  });

  it("expands a named combination into view state", () => {
    const fixture = readDevFixture("?shell=C7", true);
    expect(fixture?.stateOverride).toMatchObject({
      page: "editor",
      workspaceOpen: true,
      chatFloating: true,
      navCollapsed: true,
    });
    expect(fixture?.stateOverride.chat).not.toBeNull();
  });

  it("puts no conversation beside Home, Local or Settings", () => {
    // OD-UI-1.2 §16: those three never have a second column. A combination
    // that drew one would be reviewing a state the product cannot reach.
    for (const name of ["C1", "C2", "C3", "C10"]) {
      expect(readDevFixture(`?shell=${name}`, true)?.stateOverride.chat ?? null, name).toBeNull();
    }
  });

  it("only floats a conversation over an open content region", () => {
    for (const [name, combination] of Object.entries(SHELL_COMBINATIONS)) {
      const floating = "chatFloating" in combination && combination.chatFloating;
      if (floating) expect("workspaceOpen" in combination && combination.workspaceOpen, name).toBe(true);
    }
  });

  it("ignores an unknown combination rather than inventing one", () => {
    expect(readDevFixture("?shell=C99", true)).toBeNull();
  });

  it("lets an individual flag override the named combination", () => {
    const fixture = readDevFixture("?shell=C7&nav=expanded&side=right", true);
    // C7 hides the sidebar; the explicit flag has to win, or a session varying
    // one axis would silently screenshot the wrong one.
    expect(fixture?.stateOverride.navCollapsed).toBe(false);
    expect(fixture?.stateOverride.chatPosition).toBe("right");
    expect(fixture?.stateOverride.chatFloating).toBe(true);
  });
});

describe("individual flags", () => {
  it("opens a conversation beside its project's Assets", () => {
    const fixture = readDevFixture("?shellFixture=1&seed=prototype&chat=plan", true);
    expect(fixture?.stateOverride).toMatchObject({
      page: "assets",
      workspaceOpen: true,
      chat: { conversationId: "plan" },
    });
  });

  it("opens a file in the context on screen", () => {
    const local = readDevFixture("?shellFixture=1&seed=prototype&file=doc", true)?.stateOverride;
    expect(local).toMatchObject({ page: "editor", activeFileId: "doc", openFileIds: ["doc"] });
    expect(local?.tabContexts?.doc ?? null).toBeNull();

    const chat = readDevFixture("?shellFixture=1&seed=prototype&chat=plan&file=doc", true)?.stateOverride;
    expect(chat?.tabContexts?.doc).toMatchObject({ conversationId: "plan" });
  });

  it("opens several tabs, with the named one in front", () => {
    const first = readDevFixture("?shellFixture=1&seed=prototype&tabs=doc,sheet", true)?.stateOverride;
    expect(first).toMatchObject({ openFileIds: ["doc", "sheet"], activeFileId: "doc", page: "editor" });
    const second = readDevFixture("?shellFixture=1&seed=prototype&tabs=doc,sheet&file=sheet", true)?.stateOverride;
    expect(second?.activeFileId).toBe("sheet");
    expect(second?.openFileIds).toEqual(["doc", "sheet"]);
  });

  it("lets ?page decide what the content region shows", () => {
    const fixture = readDevFixture("?shellFixture=1&seed=prototype&chat=plan&page=editor", true);
    expect(fixture?.stateOverride.page).toBe("editor");
    expect(readDevFixture("?page=nowhere", true)).toBeNull();
  });

  it("opens Settings at a section, and refuses one that does not exist", () => {
    expect(readDevFixture("?section=models", true)?.stateOverride).toMatchObject({
      page: "settings",
      settingsSection: "models",
    });
    expect(readDevFixture("?section=secret", true)).toBeNull();
  });

  it("closes the content region, floats and docks the conversation", () => {
    const fixture = readDevFixture("?shellFixture=1&chat=x&workspace=closed&float=1&panel=assets&side=right", true);
    expect(fixture?.stateOverride).toMatchObject({
      workspaceOpen: false,
      chatFloating: true,
      panel: "assets",
      chatPosition: "right",
    });
  });
});

describe("a run in a named state", () => {
  const taskFor = async (state: string) => {
    const port = readDevFixture(`?shellFixture=1&seed=prototype&chat=plan&run=${state}`, true)?.port;
    return port!.agent.openConversation("launch", "plan");
  };

  it("stages each state the standard describes", async () => {
    for (const state of [
      "planning", "reading", "working", "checking", "input", "review",
      "complete", "stopped", "failed", "partial", "offline",
    ]) {
      const task = await taskFor(state);
      expect(task, state).not.toBeNull();
      expect(task!.status, state).not.toBe("idle");
    }
  });

  it("leaves the conversation where it was in the list", async () => {
    const port = readDevFixture("?shellFixture=1&seed=prototype&chat=plan&run=complete", true)?.port;
    const plain = readDevFixture("?shellFixture=1&seed=prototype", true)?.port;
    const order = async (from: typeof port) => (await from!.agent.list()).map((task) => task.conversationId);
    expect(await order(port)).toEqual(await order(plain));
  });

  it("asks for an offline workspace without making one", () => {
    // Parsing must not reach into the app: a test that reads this fixture would
    // otherwise leave every later test in the file offline.
    expect(readDevFixture("?shellFixture=1&seed=prototype&chat=plan&run=offline", true)?.offline).toBe(true);
    expect(readDevFixture("?shellFixture=1&offline=1", true)?.offline).toBe(true);
    expect(readDevFixture("?shellFixture=1", true)?.offline).toBe(false);
    expect(navigator.onLine).toBe(true);
  });
});

describe("the fixture port", () => {
  it("is absent unless asked for, so a bare combination keeps the real port", () => {
    expect(readDevFixture("?shell=C2", true)?.port).toBeNull();
  });

  it("serves the audit dataset", async () => {
    const port = readDevFixture("?shellFixture=1", true)?.port;
    expect(port).not.toBeNull();

    const folders = await port!.folders.list();
    const files = await port!.files.list();
    const tasks = await port!.agent.list();

    // The three shapes the audit needs and the prototype seed does not have.
    expect(folders.some((folder) => files.every((file) => file.folderId !== folder.id))).toBe(true);
    expect(files.filter((file) => file.folderId === "folder-bulk")).toHaveLength(45);
    expect(tasks.map((task) => task.status).sort()).toEqual(
      ["awaiting-review", "done", "idle", "paused", "working"],
    );
  });

  it("serves the prototype's workspace when asked", async () => {
    const port = readDevFixture("?shellFixture=1&seed=prototype", true)?.port;
    const folders = await port!.folders.list();
    const tasks = await port!.agent.list();
    expect(folders.filter((folder) => !folder.isDefault).map((folder) => folder.name)).toEqual([
      "MO product launch",
      "Quarterly review",
    ]);
    expect(tasks.map((task) => task.title)).toEqual([
      "Launch plan & copy",
      "Sales forecast review",
      "Launch presentation",
    ]);
  });

  it("opens on enough tabs to overflow the strip", () => {
    const fixture = readDevFixture("?shellFixture=1", true);
    expect(fixture?.stateOverride.openFileIds?.length).toBeGreaterThanOrEqual(5);
    expect(fixture?.stateOverride.activeFileId).toBe("file-plan");
  });

  it("does not let a combination override the fixture's own tabs", () => {
    // `?shell=` writes no tab state, so the fixture's ids have to survive the
    // merge. They did not in the first version: the spread order was wrong and
    // every fixture run opened on whatever localStorage happened to hold.
    const fixture = readDevFixture("?shellFixture=1&shell=C6", true);
    expect(fixture?.stateOverride.openFileIds).toContain("file-deck");
    expect(fixture?.stateOverride.page).toBe("editor");
  });
});

describe("the mandatory-update preview", () => {
  it("accepts the phases the overlay draws", () => {
    for (const phase of ["downloading", "downloaded", "installing", "error", "available"]) {
      expect(readDevFixture(`?forceUpdate=${phase}`, true)?.forceUpdate?.phase, phase).toBe(phase);
    }
  });

  it("refuses a phase the overlay has never heard of", () => {
    expect(readDevFixture("?forceUpdate=exploded", true)).toBeNull();
  });

  it("offers assets that cannot be downloaded from", () => {
    // Assets have to be present — the error state's manual-download fallback
    // reads them, and an empty map makes the only escape route from that page
    // unreachable. They must also never resolve: a fixture handing someone a
    // real installer is the one thing worse than no fallback at all.
    const release = readDevFixture("?forceUpdate=downloading", true)?.forceUpdate?.release;
    const assets = Object.values(release?.assets ?? {});
    expect(assets.length).toBeGreaterThan(0);
    for (const asset of assets) expect(asset.url).toContain(".invalid/");
  });
});

it("is null when nothing was asked for", () => {
  expect(readDevFixture("", true)).toBeNull();
  expect(readDevFixture("?someoneElsesParam=1", true)).toBeNull();
});
