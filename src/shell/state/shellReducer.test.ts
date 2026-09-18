import { describe, expect, it } from "vitest";

import { seedFiles } from "../port/fake/seed";
import {
  canDock,
  effectivePlacement,
  hydrateShellState,
  initialShellState,
  shellReducer,
  showsPresenceFace,
  type ShellAction,
  type ShellState,
} from "./shellReducer";

const run = (state: ShellState, ...actions: ShellAction[]) => actions.reduce(shellReducer, state);

describe("agent presence placement (decision 1)", () => {
  it("only allows docking in Agent mode", () => {
    const agent = run(initialShellState, { type: "set-placement", placement: "docked" });
    expect(canDock(agent)).toBe(true);
    expect(effectivePlacement(agent)).toBe("docked");

    const editor = run(agent, { type: "set-mode", mode: "editor" });
    expect(canDock(editor)).toBe(false);
    expect(effectivePlacement(editor)).toBe("floating");
  });

  it("remembers the Agent-mode preference across a trip through Editor", () => {
    const state = run(
      initialShellState,
      { type: "set-placement", placement: "floating" },
      { type: "set-mode", mode: "editor" },
      { type: "set-mode", mode: "agent" },
    );
    expect(effectivePlacement(state)).toBe("floating");

    const docked = run(
      state,
      { type: "set-placement", placement: "docked" },
      { type: "set-mode", mode: "editor" },
      { type: "set-mode", mode: "agent" },
    );
    expect(effectivePlacement(docked)).toBe("docked");
  });

  it("never shows a collapsed face beside the docked column", () => {
    const docked = run(initialShellState, { type: "set-placement", placement: "docked" });
    expect(showsPresenceFace(docked)).toBe(false);

    const floating = run(docked, { type: "set-placement", placement: "floating" });
    expect(showsPresenceFace(floating)).toBe(true);

    // Editor cannot dock, so the face is always the presence there.
    expect(showsPresenceFace(run(docked, { type: "set-mode", mode: "editor" }))).toBe(true);
  });
});

describe("folder selection (decisions 2 and 3)", () => {
  it("treats no-folder-chosen as null rather than a pseudo-folder", () => {
    const state = run(
      initialShellState,
      { type: "select-folder", folderId: "folder-launch" },
      { type: "select-folder", folderId: null },
    );
    expect(state.selectedFolderId).toBeNull();
  });
});

describe("tabs", () => {
  it("activates a newly opened file and leaves Home", () => {
    const state = run(initialShellState, { type: "open-file", fileId: "file-plan" });
    expect(state.home).toBe(false);
    expect(state.openFileIds).toEqual(["file-plan"]);
    expect(state.activeFileId).toBe("file-plan");
  });

  it("does not duplicate an already open file", () => {
    const state = run(
      initialShellState,
      { type: "open-file", fileId: "file-plan" },
      { type: "open-file", fileId: "file-deck" },
      { type: "open-file", fileId: "file-plan" },
    );
    expect(state.openFileIds).toEqual(["file-plan", "file-deck"]);
    expect(state.activeFileId).toBe("file-plan");
  });

  it("moves activation to the neighbour when the active tab closes", () => {
    const state = run(
      initialShellState,
      { type: "open-file", fileId: "file-plan" },
      { type: "open-file", fileId: "file-forecast" },
      { type: "open-file", fileId: "file-deck" },
      { type: "activate-file", fileId: "file-forecast" },
      { type: "close-file", fileId: "file-forecast" },
    );
    expect(state.openFileIds).toEqual(["file-plan", "file-deck"]);
    expect(state.activeFileId).toBe("file-deck");
    expect(state.home).toBe(false);
  });

  it("falls back to Home when the last tab closes", () => {
    const state = run(
      initialShellState,
      { type: "open-file", fileId: "file-plan" },
      { type: "close-file", fileId: "file-plan" },
    );
    expect(state.openFileIds).toEqual([]);
    expect(state.activeFileId).toBeNull();
    expect(state.home).toBe(true);
  });

  it("drops tabs whose file disappeared underneath the shell", () => {
    const files = seedFiles();
    const opened = run(
      initialShellState,
      { type: "open-file", fileId: "file-plan" },
      { type: "open-file", fileId: "file-deck" },
    );
    const pruned = run(opened, {
      type: "prune-files",
      files: files.filter((file) => file.id !== "file-deck"),
    });
    expect(pruned.openFileIds).toEqual(["file-plan"]);
    expect(pruned.activeFileId).toBe("file-plan");
  });
});

describe("sidebar width", () => {
  it("collapses to the rail below the halfway point and clamps otherwise", () => {
    expect(run(initialShellState, { type: "set-nav-width", width: 80 }).navCollapsed).toBe(true);
    expect(run(initialShellState, { type: "set-nav-width", width: 999 }).navWidth).toBe(300);
    expect(run(initialShellState, { type: "set-nav-width", width: 120 }).navWidth).toBe(160);
  });

  it("clamps the docked agent column", () => {
    expect(run(initialShellState, { type: "set-task-width", width: 10 }).taskWidth).toBe(320);
    expect(run(initialShellState, { type: "set-task-width", width: 9999 }).taskWidth).toBe(660);
  });
});

describe("hydration", () => {
  it("ignores a malformed persisted payload instead of throwing", () => {
    const state = hydrateShellState({
      mode: "nonsense" as never,
      navWidth: Number.NaN,
      openFileIds: "not-an-array" as never,
      presence: { placement: "sideways" as never, expanded: true, x: Number.NaN, y: 4, edge: null },
    });
    expect(state.mode).toBe("agent");
    expect(state.navWidth).toBe(220);
    expect(state.openFileIds).toEqual([]);
    expect(state.presence.placement).toBe("docked");
    // A non-finite coordinate reads as "never placed" rather than as the
    // top-left corner, so the presence still gets its default position.
    expect(state.presence.x).toBeNull();
    expect(state.presence.y).toBe(4);
  });

  it("treats a persisted 0 as a real position, not as unplaced", () => {
    const state = hydrateShellState({
      presence: { placement: "floating", expanded: false, x: 0, y: 0, edge: "left" },
    });
    expect(state.presence.x).toBe(0);
    expect(state.presence.y).toBe(0);
    expect(state.presence.edge).toBe("left");
  });
});
