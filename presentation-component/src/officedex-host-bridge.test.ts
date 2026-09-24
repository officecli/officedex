import { afterEach, describe, expect, it, vi } from "vitest";
import { inlineAssetUris, installSelectionNotifier, restoreAssetUris } from "./officedex-host-bridge";

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
