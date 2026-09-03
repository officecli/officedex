import { useCallback, useMemo, useRef, useState } from "react";
import type { RecentFile } from "../shared/types";
import { officecli } from "./bridge";
import { errorMessage } from "./utils/values";

const RECENT_FILES_TIMEOUT_MS = 8_000;

/**
 * Rejects with `message` if `promise` has not settled in time. The underlying
 * request is not cancelled -- nothing here can cancel a bridge call in flight
 * -- which is why refresh below also checks that its reply is still the newest
 * one before writing it.
 */
function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error(message)), timeoutMs);
    promise.then(
      (value) => {
        window.clearTimeout(timeout);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(timeout);
        reject(error);
      },
    );
  });
}

export interface RecentFilesState {
  files: RecentFile[];
  loading: boolean;
  error?: string;
  /** Reloads the list, optionally scoped to one workspace. */
  refresh: (workspaceId?: string) => Promise<void>;
  /** Tells the bridge to forget one file, then drops it from the list. */
  remove: (filePath: string) => Promise<void>;
  /**
   * Drops every matching file from the list without calling the bridge. This
   * runs after a document is deleted, which already removed its files there.
   */
  forgetWhere: (matches: (file: RecentFile) => boolean) => void;
  /**
   * Stops waiting on whatever request is in flight and shows `reason` instead.
   * The bridge exiting is not an error the request itself will ever report --
   * it just never answers -- and without invalidating it here a reply that
   * arrives after the bridge comes back would overwrite the message telling
   * the user the bridge is gone.
   */
  abandon: (reason: string) => void;
}

/**
 * useRecentFiles owns the home screen's recent-file list.
 *
 * Only the newest request may write to the state. Switching workspace, the
 * bridge reconnecting and the user retrying all call refresh, so several
 * requests are routinely in flight at once and they do not come back in order;
 * a slow reply from the previous workspace would otherwise land on top of the
 * current one's list.
 *
 * @param timeoutMessage shown when a request outlives the timeout, passed in
 * because the message is localised and this hook has no locale of its own.
 */
export function useRecentFiles(timeoutMessage: string): RecentFilesState {
  const [files, setFiles] = useState<RecentFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const requestRef = useRef(0);

  const refresh = useCallback(async (workspaceId?: string) => {
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    setLoading(true);
    setError(undefined);
    try {
      const next = await withTimeout(
        officecli.listRecentFiles(workspaceId),
        RECENT_FILES_TIMEOUT_MS,
        timeoutMessage,
      );
      if (requestRef.current !== requestId) return;
      setFiles(next);
    } catch (requestError) {
      if (requestRef.current !== requestId) return;
      setError(errorMessage(requestError));
    } finally {
      if (requestRef.current === requestId) setLoading(false);
    }
  }, [timeoutMessage]);

  const remove = useCallback(async (filePath: string) => {
    await officecli.removeRecentFile(filePath);
    setFiles((current) => current.filter((file) => file.filePath !== filePath));
  }, []);

  const forgetWhere = useCallback((matches: (file: RecentFile) => boolean) => {
    setFiles((current) => current.filter((file) => !matches(file)));
  }, []);

  const abandon = useCallback((reason: string) => {
    requestRef.current += 1;
    setLoading(false);
    setError(reason);
  }, []);

  // Callers hold this object in their own dependency arrays, so it has to be
  // stable across renders that did not change the list.
  return useMemo(
    () => ({ files, loading, error, refresh, remove, forgetWhere, abandon }),
    [files, loading, error, refresh, remove, forgetWhere, abandon],
  );
}
