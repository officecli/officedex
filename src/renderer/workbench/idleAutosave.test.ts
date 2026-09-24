import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AUTOSAVE_IDLE_MS, isSaveConflict, useIdleAutosave } from "./idleAutosave";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("useIdleAutosave", () => {
  it("uses a 1500ms idle window by default", () => {
    expect(AUTOSAVE_IDLE_MS).toBe(1_500);
  });

  it("coalesces a burst of schedule calls into one save", async () => {
    vi.useFakeTimers();
    const save = vi.fn(async () => undefined);
    const { result } = renderHook(() =>
      useIdleAutosave({ idleMs: 40, save, canSchedule: () => true, isDirty: () => true }),
    );
    act(() => {
      result.current.schedule();
      result.current.schedule();
      result.current.schedule();
    });
    expect(save).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(40);
    });
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("flush runs a pending save immediately and cancels the idle timer", async () => {
    vi.useFakeTimers();
    const save = vi.fn(async () => undefined);
    const { result } = renderHook(() =>
      useIdleAutosave({ idleMs: 40, save, canSchedule: () => true, isDirty: () => true }),
    );
    act(() => result.current.schedule());
    await act(async () => {
      await result.current.flush();
    });
    expect(save).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(40);
    });
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("does not schedule or flush when canSchedule is false", async () => {
    vi.useFakeTimers();
    const save = vi.fn(async () => undefined);
    const { result } = renderHook(() =>
      useIdleAutosave({ idleMs: 5, save, canSchedule: () => false, isDirty: () => true }),
    );
    act(() => result.current.schedule());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20);
    });
    await act(async () => {
      await result.current.flush();
    });
    expect(save).not.toHaveBeenCalled();
  });

  it("recognises host conflict errors from every office format", () => {
    expect(isSaveConflict(new Error("save pptx: source file changed outside OfficeDex; reopen it before saving"))).toBe(true);
    expect(isSaveConflict(new Error("save docx: source file changed outside OfficeDex; reopen it before saving"))).toBe(true);
    expect(isSaveConflict(new Error("xlsx editor: source XLSX changed externally"))).toBe(true);
    expect(isSaveConflict(new Error("export failed"))).toBe(false);
  });
});
