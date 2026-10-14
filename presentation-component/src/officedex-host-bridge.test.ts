import { afterEach, describe, expect, it, onTestFinished, vi } from "vitest";
import {
  createEditorSaveBridge,
  createEditorZoomBridge,
  editorHoldsEdits,
  INLINE_ASSET_BYTE_LIMIT,
  inlineAssetUris,
  installSelectionNotifier,
  restoreAssetUris,
  revokeAssetObjectUrls,
  type EditorSaveState,
  type EditorWorkbenchHandle,
} from "./officedex-host-bridge";

const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
const decode = (bytes: Uint8Array) => JSON.parse(new TextDecoder().decode(bytes));

function deck(uri: string) {
  return {
    slides: [
      { shapes: [{ fill: { kind: "blip", resourceUri: uri, alpha: 1 } }, { fill: { kind: "solid" } }] },
      { shapes: [{ fill: { kind: "blip", resourceUri: uri } }] },
    ],
  };
}

const assets = new Map([
  ["media/a.jpg", { contentType: "image/jpeg", data: new Uint8Array([1, 2, 3, 4]) }],
]);

describe("MOP asset inlining", () => {
  it("replaces mop-asset references with data URIs the engine can load without fetch", () => {
    const { content, restore } = inlineAssetUris(encode(deck("mop-asset:/media/a.jpg")), assets);
    const document = decode(content);
    const dataUri = document.slides[0].shapes[0].fill.resourceUri;
    expect(dataUri).toBe("data:image/jpeg;base64,AQIDBA==");
    // Repeated references share one encoding, and untouched fields survive.
    expect(document.slides[1].shapes[0].fill.resourceUri).toBe(dataUri);
    expect(document.slides[0].shapes[0].fill.alpha).toBe(1);
    expect(restore.get(dataUri)).toBe("mop-asset:/media/a.jpg");
  });

  it("restores the mop-asset contract before content reaches the host", () => {
    const original = encode(deck("mop-asset:/media/a.jpg"));
    const { content, restore } = inlineAssetUris(original, assets);
    expect(decode(restoreAssetUris(content, restore))).toEqual(decode(original));
  });

  it("leaves content alone when an asset is missing, when there are none, or when it is not JSON", () => {
    const unknown = encode(deck("mop-asset:/media/missing.png"));
    const untouched = inlineAssetUris(unknown, assets);
    expect(untouched.restore.size).toBe(0);
    expect(decode(untouched.content)).toEqual(decode(unknown));
    expect(inlineAssetUris(unknown, new Map()).content).toBe(unknown);
    const binary = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);
    expect(inlineAssetUris(binary, assets).content).toBe(binary);
    expect(restoreAssetUris(binary, new Map([["data:x", "mop-asset:/y"]]))).toBe(binary);
  });

  it("hands an asset too large for the document codec over as an object URL", () => {
    // The codec refuses any string over 8 MiB and that fails the whole deck:
    // a 10.6 MB template photo became a 14 MB data URI and the deck would not
    // open. Small assets keep the data URI, which renders in every context.
    const large = new Uint8Array(INLINE_ASSET_BYTE_LIMIT + 1);
    const mixed = new Map([
      ["media/a.jpg", { contentType: "image/jpeg", data: new Uint8Array([1, 2, 3, 4]) }],
      ["media/big.jpg", { contentType: "image/jpeg", data: large }],
    ]);
    const source = deck("mop-asset:/media/big.jpg");
    source.slides[1].shapes[0].fill.resourceUri = "mop-asset:/media/a.jpg";
    const original = encode(source);

    // jsdom has no object URLs; the webview does.
    let minted = 0;
    const urls = URL as unknown as { createObjectURL?: unknown; revokeObjectURL?: unknown };
    const native = { create: urls.createObjectURL, revoke: urls.revokeObjectURL };
    urls.createObjectURL = (blob: Blob) => {
      expect(blob.size).toBe(large.byteLength);
      expect(blob.type).toBe("image/jpeg");
      return `blob:officedex/${++minted}`;
    };
    const revoke = vi.fn();
    urls.revokeObjectURL = revoke;
    onTestFinished(() => {
      urls.createObjectURL = native.create;
      urls.revokeObjectURL = native.revoke;
    });

    const { content, restore, objectUrls } = inlineAssetUris(original, mixed);
    const document = decode(content);
    const bigUri = document.slides[0].shapes[0].fill.resourceUri;

    expect(bigUri).toMatch(/^blob:/);
    expect(objectUrls).toEqual([bigUri]);
    expect(document.slides[1].shapes[0].fill.resourceUri).toBe("data:image/jpeg;base64,AQIDBA==");
    // No string in what the codec will read comes near its limit.
    expect(content.byteLength).toBeLessThan(1024);
    // Saving still writes the package's own references.
    expect(decode(restoreAssetUris(content, restore))).toEqual(decode(original));

    revokeAssetObjectUrls(objectUrls);
    expect(revoke).toHaveBeenCalledWith(bigUri);
  });

  it("mints no object URL for assets within the inline limit", () => {
    const atLimit = new Map([
      ["media/a.jpg", { contentType: "image/jpeg", data: new Uint8Array(INLINE_ASSET_BYTE_LIMIT) }],
    ]);
    const { content, objectUrls } = inlineAssetUris(encode(deck("mop-asset:/media/a.jpg")), atLimit);
    expect(objectUrls).toEqual([]);
    expect(decode(content).slides[0].shapes[0].fill.resourceUri).toMatch(/^data:image\/jpeg;base64,/);
  });

  it("keeps editor-authored data URIs that the bridge never inlined", () => {
    const authored = encode(deck("data:image/png;base64,AAAA"));
    expect(decode(restoreAssetUris(authored, new Map([["data:image/jpeg;base64,AQIDBA==", "mop-asset:/media/a.jpg"]]))))
      .toEqual(decode(authored));
  });
});

/**
 * The gesture the host reads a selection on.
 *
 * PowerPoint has no selection event to subscribe to, so the embed reports that
 * the user did something and the host decides whether to spend a script on it.
 * What matters here is the debounce: a drag across a slide is one message, not
 * one per frame of the gesture.
 */
describe("selection notifier", () => {
  afterEach(() => vi.useRealTimers());

  it("reports one gesture per burst, and nothing after it is removed", () => {
    vi.useFakeTimers();
    const notify = vi.fn();
    const stop = installSelectionNotifier(window, notify, 50);

    window.dispatchEvent(new Event("pointerup"));
    window.dispatchEvent(new Event("pointerup"));
    vi.advanceTimersByTime(49);
    expect(notify).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(notify).toHaveBeenCalledTimes(1);

    // Keyboard selection counts too: Tab between placeholders, arrows on a shape.
    window.dispatchEvent(new Event("keyup"));
    vi.advanceTimersByTime(50);
    expect(notify).toHaveBeenCalledTimes(2);

    stop();
    window.dispatchEvent(new Event("pointerup"));
    vi.advanceTimersByTime(50);
    expect(notify).toHaveBeenCalledTimes(2);
  });
});

/**
 * The editor's save session, handed to the host.
 *
 * Before this the host learned a deck had changed only from the snapshot PUT,
 * and the local session only PUTs on an explicit save — so a user who typed
 * and never pressed ⌘S was never dirty, and the host's export shipped the
 * previous snapshot. The bridge now forwards the session's own state and
 * answers a flush request with the session's own `flush`.
 */
describe("editor save bridge", () => {
  afterEach(() => vi.useRealTimers());

  const clean: EditorSaveState = { documentRevision: 1, pendingChangeCount: 0, status: "saved" };
  const typing: EditorSaveState = { documentRevision: 2, pendingChangeCount: 1, status: "dirty" };

  function workbench(initial: EditorSaveState, flushed = 5) {
    const listeners = new Set<(state: EditorSaveState) => void>();
    let state = initial;
    const handle: EditorWorkbenchHandle = {
      fileId: "deck",
      workbench: {},
      flush: vi.fn(async () => {
        state = { ...state, pendingChangeCount: 0, status: "saved" };
        return flushed;
      }),
      getSaveState: () => state,
      subscribeSaveState: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    };
    return {
      handle,
      report(next: EditorSaveState) {
        state = next;
        for (const listener of listeners) listener(next);
      },
      mount() {
        window.dispatchEvent(new CustomEvent("officedex:pptx-workbench-ready", { detail: handle }));
      },
      unmount() {
        window.dispatchEvent(new CustomEvent("officedex:pptx-workbench-detached", { detail: { fileId: "deck", workbench: handle.workbench } }));
      },
    };
  }

  const dirtyPosts = (post: ReturnType<typeof vi.fn>) => post.mock.calls.map((call) => call[0].dirty);

  it("reads pending edits, and a failed or stalled save, as unsaved", () => {
    expect(editorHoldsEdits(undefined)).toBe(false);
    expect(editorHoldsEdits(clean)).toBe(false);
    expect(editorHoldsEdits({ documentRevision: 1, pendingChangeCount: 0, status: "clean" })).toBe(false);
    expect(editorHoldsEdits(typing)).toBe(true);
    expect(editorHoldsEdits({ documentRevision: 1, pendingChangeCount: 0, status: "saving" })).toBe(true);
    expect(editorHoldsEdits({ documentRevision: 1, pendingChangeCount: 0, status: "failed" })).toBe(true);
  });

  it("tells the host the moment the editor holds an edit, and only when that changes", () => {
    const post = vi.fn();
    const bridge = createEditorSaveBridge(window, post);
    const editor = workbench(clean);
    editor.mount();
    expect(dirtyPosts(post)).toEqual([false]);

    editor.report(typing);
    editor.report({ ...typing, pendingChangeCount: 2 });
    expect(dirtyPosts(post)).toEqual([false, true]);

    editor.report({ ...clean, status: "saving" });
    editor.report(clean);
    expect(dirtyPosts(post)).toEqual([false, true, false]);
    bridge.dispose();
  });

  it("flushes through the session and reports what it persisted", async () => {
    const post = vi.fn();
    const bridge = createEditorSaveBridge(window, post);
    const editor = workbench(typing, 7);
    editor.mount();
    expect(dirtyPosts(post)).toEqual([true]);

    await expect(bridge.flush()).resolves.toEqual({ revision: 7 });
    expect(editor.handle.flush).toHaveBeenCalledWith("explicit-save");
    // The flush emptied the journal, so the editor no longer holds edits.
    expect(dirtyPosts(post)).toEqual([true, false]);
    bridge.dispose();
  });

  it("commits the debounced notes buffer before saving, even while session state is clean", async () => {
    const bridge = createEditorSaveBridge(window, vi.fn());
    const editor = workbench(clean, 8);
    let persisted = "old notes";
    let model = "old notes";
    Object.assign(editor.handle, { workbench: { core: { view: { notesArea: {
      flushPendingNotesText: () => { model = "last keystroke"; },
    } } } } });
    vi.mocked(editor.handle.flush).mockImplementation(async () => { persisted = model; return 8; });
    editor.mount();
    await expect(bridge.flush()).resolves.toEqual({ revision: 8 });
    expect(persisted).toBe("last keystroke");
    bridge.dispose();
  });

  it("waits for a workbench that is still mounting, and gives up on one that never does", async () => {
    vi.useFakeTimers();
    const post = vi.fn();
    const bridge = createEditorSaveBridge(window, post, { workbenchReadyTimeoutMs: 1_000 });
    const early = bridge.flush();
    const editor = workbench(clean, 3);
    vi.advanceTimersByTime(500);
    editor.mount();
    await expect(early).resolves.toEqual({ revision: 3 });

    editor.unmount();
    const late = bridge.flush();
    const outcome = late.then(
      () => "resolved",
      (error: Error) => error.message,
    );
    vi.advanceTimersByTime(1_001);
    expect(await outcome).toMatch(/cannot be saved yet/);
    bridge.dispose();
  });

  it("surfaces the session's own failure instead of pretending the save happened", async () => {
    const post = vi.fn();
    const bridge = createEditorSaveBridge(window, post);
    const editor = workbench(typing);
    (editor.handle.flush as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("Presentation save session is unavailable."));
    editor.mount();
    await expect(bridge.flush()).rejects.toThrow(/save session is unavailable/);
    // Still dirty: nothing left the journal.
    expect(dirtyPosts(post)).toEqual([true]);
    bridge.dispose();
  });

  it("reports clean after a flush and dirty again on the next edit, export or not", async () => {
    const post = vi.fn();
    const bridge = createEditorSaveBridge(window, post);
    const editor = workbench(typing);
    editor.mount();
    await bridge.flush();
    // Whether that snapshot has been exported is the host's to track; folding
    // it in here froze the report at "dirty" after the first save, and every
    // edit after it went unannounced.
    expect(dirtyPosts(post)).toEqual([true, false]);
    editor.report(typing);
    expect(dirtyPosts(post)).toEqual([true, false, true]);
    bridge.dispose();
  });

  it("ignores a stale workbench detaching after a swap", () => {
    const post = vi.fn();
    const bridge = createEditorSaveBridge(window, post);
    const first = workbench(typing);
    first.mount();
    const second = workbench(clean);
    second.mount();
    expect(dirtyPosts(post)).toEqual([true, false]);
    first.unmount();
    expect(bridge.workbench).toBe(second.handle);
    // The first editor's state no longer reaches the host.
    first.report({ ...typing, pendingChangeCount: 9 });
    expect(dirtyPosts(post)).toEqual([true, false]);
    bridge.dispose();
  });
});

describe("editor zoom bridge", () => {
  function workbench(initialScale = 0.6) {
    let scale = initialScale;
    const mainArea = { zoomMode: "fit" as "fit" | "custom" };
    const listeners = new Set<() => void>();
    const emit = (next: number) => {
      if (next === scale) return;
      scale = next;
      for (const listener of [...listeners]) listener();
    };
    const views = {
      getScale: () => scale,
      setScale: vi.fn((next: number) => {
        mainArea.zoomMode = "custom";
        emit(next);
      }),
      zoomToFit: vi.fn(() => {
        mainArea.zoomMode = "fit";
        emit(0.6);
      }),
      on: (_event: "zoomScaleDidChange", listener: () => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    };
    // A fitted slide following the window: the scale moves, the mode does not.
    const resize = (next: number) => emit(next);
    return { handle: { editorFacade: { views }, core: { view: { mainArea } } }, views, resize, listeners };
  }

  function mount(target: EventTarget, handle: object) {
    target.dispatchEvent(new CustomEvent("officedex:pptx-workbench-ready", { detail: { workbench: handle } }));
  }

  it("opens a workbench at the host zoom and reports only the user's changes", () => {
    const target = new EventTarget() as unknown as Window;
    const post = vi.fn();
    const bridge = createEditorZoomBridge(target, post);
    bridge.set(80);
    const deck = workbench();
    mount(target, deck.handle);
    expect(deck.views.setScale).toHaveBeenCalledWith(0.8);
    expect(post).not.toHaveBeenCalled();

    deck.views.setScale(1.1);
    expect(post.mock.calls).toEqual([[{ type: "presentation:zoom-changed", zoom: 110 }]]);
    deck.views.zoomToFit();
    deck.resize(0.7);
    deck.resize(0.9);
    expect(post.mock.calls.slice(1)).toEqual([[{ type: "presentation:zoom-changed", zoom: "fit" }]]);
    bridge.dispose();
    expect(deck.listeners.size).toBe(0);
  });

  it("a fitted opening stays quiet through resizes, and a remount opens where the user left off", () => {
    const target = new EventTarget() as unknown as Window;
    const post = vi.fn();
    const bridge = createEditorZoomBridge(target, post);
    bridge.set("fit");
    const first = workbench();
    mount(target, first.handle);
    first.resize(0.75);
    expect(post).not.toHaveBeenCalled();
    first.views.setScale(1.5);
    target.dispatchEvent(new CustomEvent("officedex:pptx-workbench-detached", { detail: { workbench: first.handle } }));
    const second = workbench();
    mount(target, second.handle);
    expect(second.views.setScale).toHaveBeenCalledWith(1.5);
    expect(post.mock.calls).toEqual([[{ type: "presentation:zoom-changed", zoom: 150 }]]);
    bridge.dispose();
  });
});
