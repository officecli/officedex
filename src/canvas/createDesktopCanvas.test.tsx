import { useEffect } from "react";
import { act, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { DesktopAPI } from "../shared/types";
import type { FileMeta } from "../shared/uiPort";
import { createDesktopCanvas } from "./createDesktopCanvas";

afterEach(cleanup);

/**
 * The adapter, without the embedded editor.
 *
 * `PresentationCanvas` is stubbed: what is under test is the adapter's own
 * behaviour — one React root for the life of the shell, a controller reached by
 * `save`, subscriptions that fan out — not whether PowerPoint renders. The real
 * frame needs a preview token, a staged presentation runtime and an iframe, and
 * a test that needed all three would be testing the runtime rather than this.
 */
let lastProps: Record<string, unknown> | null = null;
let lastDocProps: Record<string, unknown> | null = null;
let renderCount = 0;

vi.mock("./PresentationCanvas", () => ({
  PresentationCanvas: (props: Record<string, unknown>) => {
    lastProps = props;
    renderCount += 1;
    /*
     * The real one reports its in-place editor from a controller callback that
     * arrives after the editor boots, and this adapter is what routes an
     * instruction to it. The stub reports one from an effect for the same
     * reason the real one does: `CanvasContent` withdraws the runner from an
     * effect of its own, and a stub that reported during render would hide the
     * ordering that decides whether the withdrawal wins.
     */
    const report = props.onEditRunner as ((edit: unknown) => void) | undefined;
    useEffect(() => {
      report?.(async () => ({
        summary: "stub",
        applied: 1,
        scope: "document",
        saveError: null,
        undo: null,
      }));
    }, [report]);
    return null;
  },
}));

// Stubbed for the same reason as the deck: what is under test is the adapter's
// fan-out, not whether Writer boots. The real one issues a preview token and
// mounts an iframe.
vi.mock("./DocxCanvas", () => ({
  DocxCanvas: (props: Record<string, unknown>) => {
    lastDocProps = props;
    return null;
  },
}));

// The adapter now mounts a task store, which reduces the bridge stream so a
// drawing run can take the canvas. These two are all of that the tests need:
// no events, no history, nothing ever live.
function stubApi(): DesktopAPI {
  return {
    onBridgeEvent: () => () => {},
    getTaskHistory: async () => [],
  } as unknown as DesktopAPI;
}

function file(id: string, type: FileMeta["type"] = "slides"): FileMeta {
  return {
    id,
    name: `${id}.pptx`,
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
  const unavailable: string[] = [];
  const adapter = createDesktopCanvas({ api: stubApi(), onUnavailable: (r) => unavailable.push(r) });
  act(() => {
    void adapter.mount(host);
  });
  return { host, adapter, unavailable };
}

describe("desktop canvas adapter", () => {
  afterEach(() => {
    lastProps = null;
    lastDocProps = null;
    renderCount = 0;
  });

  // Decision 4 reaches down to here: the host node persists, and so must the
  // React root inside it. Re-rooting on every file change would reload the
  // presentation runtime for what is a document switch.
  it("renders into the host without replacing it on a file change", () => {
    const { host, adapter } = mounted();

    act(() => adapter.show(file("deck-1")));
    const afterFirst = host.firstChild;
    act(() => adapter.show(file("deck-2")));

    expect(host.isConnected).toBe(true);
    expect(host.firstChild).toBe(afterFirst);
    expect((lastProps?.file as FileMeta).id).toBe("deck-2");
  });

  // Home is not a teardown. Rendering null on hide would unmount the editor,
  // which makes every trip to Home a document reload — the exact thing decision
  // 4 exists to prevent. The shell already hides the whole workspace, and a
  // hidden iframe keeps its document where an unmounted one does not.
  it("keeps the editor mounted while Home is showing", () => {
    const { adapter } = mounted();

    act(() => adapter.show(file("deck-1")));
    const afterShow = renderCount;
    act(() => adapter.hide());

    expect(renderCount).toBe(afterShow);
    expect((lastProps?.file as FileMeta).id).toBe("deck-1");
  });

  /*
   * An open deck must be able to take an instruction.
   *
   * `CanvasContent` withdraws the in-place runner for any branch that cannot
   * offer one, and the test for that was `open.type !== "doc"` — which is
   * every deck. Because the runner is reported from an effect and withdrawn
   * from a later one, the withdrawal won: `canEditDocument()` was false for an
   * open deck, so "change slide 2" was routed to the generation runtime and
   * re-authored the whole deck. Words, decks and sheets are the three answers;
   * only the first two edit in place.
   */
  it("keeps the deck's in-place editor available after the open", () => {
    const { adapter } = mounted();

    act(() => adapter.show(file("deck-1", "slides")));

    expect(adapter.canEditDocument?.()).toBe(true);
  });

  it("withdraws in-place editing for a workbook", () => {
    const { adapter } = mounted();

    // A sheet reports no runner of its own, so whatever the previous file left
    // behind must be cleared rather than kept.
    act(() => adapter.show(file("deck-1", "slides")));
    act(() => adapter.show(file("book-1", "sheet")));

    expect(adapter.canEditDocument?.()).toBe(false);
  });

  // There is no longer a file type without an editor — documents, decks and
  // workbooks are all wired — so the skeleton's remaining job is the moment
  // before anything has been opened.
  //
  // This used to show a sheet and assert nothing rendered. Once sheets were
  // wired that passed for the wrong reason: `lastProps` is only set by the
  // presentation stub, so it stayed null while the real `SheetCanvas` rendered
  // underneath against a stub api and failed its way into `onUnavailable`.
  /*
   * A finished image run opens its picture here. Rendered for real rather than
   * stubbed: what matters is that the bytes arrive through the preview token
   * and end up in an <img>, since the webview cannot load the path itself.
   */
  it("shows a generated image from its preview token", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const createObjectURL = vi.fn(() => "blob:poster");
    const revokeObjectURL = vi.fn();
    Object.assign(URL, { createObjectURL, revokeObjectURL });
    const api = {
      ...stubApi(),
      getDocument: async () => ({ filePath: "/tmp/poster.png", fileName: "poster.png", documentType: "img" }),
      issuePreviewToken: async () => ({ token: "tok-1" }),
      readArtifactFile: async () => ({ data: new Uint8Array([137, 80, 78, 71]) }),
      revokePreviewToken: vi.fn(async () => {}),
    } as unknown as DesktopAPI;
    const adapter = createDesktopCanvas({ api, onUnavailable: () => {} });
    act(() => {
      void adapter.mount(host);
    });

    await act(async () => adapter.show({ ...file("img-1", "image"), name: "poster.png" }));

    const image = host.querySelector(".shell-image-canvas img");
    expect(image?.getAttribute("src")).toBe("blob:poster");
    expect(image?.getAttribute("alt")).toBe("poster.png");
    expect(adapter.canEditDocument?.()).toBe(false);
  });

  it("leaves the skeleton alone until something is opened", () => {
    const { adapter } = mounted();

    expect(lastProps).toBeNull();

    act(() => adapter.show(file("deck-1")));
    expect(lastProps).not.toBeNull();
  });

  it("fans dirty changes out to every subscriber", () => {
    const { adapter } = mounted();
    const seen: boolean[] = [];
    const other: boolean[] = [];
    const unsubscribe = adapter.onDirtyChange((dirty) => seen.push(dirty));
    adapter.onDirtyChange((dirty) => other.push(dirty));

    act(() => adapter.show(file("deck-1")));
    act(() => (lastProps!.onDirtyChange as (dirty: boolean) => void)(true));

    expect(seen).toEqual([true]);
    expect(other).toEqual([true]);

    unsubscribe();
    act(() => (lastProps!.onDirtyChange as (dirty: boolean) => void)(false));
    expect(seen).toEqual([true]);
    expect(other).toEqual([true, false]);
  });

  it("saves through the editor's controller", async () => {
    const { adapter } = mounted();
    const save = vi.fn(async () => ({ filePath: "/tmp/deck.pptx", revision: 2 }));

    act(() => adapter.show(file("deck-1")));
    act(() => (lastProps!.onController as (c: unknown) => void)({ save }));
    await adapter.save();

    expect(save).toHaveBeenCalledOnce();
  });

  // Home, or a file type with no editor. Saving nothing is not a failure — the
  // save button must not report an error for a document that has no bytes to
  // write.
  it("saves quietly when no editor is mounted", async () => {
    const { adapter } = mounted();
    await expect(adapter.save()).resolves.toBeUndefined();
  });

  // Switching to a file no editor can open must not leave the previous
  // document's handle behind: the next save would write through a session that
  // is no longer on screen.
  it("drops the save handle when nothing editable is showing", async () => {
    const { adapter } = mounted();
    const save = vi.fn(async () => ({ filePath: "/tmp/deck.pptx", revision: 2 }));

    act(() => adapter.show(file("deck-1")));
    act(() => (lastProps!.onController as (c: unknown) => void)({ save }));
    act(() => adapter.show(file("budget", "sheet")));
    await adapter.save();

    expect(save).not.toHaveBeenCalled();
  });

  /*
   * Selection. The subscription existed from the start and nothing ever came
   * through it, so the composer's reference chip was permanently empty on the
   * desktop even though the shell was wired for it.
   */
  it("fans the document's selection out to subscribers", () => {
    const { adapter } = mounted();
    const seen: Array<unknown> = [];
    adapter.onSelection((selection) => seen.push(selection));

    act(() => adapter.show(file("notes", "doc")));
    const selection = { fileId: "notes", label: "notes.pptx · 2 paragraphs", text: "" };
    act(() => (lastDocProps!.onSelectionChange as (s: unknown) => void)(selection));

    expect(seen.at(-1)).toEqual(selection);
  });

  // A selection belongs to the document it was made in. Staying quiet here
  // would leave the composer quoting the file the user just left.
  it("clears the selection when the open file changes", () => {
    const { adapter } = mounted();
    const seen: Array<unknown> = [];

    act(() => adapter.show(file("notes", "doc")));
    adapter.onSelection((selection) => seen.push(selection));
    act(() =>
      (lastDocProps!.onSelectionChange as (s: unknown) => void)({
        fileId: "notes",
        label: "notes.pptx",
        text: "",
      }),
    );
    act(() => adapter.show(file("other", "doc")));

    expect(seen.at(-1)).toBeNull();
  });

  // The text is read on demand, once, because reading it re-targets Writer's
  // tracked edit scope — see the note on `resolveSelection`.
  it("reads the selected text only when asked", async () => {
    const { adapter } = mounted();
    const resolve = vi.fn(async () => ({ fileId: "notes", label: "notes", text: "quoted words" }));

    expect(await adapter.resolveSelection?.()).toBeNull();

    act(() => adapter.show(file("notes", "doc")));
    act(() => (lastDocProps!.onResolveSelection as (r: unknown) => void)(resolve));

    expect(await adapter.resolveSelection?.()).toEqual(
      expect.objectContaining({ text: "quoted words" }),
    );
    expect(resolve).toHaveBeenCalledOnce();
  });
});
