import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  AppUpdateEvent,
  AppUpdateRelease,
  AppUpdateStatus,
} from "../shared/types";
import { officecli } from "./bridge";

const FIRST_CHECK_DELAY_MS = 4_000;
const POLL_INTERVAL_MS = 4 * 60 * 60 * 1000; // 4 hours
const FOCUS_RECHECK_THRESHOLD_MS = 30 * 60 * 1000; // 30 minutes

export type UpdatePhase =
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "downloaded"
  | "installing"
  | "error";

export interface UseAppUpdateValue {
  status: AppUpdateStatus;
  release: AppUpdateRelease | null;
  phase: UpdatePhase;
  progress: { bytesDone: number; bytesTotal: number };
  error: string | null;
  dismissed: boolean;
  check: () => Promise<void>;
  download: () => Promise<void>;
  install: () => Promise<void>;
  cancel: () => Promise<void>;
  dismiss: () => void;
}

const INITIAL_STATUS: AppUpdateStatus = {
  currentVersion: "0.0.0",
  latestVersion: null,
  updateAvailable: false,
  mandatory: false,
  downloading: false,
  downloadedPath: null,
  lastCheckedAt: null,
  lastError: null,
};

export function useAppUpdate(): UseAppUpdateValue {
  const [status, setStatus] = useState<AppUpdateStatus>(INITIAL_STATUS);
  const [release, setRelease] = useState<AppUpdateRelease | null>(null);
  const [phase, setPhase] = useState<UpdatePhase>("idle");
  const [progress, setProgress] = useState({ bytesDone: 0, bytesTotal: 0 });
  const [error, setError] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const lastCheckedAtRef = useRef<number>(0);
  const autoInstallTriggeredRef = useRef(false);

  const check = useCallback(async () => {
    setPhase((current) => (current === "downloading" ? current : "checking"));
    try {
      const result = await officecli.checkAppUpdate();
      lastCheckedAtRef.current = Date.now();
      setStatus(result.status);
      setRelease(result.release);
      setError(null);
      if (result.status.mandatory) {
        setDismissed(false);
      }
      setPhase((current) => {
        if (current === "downloading" || current === "downloaded" || current === "installing") {
          return current;
        }
        return result.status.updateAvailable ? "available" : "idle";
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      setPhase("error");
    }
  }, []);

  const download = useCallback(async () => {
    setPhase("downloading");
    setError(null);
    try {
      await officecli.downloadAppUpdate();
      // downloaded path arrives via event; phase transition happens there
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      setPhase("error");
    }
  }, []);

  const install = useCallback(async () => {
    setPhase("installing");
    try {
      await officecli.installAppUpdate();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      setPhase("error");
    }
  }, []);

  const cancel = useCallback(async () => {
    await officecli.cancelAppUpdate().catch(() => undefined);
    setPhase((current) => (current === "downloading" ? "available" : current));
  }, []);

  const dismiss = useCallback(() => {
    if (status.mandatory) {
      return;
    }
    setDismissed(true);
  }, [status.mandatory]);

  // Reset dismissed on a freshly-discovered higher version.
  useEffect(() => {
    if (!release) return;
    setDismissed(false);
  }, [release?.version]);

  // Event subscription.
  useEffect(() => {
    const off = officecli.onAppUpdateEvent((event: AppUpdateEvent) => {
      switch (event.type) {
        case "status":
          if (event.status) setStatus(event.status);
          if (event.release) setRelease(event.release);
          return;
        case "progress":
          setProgress({
            bytesDone: event.bytesDone ?? 0,
            bytesTotal: event.bytesTotal ?? 0,
          });
          setPhase("downloading");
          return;
        case "downloaded":
          setPhase("downloaded");
          setStatus((s) => ({ ...s, downloadedPath: event.downloadedPath, downloading: false }));
          return;
        case "installed":
          setPhase("installing");
          return;
        case "error":
          setError(event.message);
          setPhase("error");
          return;
      }
    });
    return off;
  }, []);

  // Auto-install on force-update + downloaded.
  useEffect(() => {
    if (phase !== "downloaded") return;
    if (!status.mandatory) return;
    if (autoInstallTriggeredRef.current) return;
    autoInstallTriggeredRef.current = true;
    void install();
  }, [phase, status.mandatory, install]);

  // First-check + 4h polling.
  useEffect(() => {
    const firstTimer = setTimeout(() => {
      void check();
    }, FIRST_CHECK_DELAY_MS);
    const intervalTimer = setInterval(() => {
      void check();
    }, POLL_INTERVAL_MS);
    return () => {
      clearTimeout(firstTimer);
      clearInterval(intervalTimer);
    };
  }, [check]);

  // Focus-triggered re-check.
  useEffect(() => {
    function onFocus() {
      const elapsed = Date.now() - lastCheckedAtRef.current;
      if (elapsed > FOCUS_RECHECK_THRESHOLD_MS) {
        void check();
      }
    }
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [check]);

  const value = useMemo<UseAppUpdateValue>(
    () => ({ status, release, phase, progress, error, dismissed, check, download, install, cancel, dismiss }),
    [status, release, phase, progress, error, dismissed, check, download, install, cancel, dismiss],
  );
  return value;
}
