import { useCallback, useEffect, useRef, useState } from "react";
import { officecli } from "../bridge";
import { parseWorkbookSnapshot } from "./workbookData";
import type { WorkbookDataSnapshot } from "./types";

export function useWorkbookDataSource(previewToken: string | undefined, sourceRevision = 0) {
  const [snapshot, setSnapshot] = useState<WorkbookDataSnapshot>();
  const [loading, setLoading] = useState(Boolean(previewToken));
  const [error, setError] = useState<string>();
  const fingerprintRef = useRef<string | undefined>(undefined);

  const refresh = useCallback(async (showLoading = false) => {
    if (!previewToken) return;
    if (showLoading) setLoading(true);
    try {
      const { data } = await officecli.readArtifactFile(previewToken);
      const next = parseWorkbookSnapshot(data);
      if (next.fingerprint !== fingerprintRef.current) {
        fingerprintRef.current = next.fingerprint;
        setSnapshot(next);
      } else {
        setSnapshot((current) => current ? { ...current, loadedAt: next.loadedAt } : next);
      }
      setError(undefined);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoading(false);
    }
  }, [previewToken]);

  useEffect(() => {
    fingerprintRef.current = undefined;
    setSnapshot(undefined);
    setError(undefined);
    if (!previewToken) {
      setLoading(false);
      return;
    }
    void refresh(true);
    const timer = window.setInterval(() => void refresh(false), 1500);
    return () => window.clearInterval(timer);
  }, [previewToken, refresh]);

  useEffect(() => {
    if (previewToken && sourceRevision > 0) void refresh(false);
  }, [previewToken, refresh, sourceRevision]);

  return { snapshot, loading, error, refresh: () => refresh(true) };
}
