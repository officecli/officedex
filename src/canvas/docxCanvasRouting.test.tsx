import { act, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { DesktopAPI } from "../shared/types";
import type { FileMeta } from "../shared/uiPort";
import { createDesktopCanvas } from "./createDesktopCanvas";

afterEach(cleanup);

/**
 * The adapter's docx branch.
 *
 * Kept out of `createDesktopCanvas.test.tsx` so the two leaves can be stubbed
 * independently — a file can only mock a module one way, and that suite stubs
 * the presentation leaf.
 *
 * `DocxCanvas` is stubbed for the same reason its sibling is: what is under
 * test is the routing and the save handle, not whether Writer renders. The real
 * frame wants a preview token, a staged Writer build and an iframe, and a test
 * that supplied all three would be testing the embed.
 */
let lastProps: Record<string, unknown> | null = null;

vi.mock("./DocxCanvas", () => ({
  DocxCanvas: (props: Record<string, unknown>) => {
    lastProps = props;
    return null;
  },
}));

vi.mock("./PresentationCanvas", () => ({
  PresentationCanvas: () => null,
}));

function file(id: string, type: FileMeta["type"], name = `${id}.docx`): FileMeta {
  return {
    id,
    name,
    type,
    folderId: "folder:default",
    createdAt: 0,
    updatedAt: 0,
    lastOpenedAt: null,
    dirty: false,
    pinned: false,
  };
}

function mounted() {
  const host = document.createElement("div");
  document.body.append(host);
  // The adapter mounts a task store so a drawing run can take the canvas. These
  // two are all of it these tests need: no events, no history, nothing live.
  const api = {
    onBridgeEvent: () => () => {},
    getTaskHistory: async () => [],
  } as unknown as DesktopAPI;
  const adapter = createDesktopCanvas({ api, onUnavailable: () => {} });
  act(() => {
    void adapter.mount(host);
  });
  return adapter;
}

describe("desktop canvas · documents", () => {
  afterEach(() => {
    lastProps = null;
  });

  it("routes a document to the Word canvas", () => {
    const adapter = mounted();

    act(() => adapter.show(file("notes", "doc")));

    expect((lastProps?.file as FileMeta).id).toBe("notes");
  });

  // The editor is the only thing holding the bytes: `files.save` on the port
  // clears the dirty flag and writes nothing, so a save that did not reach here
  // would mark a document clean without saving it.
  it("saves through the Writer editor handle", async () => {
    const adapter = mounted();
    const save = vi.fn(async () => ({ filePath: "/tmp/notes.docx", sha256: "abc" }));

    act(() => adapter.show(file("notes", "doc")));
    act(() => (lastProps!.onEditor as (editor: unknown) => void)({ save }));
    await adapter.save();

    expect(save).toHaveBeenCalledOnce();
  });

  // Writer reports null when the component is missing or the frame is going
  // away. A stale handle would post into a torn-down iframe and hang there.
  it("drops the handle when the editor goes away", async () => {
    const adapter = mounted();
    const save = vi.fn(async () => ({ filePath: "/tmp/notes.docx", sha256: "abc" }));

    act(() => adapter.show(file("notes", "doc")));
    act(() => (lastProps!.onEditor as (editor: unknown) => void)({ save }));
    act(() => (lastProps!.onEditor as (editor: unknown) => void)(null));
    await adapter.save();

    expect(save).not.toHaveBeenCalled();
  });

  // Switching a tab from a document to a deck must not leave Writer's handle
  // behind: the next save would write through a session that is not on screen.
  it("drops the handle when another type takes the canvas", async () => {
    const adapter = mounted();
    const save = vi.fn(async () => ({ filePath: "/tmp/notes.docx", sha256: "abc" }));

    act(() => adapter.show(file("notes", "doc")));
    act(() => (lastProps!.onEditor as (editor: unknown) => void)({ save }));
    act(() => adapter.show(file("deck", "slides", "deck.pptx")));
    await adapter.save();

    expect(save).not.toHaveBeenCalled();
  });

  // Dirty is what the tab dot and the status bar read, and only the editor can
  // tell that the user typed.
  it("fans the document's dirty state out to the shell", () => {
    const adapter = mounted();
    const seen: boolean[] = [];
    adapter.onDirtyChange((dirty) => seen.push(dirty));

    act(() => adapter.show(file("notes", "doc")));
    act(() => (lastProps!.onDirtyChange as (dirty: boolean) => void)(true));

    expect(seen).toEqual([true]);
  });

  /**
   * The other half of the rule above, and the reason the handle is dropped by
   * id rather than on every render.
   *
   * `EditorCanvasHost` calls `show` whenever its `[file, visible]` change, and
   * `FileMeta` is a fresh object after every `reload()` — so the same document
   * is shown again and again. Clearing the handle on each of those would leave
   * `save()` with nothing to call, and it fails silently: the button would go
   * quiet and write nothing, which is worse than writing the wrong file because
   * nobody finds out.
   *
   * The leaf cannot rescue it either — React re-renders it with new props but
   * does not re-fire `onEditor`, so the handle would never come back.
   */
  it("keeps the handle when the same document is shown again", async () => {
    const adapter = mounted();
    const save = vi.fn(async () => ({ filePath: "/tmp/notes.docx", sha256: "abc" }));

    act(() => adapter.show(file("notes", "doc")));
    act(() => (lastProps!.onEditor as (editor: unknown) => void)({ save }));
    // A reload: same document, new object.
    act(() => adapter.show(file("notes", "doc")));
    await adapter.save();

    expect(save).toHaveBeenCalledOnce();
  });
});
