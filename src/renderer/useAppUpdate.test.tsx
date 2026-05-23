import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { AppUpdateEvent, DesktopAPI } from "../shared/types";
import { useAppUpdate } from "./useAppUpdate";
import { officecli } from "./bridge";

type EventListener = (event: AppUpdateEvent) => void;

async function flush() {
  // Drain the microtask queue after a fake-timer advance so React state
  // updates queued from awaited promises propagate before assertions.
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

interface Harness {
  eventListeners: EventListener[];
  checkSpy: ReturnType<typeof vi.fn>;
  downloadSpy: ReturnType<typeof vi.fn>;
  installSpy: ReturnType<typeof vi.fn>;
  cancelSpy: ReturnType<typeof vi.fn>;
  emit: (event: AppUpdateEvent) => void;
}

let originals: Partial<DesktopAPI>;
let harness: Harness;

function installAppUpdateMocks(initial: { mandatory?: boolean; updateAvailable?: boolean; version?: string } = {}): Harness {
  const listeners: EventListener[] = [];
  const versionLatest = initial.version ?? "0.2.0";
  const updateAvailable = initial.updateAvailable ?? true;
  const mandatory = initial.mandatory ?? false;
  const release = updateAvailable
    ? {
        version: versionLatest,
        notes: "Notes for " + versionLatest,
        minSupportedVersion: mandatory ? "0.5.0" : "0.1.0",
        mandatory,
        assets: { "darwin-arm64": { url: "https://x/y.dmg", sha256: "deadbeef", size: 1 } },
      }
    : null;
  const status = {
    currentVersion: "0.1.0",
    latestVersion: updateAvailable ? versionLatest : null,
    updateAvailable,
    mandatory,
    downloading: false,
    downloadedPath: null,
    lastCheckedAt: new Date("2026-05-22T00:00:00Z").toISOString(),
    lastError: null,
  };
  const checkSpy = vi.fn(async () => ({ release, status }));
  const downloadSpy = vi.fn(async () => "/tmp/OfficeDex-0.2.0.dmg");
  const installSpy = vi.fn(async () => undefined);
  const cancelSpy = vi.fn(async () => undefined);
  officecli.checkAppUpdate = checkSpy as unknown as DesktopAPI["checkAppUpdate"];
  officecli.downloadAppUpdate = downloadSpy as unknown as DesktopAPI["downloadAppUpdate"];
  officecli.installAppUpdate = installSpy as unknown as DesktopAPI["installAppUpdate"];
  officecli.cancelAppUpdate = cancelSpy as unknown as DesktopAPI["cancelAppUpdate"];
  officecli.onAppUpdateEvent = ((callback: EventListener) => {
    listeners.push(callback);
    return () => {
      const idx = listeners.indexOf(callback);
      if (idx >= 0) listeners.splice(idx, 1);
    };
  }) as unknown as DesktopAPI["onAppUpdateEvent"];
  return {
    eventListeners: listeners,
    checkSpy,
    downloadSpy,
    installSpy,
    cancelSpy,
    emit(event) {
      for (const fn of listeners.slice()) fn(event);
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  originals = {
    checkAppUpdate: officecli.checkAppUpdate,
    downloadAppUpdate: officecli.downloadAppUpdate,
    installAppUpdate: officecli.installAppUpdate,
    cancelAppUpdate: officecli.cancelAppUpdate,
    onAppUpdateEvent: officecli.onAppUpdateEvent,
  };
  harness = installAppUpdateMocks();
});

afterEach(() => {
  for (const k of Object.keys(originals) as Array<keyof DesktopAPI>) {
    (officecli as unknown as Record<string, unknown>)[k] = originals[k] as unknown;
  }
  vi.useRealTimers();
});

describe("useAppUpdate", () => {
  it("delays the first check by 4s and transitions to available when an update exists", async () => {
    const { result } = renderHook(() => useAppUpdate());
    expect(harness.checkSpy).not.toHaveBeenCalled();
    expect(result.current.phase).toBe("idle");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4_001);
    });
    await flush();
    expect(harness.checkSpy).toHaveBeenCalledTimes(1);
    expect(result.current.phase).toBe("available");
    expect(result.current.release?.version).toBe("0.2.0");
  });

  it("re-checks every 4 hours after the first delayed check", async () => {
    renderHook(() => useAppUpdate());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4_001);
    });
    await flush();
    expect(harness.checkSpy).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4 * 60 * 60 * 1000);
    });
    await flush();
    expect(harness.checkSpy).toHaveBeenCalledTimes(2);
  });

  it("dismiss() hides banner for non-mandatory but is a no-op when mandatory", async () => {
    harness = installAppUpdateMocks({ mandatory: true });
    const { result } = renderHook(() => useAppUpdate());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4_001);
    });
    await flush();
    expect(result.current.status.mandatory).toBe(true);
    act(() => result.current.dismiss());
    expect(result.current.dismissed).toBe(false);
  });

  it("dismiss() works when release is non-mandatory", async () => {
    const { result } = renderHook(() => useAppUpdate());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4_001);
    });
    await flush();
    expect(result.current.phase).toBe("available");
    act(() => result.current.dismiss());
    expect(result.current.dismissed).toBe(true);
  });

  it("downloaded event transitions phase and exposes downloaded path", async () => {
    const { result } = renderHook(() => useAppUpdate());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4_001);
    });
    await flush();
    expect(result.current.phase).toBe("available");
    act(() => {
      harness.emit({ type: "downloaded", downloadedPath: "/tmp/x.dmg" });
    });
    expect(result.current.phase).toBe("downloaded");
    expect(result.current.status.downloadedPath).toBe("/tmp/x.dmg");
  });

  it("auto-installs once when force update finishes downloading", async () => {
    harness = installAppUpdateMocks({ mandatory: true });
    const { result } = renderHook(() => useAppUpdate());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4_001);
    });
    await flush();
    expect(result.current.status.mandatory).toBe(true);
    act(() => {
      harness.emit({ type: "downloaded", downloadedPath: "/tmp/x.dmg" });
    });
    await flush();
    expect(harness.installSpy).toHaveBeenCalledTimes(1);
    act(() => {
      harness.emit({ type: "downloaded", downloadedPath: "/tmp/x.dmg" });
    });
    await flush();
    expect(harness.installSpy).toHaveBeenCalledTimes(1);
  });

  it("progress event updates bytesDone/bytesTotal", async () => {
    const { result } = renderHook(() => useAppUpdate());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4_001);
    });
    await flush();
    act(() => {
      harness.emit({ type: "progress", bytesDone: 512, bytesTotal: 2048 });
    });
    expect(result.current.progress).toEqual({ bytesDone: 512, bytesTotal: 2048 });
    expect(result.current.phase).toBe("downloading");
  });
});
