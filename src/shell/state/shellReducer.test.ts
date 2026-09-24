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

describe("mode change", () => {
  it("collapses the sidebar when entering Agent mode", () => {
    const expandedEditor = run(
      initialShellState,
      { type: "set-mode", mode: "editor" },
      { type: "toggle-nav" },
    );
    expect(expandedEditor.navCollapsed).toBe(false);

    const agent = run(expandedEditor, { type: "set-mode", mode: "agent" });
    expect(agent.navCollapsed).toBe(true);
    expect(agent.mode).toBe("agent");
  });

  it("leaves the sidebar as-is when entering Editor mode", () => {
    const expanded = run(initialShellState, { type: "toggle-nav" });
    expect(expanded.navCollapsed).toBe(false);
    expect(run(expanded, { type: "set-mode", mode: "editor" }).navCollapsed).toBe(false);
  });

  it("collapses the agent presence when entering Editor mode", () => {
    const editor = run(initialShellState, { type: "set-mode", mode: "editor" });
    expect(editor.presence.expanded).toBe(false);
  });
});

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

  it("collapses the agent presence when opening a file in Editor mode", () => {
    const editor = run(
      initialShellState,
      { type: "set-mode", mode: "editor" },
      { type: "set-presence-expanded", expanded: true },
    );
    expect(editor.presence.expanded).toBe(true);

    const opened = run(editor, { type: "open-file", fileId: "file-plan" });
    expect(opened.presence.expanded).toBe(false);
  });

  it("leaves the agent presence expanded when opening a file in Agent mode", () => {
    const opened = run(initialShellState, { type: "open-file", fileId: "file-plan" });
    expect(opened.presence.expanded).toBe(true);
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

  // A deck being generated has no file to open the workspace through: its draft
  // is scratch that never enters the library. Without a way to leave Home
  // without one, the run would draw behind a hidden workspace.
  it("leaves Home with nothing open", () => {
    const state = run(initialShellState, { type: "enter-workspace" });
    expect(state.home).toBe(false);
    expect(state.activeFileId).toBeNull();
    expect(state.openFileIds).toEqual([]);
  });

  /*
   * "Nothing open" has to mean nothing, including what was open already.
   *
   * The case above starts from the initial state, where no file is active, so
   * it passed whatever this action did with an existing one. Generate a
   * workbook from Home with a document in a tab and the stale id put that
   * document's name in the tab strip and the status bar, over a stage writing
   * something else — and aimed the composer at it, which routes a follow-up
   * into `office.modify` against the wrong file.
   */
  it("drops the file that was open, keeping its tab", () => {
    const opened = run(
      initialShellState,
      { type: "open-file", fileId: "file-plan" },
      { type: "open-file", fileId: "file-deck" },
      { type: "go-home" },
    );
    expect(opened.activeFileId).toBe("file-deck");

    const entered = run(opened, { type: "enter-workspace" });
    expect(entered.activeFileId).toBeNull();
    // The tabs are the user's, not the run's: only the selection goes.
    expect(entered.openFileIds).toEqual(["file-plan", "file-deck"]);
  });

  /*
   * The recording is a canvas state, and a state means clearing too.
   *
   * `enter-workspace` is used by both the real live-run path (no demo) and
   * Home's "watch a deck being drawn" button (demo). Leaving it set on the
   * non-demo path would show the recording over a live run; not clearing it when
   * a file opens would leave the demo on screen behind that file.
   */
  it("enters the workspace on the recording only when asked", () => {
    expect(run(initialShellState, { type: "enter-workspace" }).demo).toBe(false);
    const demo = run(initialShellState, { type: "enter-workspace", demo: true });
    expect(demo.home).toBe(false);
    expect(demo.demo).toBe(true);
  });

  /*
   * Asking twice has to be a change, not a no-op.
   *
   * Going Home does not unmount the canvas, so pressing the button again finds
   * `demo` already true and the finished deck still loaded. The counter is what
   * the stage keys its session on; without it the second press does nothing.
   */
  it("stamps each request for the recording, so asking again restarts it", () => {
    const first = run(initialShellState, { type: "enter-workspace", demo: true });
    expect(first.demoStartedAt).not.toBeNull();
    const second = run(first, { type: "enter-workspace", demo: true });
    /*
     * Strictly newer, not merely set.
     *
     * Two presses can land in the same millisecond, and an equal stamp means an
     * unchanged React key, which means the second press does nothing at all —
     * the failure this whole mechanism exists to prevent.
     */
    expect(Date.parse(second.demoStartedAt!)).toBeGreaterThan(
      Date.parse(first.demoStartedAt!),
    );
  });

  it("leaves the recording's stamp alone for a live run", () => {
    // A run's stage is mid-draw; remounting it under the sequencer would throw
    // the drawing away. Leaving the stamp is also what lets the run outrank the
    // recording on the canvas.
    const demo = run(initialShellState, { type: "enter-workspace", demo: true });
    const live = run(demo, { type: "enter-workspace" });
    expect(live.demoStartedAt).toBe(demo.demoStartedAt);
  });

  it("drops the recording when it reports being superseded", () => {
    // The canvas decides when a later run outranks the recording; the flag has
    // to go with that decision, or a reload restores it over the run.
    const demo = run(initialShellState, { type: "enter-workspace", demo: true });
    const left = run(demo, { type: "leave-demo" });
    expect(left.demo).toBe(false);
    expect(left.demoStartedAt).toBeNull();
    // Nothing else moves: the workspace stays open on the run.
    expect(left.home).toBe(false);
  });

  it("clears the recording as soon as a file is opened", () => {
    const demo = run(initialShellState, { type: "enter-workspace", demo: true });
    const opened = run(demo, { type: "open-file", fileId: "file-plan" });
    expect(opened.demo).toBe(false);
    expect(opened.activeFileId).toBe("file-plan");
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
    expect(state.navWidth).toBe(190);
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
