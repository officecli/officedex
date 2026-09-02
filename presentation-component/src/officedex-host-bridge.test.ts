import { describe, expect, it } from "vitest";
import { inlineAssetUris, restoreAssetUris } from "./officedex-host-bridge";

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
