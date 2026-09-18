import { cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { SEED_ACTIVE_FILE_ID, SEED_OPEN_FILE_IDS } from "../port/fake/seed";
import { renderShell } from "../test/renderShell";

// `globals: false` in vite.config means Testing Library never registers its own
// afterEach, so every suite in this repo unmounts explicitly.
afterEach(cleanup);

/**
 * The guard for decision 4.
 *
 * The prototype animated a fake continuity across mode switches because its
 * render path rebuilt the editor every time. This suite asserts the real thing
 * instead: the canvas host is the same DOM node before and after every layout
 * change the shell can make. If someone reintroduces a conditional render
 * around the workspace, these fail immediately.
 */
describe("EditorCanvasHost persistence", () => {
  it("keeps the same host node across a mode change", async () => {
    const shell = await renderShell();
    await shell.dispatch({ type: "open-file", fileId: SEED_ACTIVE_FILE_ID });

    const before = shell.canvasHost();
    await shell.dispatch({ type: "set-mode", mode: "editor" });
    const afterEditor = shell.canvasHost();
    await shell.dispatch({ type: "set-mode", mode: "agent" });
    const afterAgent = shell.canvasHost();

    expect(Object.is(before, afterEditor)).toBe(true);
    expect(Object.is(before, afterAgent)).toBe(true);
  });

  it("keeps the same host node across a Home round trip", async () => {
    const shell = await renderShell();
    await shell.dispatch({ type: "open-file", fileId: SEED_ACTIVE_FILE_ID });

    const before = shell.canvasHost();
    await shell.dispatch({ type: "go-home" });

    // Still in the document while Home shows, just not visible.
    const whileHome = shell.canvasHost();
    expect(Object.is(before, whileHome)).toBe(true);
    expect(whileHome.closest("[hidden]")).not.toBeNull();

    await shell.dispatch({ type: "activate-file", fileId: SEED_ACTIVE_FILE_ID });
    const after = shell.canvasHost();
    expect(Object.is(before, after)).toBe(true);
    expect(after.closest("[hidden]")).toBeNull();
  });

  it("keeps the same host node across a tab switch and reflects the new file type", async () => {
    const shell = await renderShell();
    for (const fileId of SEED_OPEN_FILE_IDS) {
      await shell.dispatch({ type: "open-file", fileId });
    }

    const before = shell.canvasHost();
    expect(before.dataset.fileType).toBe("slides");

    await shell.dispatch({ type: "activate-file", fileId: "file-forecast" });
    const after = shell.canvasHost();

    expect(Object.is(before, after)).toBe(true);
    expect(after.dataset.fileType).toBe("sheet");
  });

  it("changes only the agent column width when the mode changes", async () => {
    const shell = await renderShell();
    await shell.dispatch({ type: "open-file", fileId: SEED_ACTIVE_FILE_ID });

    const root = shell.view.container.querySelector<HTMLElement>("#shell");
    if (!root) throw new Error("shell root missing");

    expect(root.style.getPropertyValue("--shell-task-w")).toBe("340px");
    await shell.dispatch({ type: "set-mode", mode: "editor" });
    expect(root.style.getPropertyValue("--shell-task-w")).toBe("0px");
    // The sidebar is untouched by a mode change; only the agent column moves.
    expect(root.style.getPropertyValue("--shell-nav-w")).toBe("220px");
  });
});
