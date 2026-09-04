import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePolling } from "./usePolling";

describe("usePolling", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("runs immediately, then on every interval, and stops on unmount", async () => {
    const refresh = vi.fn();
    const { unmount } = renderHook(() => usePolling(refresh, 1_000));
    expect(refresh).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(2_500); });
    expect(refresh).toHaveBeenCalledTimes(3);
    unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
    expect(refresh).toHaveBeenCalledTimes(3);
  });

  it("never overlaps a refresh that is still running", async () => {
    let release!: () => void;
    const refresh = vi.fn(() => new Promise<void>((resolve) => { release = resolve; }));
    renderHook(() => usePolling(refresh, 100));
    await act(async () => { await vi.advanceTimersByTimeAsync(550); });
    expect(refresh).toHaveBeenCalledTimes(1);
    await act(async () => { release(); await vi.advanceTimersByTimeAsync(100); });
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("calls the latest refresh without restarting the interval, and a failing tick does not stop the loop", async () => {
    const first = vi.fn(() => { throw new Error("boom"); });
    const second = vi.fn();
    const { rerender } = renderHook(({ fn }) => usePolling(fn, 100, { immediate: false }), { initialProps: { fn: first as () => void } });
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(first).toHaveBeenCalledTimes(1);
    rerender({ fn: second });
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).toHaveBeenCalledTimes(1);
  });

  it("pauses while disabled and refreshes when the document becomes visible", async () => {
    const refresh = vi.fn();
    const { rerender } = renderHook(({ enabled }) => usePolling(refresh, 100, { enabled, refreshOnVisible: true }), { initialProps: { enabled: false } });
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    expect(refresh).not.toHaveBeenCalled();
    rerender({ enabled: true });
    // Let the immediate tick settle; a visibility refresh never overlaps it.
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(refresh).toHaveBeenCalledTimes(1);
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
    expect(refresh).toHaveBeenCalledTimes(2);
  });
});
