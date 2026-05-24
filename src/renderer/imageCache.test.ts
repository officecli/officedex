import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { acquireBlob, releaseBlob } from "./imageCache";

describe("imageCache", () => {
  let urlCounter = 0;
  let createdUrls: string[];
  let revokedUrls: string[];

  beforeEach(() => {
    urlCounter = 0;
    createdUrls = [];
    revokedUrls = [];
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn((_blob: Blob) => {
        const url = `blob:test/${++urlCounter}`;
        createdUrls.push(url);
        return url;
      }),
      revokeObjectURL: vi.fn((url: string) => {
        revokedUrls.push(url);
      }),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("revokes blob URL created after the entry was evicted (race fix)", async () => {
    let resolveFactory!: (blob: Blob) => void;
    const factory = () =>
      new Promise<Blob>((resolve) => {
        resolveFactory = resolve;
      });

    const acquired = acquireBlob("race-key", factory);
    // Simulate caller un-mounting before the factory resolves.
    releaseBlob("race-key");
    // Now the factory resolves — the URL was created after eviction.
    resolveFactory(new Blob(["x"]));
    const url = await acquired;

    expect(createdUrls).toEqual([url]);
    expect(revokedUrls).toEqual([url]);
  });

  it("revokes blob URL on normal release after factory resolves", async () => {
    const factory = () => Promise.resolve(new Blob(["y"]));
    const url = await acquireBlob("normal-key", factory);
    expect(createdUrls).toEqual([url]);
    expect(revokedUrls).toEqual([]);

    releaseBlob("normal-key");
    expect(revokedUrls).toEqual([url]);
  });

  it("shares the blob URL across multiple acquirers until refcount hits zero", async () => {
    const factory = vi.fn(() => Promise.resolve(new Blob(["z"])));
    const url1 = await acquireBlob("shared-key", factory);
    const url2 = await acquireBlob("shared-key", factory);

    expect(factory).toHaveBeenCalledTimes(1);
    expect(url1).toBe(url2);

    releaseBlob("shared-key");
    expect(revokedUrls).toEqual([]);
    releaseBlob("shared-key");
    expect(revokedUrls).toEqual([url1]);
  });

  it("does not revoke when factory rejects (nothing created)", async () => {
    const factory = () => Promise.reject(new Error("nope"));
    await expect(acquireBlob("err-key", factory)).rejects.toThrow("nope");
    expect(createdUrls).toEqual([]);
    expect(revokedUrls).toEqual([]);
  });
});
