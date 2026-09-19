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
      "?mode=editor&home=0&nav=expanded&presence=floating",
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
    const fixture = readDevFixture("?shell=C9", true);
    expect(fixture?.stateOverride.mode).toBe("editor");
    expect(fixture?.stateOverride.home).toBe(false);
    expect(fixture?.stateOverride.navCollapsed).toBe(true);
    expect(fixture?.stateOverride.presence?.placement).toBe("floating");
  });

  it("gives Home combinations no presence, because none renders there", () => {
    expect(readDevFixture("?shell=C1", true)?.stateOverride.presence).toBeUndefined();
  });

  it("ignores an unknown combination rather than inventing one", () => {
    expect(readDevFixture("?shell=C99", true)).toBeNull();
  });

  it("lets an individual flag override the named combination", () => {
    const fixture = readDevFixture("?shell=C7&nav=expanded", true);
    // C7 is the collapsed rail; the explicit flag has to win, or a session
    // varying one axis would silently screenshot the wrong one.
    expect(fixture?.stateOverride.navCollapsed).toBe(false);
    expect(fixture?.stateOverride.mode).toBe("agent");
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

  it("opens on enough tabs to overflow the strip", () => {
    const fixture = readDevFixture("?shellFixture=1", true);
    expect(fixture?.stateOverride.openFileIds?.length).toBeGreaterThanOrEqual(5);
    expect(fixture?.stateOverride.activeFileId).toBe("file-plan");
  });

  it("does not let a stale combination override the fixture's own tabs", () => {
    // `?shell=` writes no tab state, so the fixture's ids have to survive the
    // merge. They did not in the first version: the spread order was wrong and
    // every fixture run opened on whatever localStorage happened to hold.
    const fixture = readDevFixture("?shellFixture=1&shell=C6", true);
    expect(fixture?.stateOverride.openFileIds).toContain("file-deck");
    expect(fixture?.stateOverride.home).toBe(false);
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
