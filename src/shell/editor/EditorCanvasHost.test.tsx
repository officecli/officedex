import { cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SEED_ACTIVE_FILE_ID, SEED_FOLDER_ID, SEED_OPEN_FILE_IDS } from "../port/fake/seed";
import { renderShell } from "../test/renderShell";
import { CHAT_DEFAULT_WIDTH, CHAT_MAX_WIDTH, CHAT_MIN_WIDTH } from "../state/shellReducer";
import { createTestCanvasAdapter } from "./testCanvasAdapter";

// `globals: false` in vite.config means Testing Library never registers its own
// afterEach, so every suite in this repo unmounts explicitly.
afterEach(cleanup);

/**
 * The guard for decision 4.
 *
 * The prototype animated a fake continuity across its layout changes because
 * its render path rebuilt the editor every time. This suite asserts the real
 * thing instead: the canvas host is the same DOM node before and after every
 * layout change the shell can make. If someone reintroduces a conditional
 * render around the document region, these fail immediately.
 */
describe("EditorCanvasHost document zoom (UI-14)", () => {
  afterEach(() => localStorage.removeItem("officedex.shell.documentView.v1"));

  it("opens a file the user never zoomed at 80% and brings each file back at its own zoom", async () => {
    const [first, second] = SEED_OPEN_FILE_IDS;
    const canvas = createTestCanvasAdapter();
    const shell = await renderShell({ canvas: canvas.adapter });
    await shell.dispatch({ type: "open-file", fileId: first! });
    expect(canvas.show.mock.calls.at(-1)?.[1]).toMatchObject({ zoom: 80 });

    canvas.zoom(first!, 125);
    await shell.dispatch({ type: "open-file", fileId: second! });
    expect(canvas.show.mock.calls.at(-1)?.[0].id).toBe(second);
    expect(canvas.show.mock.calls.at(-1)?.[1]).toMatchObject({ zoom: 80 });
    canvas.zoom(second!, "fit-page");

    // Back on the first tab, and again after a trip Home: each keeps its own.
    await shell.dispatch({ type: "activate-file", fileId: first! });
    expect(canvas.show.mock.calls.at(-1)?.[1]).toMatchObject({ zoom: 125 });
    await shell.dispatch({ type: "go", page: "home" });
    await shell.dispatch({ type: "activate-file", fileId: second! });
    expect(canvas.show.mock.calls.at(-1)?.[1]).toMatchObject({ zoom: "fit-page" });
  });

  it("remembers the zoom across a fresh shell, as on reopening the app", async () => {
    const canvas = createTestCanvasAdapter();
    const shell = await renderShell({ canvas: canvas.adapter });
    await shell.dispatch({ type: "open-file", fileId: SEED_ACTIVE_FILE_ID });
    canvas.zoom(SEED_ACTIVE_FILE_ID, 150);
    cleanup();

    const next = createTestCanvasAdapter();
    const reopened = await renderShell({ canvas: next.adapter, keepStorage: true });
    await reopened.dispatch({ type: "open-file", fileId: SEED_ACTIVE_FILE_ID });
    expect(next.show.mock.calls.at(-1)?.[1]).toMatchObject({ zoom: 150 });
  });
});

describe("EditorCanvasHost persistence", () => {
  it("selects the live stage explicitly and returns to a Local document", async () => {
    const canvas = createTestCanvasAdapter();
    const showFileless = vi.fn();
    canvas.adapter.showFileless = showFileless;
    const shell = await renderShell({ canvas: canvas.adapter });
    await shell.dispatch({ type: "open-local-file", fileId: SEED_ACTIVE_FILE_ID });
    await shell.dispatch({ type: "enter-stage" });
    expect(showFileless).toHaveBeenLastCalledWith({ demo: false });
    showFileless.mockClear();
    await shell.dispatch({ type: "open-local-file", fileId: SEED_ACTIVE_FILE_ID });
    expect(canvas.show.mock.calls.at(-1)?.[0].id).toBe(SEED_ACTIVE_FILE_ID);
    expect(showFileless).not.toHaveBeenCalled();
  });

  it("keeps the same host node across every page the shell can show", async () => {
    const shell = await renderShell();
    await shell.dispatch({ type: "open-file", fileId: SEED_ACTIVE_FILE_ID });

    const before = shell.canvasHost();
    for (const page of ["home", "local", "settings"] as const) {
      await shell.dispatch({ type: "go", page });
      const during = shell.canvasHost();
      // Still in the document while the page shows, just not visible.
      expect(Object.is(before, during)).toBe(true);
      expect(during.closest("[hidden]")).not.toBeNull();
    }

    // And a project's Assets list, which is the page a conversation opens onto.
    await shell.dispatch({ type: "open-chat", chat: { folderId: SEED_FOLDER_ID, conversationId: null } });
    expect(Object.is(before, shell.canvasHost())).toBe(true);

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

  /*
   * What the stable node buys: the adapter is mounted once, into that node, and
   * is told which file to show. A layout change is a `show`/`hide`, never a
   * teardown — an editor that were rebuilt per navigation would lose the
   * document's undo stack and whatever the user had typed into it.
   */
  it("mounts the adapter once and tells it which file to show", async () => {
    const canvas = createTestCanvasAdapter();
    const shell = await renderShell({ canvas: canvas.adapter });
    await shell.dispatch({ type: "open-file", fileId: SEED_ACTIVE_FILE_ID });

    expect(canvas.mount).toHaveBeenCalledOnce();
    expect(canvas.mount.mock.calls[0]?.[0]).toBe(shell.canvasHost());
    expect(canvas.show.mock.calls.at(-1)?.[0].id).toBe(SEED_ACTIVE_FILE_ID);

    await shell.dispatch({ type: "open-file", fileId: "file-forecast" });
    expect(canvas.show.mock.calls.at(-1)?.[0].id).toBe("file-forecast");

    await shell.dispatch({ type: "go", page: "home" });
    expect(canvas.hide).toHaveBeenCalled();

    await shell.dispatch({ type: "activate-file", fileId: SEED_ACTIVE_FILE_ID });
    expect(canvas.show.mock.calls.at(-1)?.[0].id).toBe(SEED_ACTIVE_FILE_ID);
    expect(canvas.mount).toHaveBeenCalledOnce();
    expect(canvas.unmount).not.toHaveBeenCalled();
  });

  /*
   * Which toolbar a document gets follows how its tab was opened: beside a
   * conversation the editor shares the window and gets the single-line
   * toolbar; from Local it keeps the full ribbon. The tab remembers which.
   */
  it("asks for a compact toolbar for a document opened from a conversation and a full one from Local", async () => {
    const canvas = createTestCanvasAdapter();
    const shell = await renderShell({ canvas: canvas.adapter });

    await shell.dispatch({ type: "open-local-file", fileId: SEED_ACTIVE_FILE_ID });
    expect(canvas.show.mock.calls.at(-1)).toEqual([
      expect.objectContaining({ id: SEED_ACTIVE_FILE_ID }),
      { toolbarProfile: "full", zoom: 80 },
    ]);

    await shell.dispatch({ type: "open-chat", chat: { folderId: SEED_FOLDER_ID, conversationId: null } });
    await shell.dispatch({ type: "open-file", fileId: "file-forecast" });
    expect(canvas.show.mock.calls.at(-1)).toEqual([
      expect.objectContaining({ id: "file-forecast" }),
      { toolbarProfile: "compact", zoom: 80 },
    ]);

    // Back to the Local tab: its context, and so its profile, come with it.
    await shell.dispatch({ type: "activate-file", fileId: SEED_ACTIVE_FILE_ID });
    expect(canvas.show.mock.calls.at(-1)).toEqual([
      expect.objectContaining({ id: SEED_ACTIVE_FILE_ID }),
      { toolbarProfile: "full", zoom: 80 },
    ]);
  });

  /*
   * A conversation opening beside the document, and the divider being dragged,
   * are the layout changes that used to be a mode switch. Both move one number
   * — the conversation column's width, clamped to 320–520 (§03) — and neither
   * touches the sidebar or the host.
   */
  it("changes only the conversation column when one opens beside the document", async () => {
    const shell = await renderShell();
    await shell.dispatch({ type: "open-file", fileId: SEED_ACTIVE_FILE_ID });

    const root = shell.view.container.querySelector<HTMLElement>("#shell");
    const workspace = shell.view.container.querySelector<HTMLElement>("#dx-workspace");
    if (!root || !workspace) throw new Error("shell root missing");
    const before = shell.canvasHost();

    expect(root.style.getPropertyValue("--dx-chat")).toBe(`${CHAT_DEFAULT_WIDTH}px`);

    await shell.dispatch({ type: "open-chat", chat: { folderId: SEED_FOLDER_ID, conversationId: null } });
    // Opened from the conversation, so the tab belongs to it (§18) and the
    // document is drawn beside it.
    await shell.dispatch({ type: "open-file", fileId: SEED_ACTIVE_FILE_ID });
    expect(workspace.classList.contains("dx-with-chat")).toBe(true);

    await shell.dispatch({ type: "set-chat-width", width: 480 });
    expect(root.style.getPropertyValue("--dx-chat")).toBe("480px");

    // Out of range it clamps, rather than squeezing the document out.
    await shell.dispatch({ type: "set-chat-width", width: 900 });
    expect(root.style.getPropertyValue("--dx-chat")).toBe(`${CHAT_MAX_WIDTH}px`);
    await shell.dispatch({ type: "set-chat-width", width: 100 });
    expect(root.style.getPropertyValue("--dx-chat")).toBe(`${CHAT_MIN_WIDTH}px`);

    // The sidebar only moves when the user moves it, and the host never moves.
    expect(workspace.classList.contains("dx-compact")).toBe(false);
    expect(Object.is(before, shell.canvasHost())).toBe(true);
  });
});
