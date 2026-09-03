import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RecentFile } from "../shared/types";
import { useRecentFiles } from "./useRecentFiles";

vi.mock("./bridge", () => ({
  officecli: {
    listRecentFiles: vi.fn(),
    removeRecentFile: vi.fn(),
  },
}));

const { officecli } = await import("./bridge");
const listRecentFiles = officecli.listRecentFiles as unknown as ReturnType<typeof vi.fn>;
const removeRecentFile = officecli.removeRecentFile as unknown as ReturnType<typeof vi.fn>;

// Promise.withResolvers exists at runtime here but not in this project's lib
// target, and these tests need to settle two requests in a chosen order.
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const file = (filePath: string, extra: Partial<RecentFile> = {}): RecentFile =>
  ({ filePath, fileName: filePath, documentType: "pptx", modifiedAt: "", ...extra }) as RecentFile;

describe("useRecentFiles", () => {
  beforeEach(() => {
    listRecentFiles.mockReset();
    removeRecentFile.mockReset();
  });

  // Switching workspace, reconnecting and retrying all call refresh, so several
  // requests are in flight at once and they do not come back in order. A slow
  // reply from the workspace the user just left must not land on the list.
  it("ignores a reply that a newer request has superseded", async () => {
    const slow = deferred<RecentFile[]>();
    const fast = deferred<RecentFile[]>();
    listRecentFiles.mockReturnValueOnce(slow.promise).mockReturnValueOnce(fast.promise);

    const { result } = renderHook(() => useRecentFiles("timed out"));

    await act(async () => {
      void result.current.refresh("workspace-a");
      void result.current.refresh("workspace-b");
      fast.resolve([file("/b.pptx")]);
      slow.resolve([file("/a.pptx")]);
      await Promise.resolve();
    });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.files.map((f) => f.filePath)).toEqual(["/b.pptx"]);
  });

  // Same for a failure: the abandoned request's error is not the user's problem.
  it("ignores a failure from a superseded request", async () => {
    const stale = deferred<RecentFile[]>();
    const current = deferred<RecentFile[]>();
    listRecentFiles.mockReturnValueOnce(stale.promise).mockReturnValueOnce(current.promise);

    const { result } = renderHook(() => useRecentFiles("timed out"));

    await act(async () => {
      void result.current.refresh("workspace-a");
      void result.current.refresh("workspace-b");
      stale.reject(new Error("workspace-a is gone"));
      current.resolve([file("/b.pptx")]);
      await Promise.resolve();
    });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeUndefined();
    expect(result.current.files.map((f) => f.filePath)).toEqual(["/b.pptx"]);
  });

  // The bridge exiting is not something the in-flight request will ever report
  // -- it simply never answers. Without invalidating it, a reply arriving after
  // the bridge came back would erase the message telling the user it was gone.
  it("keeps the abandon reason when the request it replaced finally answers", async () => {
    const pending = deferred<RecentFile[]>();
    listRecentFiles.mockReturnValueOnce(pending.promise);

    const { result } = renderHook(() => useRecentFiles("timed out"));

    await act(async () => {
      void result.current.refresh();
      result.current.abandon("bridge unavailable");
      pending.resolve([file("/late.pptx")]);
      await Promise.resolve();
    });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("bridge unavailable");
    expect(result.current.files).toEqual([]);
  });

  it("reports a request that outlives the timeout", async () => {
    vi.useFakeTimers();
    listRecentFiles.mockReturnValueOnce(new Promise<RecentFile[]>(() => {}));

    const { result } = renderHook(() => useRecentFiles("took too long"));
    let refreshed: Promise<void>;
    act(() => {
      refreshed = result.current.refresh();
    });
    await act(async () => {
      vi.advanceTimersByTime(8_000);
      await refreshed!;
    });

    expect(result.current.error).toBe("took too long");
    expect(result.current.loading).toBe(false);
    vi.useRealTimers();
  });

  it("tells the bridge to forget a removed file", async () => {
    listRecentFiles.mockResolvedValueOnce([file("/a.pptx"), file("/b.pptx")]);
    removeRecentFile.mockResolvedValueOnce(undefined);

    const { result } = renderHook(() => useRecentFiles("timed out"));
    await act(async () => { await result.current.refresh(); });
    await act(async () => { await result.current.remove("/a.pptx"); });

    expect(removeRecentFile).toHaveBeenCalledWith("/a.pptx");
    expect(result.current.files.map((f) => f.filePath)).toEqual(["/b.pptx"]);
  });

  // Deleting a document already removes its files on the bridge side, so this
  // only prunes the list.
  it("forgets a deleted document's files without calling the bridge", async () => {
    listRecentFiles.mockResolvedValueOnce([
      file("/a.pptx", { taskId: "task-1" }),
      file("/b.pptx", { taskId: "task-2" }),
    ]);

    const { result } = renderHook(() => useRecentFiles("timed out"));
    await act(async () => { await result.current.refresh(); });
    act(() => { result.current.forgetWhere((f) => f.taskId === "task-1"); });

    expect(removeRecentFile).not.toHaveBeenCalled();
    expect(result.current.files.map((f) => f.filePath)).toEqual(["/b.pptx"]);
  });
});
