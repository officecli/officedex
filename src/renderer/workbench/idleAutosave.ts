import { useCallback, useEffect, useMemo, useRef } from "react";

/**
 * Shared idle window for Word, Excel and PowerPoint manual-edit autosave.
 * Every save exports the whole file, so a burst of keystrokes must collapse
 * into one write after editing pauses.
 */
export const AUTOSAVE_IDLE_MS = 1_500;

/** Substring the Go host pins on a refused overwrite (see SourceChangedMarker). */
export const SOURCE_CHANGED_MARKER = "changed outside OfficeDex";

export function isSaveConflict(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes(SOURCE_CHANGED_MARKER) || message.includes("changed externally");
}

/**
 * Debounces `save` across the three office editors. `canSchedule` parks the
 * timer (no path, a disk conflict); `flush` runs a due save immediately so
 * close does not wait out the idle window.
 */
export function useIdleAutosave(options: {
  idleMs?: number;
  save: () => Promise<void> | void;
  canSchedule?: () => boolean;
  isDirty?: () => boolean;
}): {
  schedule: () => void;
  cancel: () => void;
  request: () => void;
  flush: () => Promise<void>;
} {
  const timerRef = useRef<number | null>(null);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const allowed = () => optionsRef.current.canSchedule?.() ?? true;

  const cancel = useCallback(() => {
    if (timerRef.current === null) return;
    window.clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);

  const request = useCallback(() => {
    cancel();
    if (!allowed()) return;
    void Promise.resolve(optionsRef.current.save()).catch(() => {
      // Keep the document dirty; the next edit or an explicit save retries.
    });
  }, [cancel]);

  const schedule = useCallback(() => {
    if (!allowed()) return;
    cancel();
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      request();
    }, optionsRef.current.idleMs ?? AUTOSAVE_IDLE_MS);
  }, [cancel, request]);

  const flush = useCallback(async () => {
    const scheduled = timerRef.current !== null;
    cancel();
    if (!allowed()) return;
    if (scheduled || optionsRef.current.isDirty?.()) {
      await optionsRef.current.save();
    }
  }, [cancel]);

  useEffect(() => () => cancel(), [cancel]);

  return useMemo(
    () => ({ schedule, cancel, request, flush }),
    [schedule, cancel, request, flush],
  );
}
