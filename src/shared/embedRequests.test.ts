import { describe, expect, it, vi } from "vitest";
import { PendingRequests } from "./embedRequests";

describe("PendingRequests", () => {
  it("settles a request by id and clears its timer", async () => {
    vi.useFakeTimers();
    const requests = new PendingRequests({ idPrefix: "t" });
    const id = requests.nextId();
    const reply = requests.open<string>(id, 1000, "timed out");
    expect(requests.resolve(id, "ok")).toBe(true);
    await expect(reply).resolves.toBe("ok");
    vi.advanceTimersByTime(2000);
    expect(requests.size).toBe(0);
    expect(requests.resolve(id, "again")).toBe(false);
    vi.useRealTimers();
  });

  it("rejects with the timeout message when no reply arrives", async () => {
    vi.useFakeTimers();
    const requests = new PendingRequests({ idPrefix: "t" });
    const reply = requests.open<string>(requests.nextId(), 500, "the editor did not answer");
    vi.advanceTimersByTime(600);
    await expect(reply).rejects.toThrow("the editor did not answer");
    expect(requests.size).toBe(0);
    vi.useRealTimers();
  });

  it("rejects everything still open on rejectAll", async () => {
    const requests = new PendingRequests({ idPrefix: "t" });
    const a = requests.open<string>(requests.nextId(), 60_000, "x");
    const b = requests.open<string>(requests.nextId(), 60_000, "x");
    requests.rejectAll(new Error("closed"));
    await expect(a).rejects.toThrow("closed");
    await expect(b).rejects.toThrow("closed");
    expect(requests.size).toBe(0);
  });

  it("generates ids that do not collide across two clients on one page", () => {
    const a = new PendingRequests({ idPrefix: "presentation" });
    const b = new PendingRequests({ idPrefix: "officedex" });
    expect(a.nextId()).not.toBe(b.nextId());
    expect(a.nextId().startsWith("presentation-")).toBe(true);
  });
});
