import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  AppUpdateEvent,
  AppUpdateRelease,
  AppUpdateStatus,
} from "../shared/types";
import { useDesktopApi } from "./services/desktopApi";

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
  updateChannel: undefined,
  manifestUrl: undefined,
};

export function useAppUpdate(): UseAppUpdateValue {
  const api = useDesktopApi();
  const [status, setStatus] = useState<AppUpdateStatus>(INITIAL_STATUS);
  const [release, setRelease] = useState<AppUpdateRelease | null>(null);
  const [phase, setPhase] = useState<UpdatePhase>("idle");
  const [progress, setProgress] = useState({ bytesDone: 0, bytesTotal: 0 });
  const [error, setError] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const lastCheckedAtRef = useRef<number>(0);
  const autoInstallTriggeredRef = useRef(false);
  const requestEpoch = useRef(0);
  const observedEventRef = useRef(false);
  const channelRef = useRef<string | undefined>(undefined);
  const acceptStatus = useCallback((next: AppUpdateStatus) => {
    if (next.updateChannel && channelRef.current && next.updateChannel !== channelRef.current) {
      requestEpoch.current += 1;
      setRelease(null);
      setPhase(next.downloading ? "downloading" : next.downloadedPath ? "downloaded" : next.updateAvailable ? "available" : "idle");
      setError(null);
      setProgress({ bytesDone: 0, bytesTotal: 0 });
      setDismissed(false);
      autoInstallTriggeredRef.current = false;
    }
    channelRef.current = next.updateChannel;
    setStatus(next);
  }, []);

  const check = useCallback(async () => {
    const epoch = requestEpoch.current;
    setPhase((current) => (["downloading", "downloaded", "installing"].includes(current) ? current : "checking"));
    try {
      const result = await api.checkAppUpdate();
      if (epoch !== requestEpoch.current) return;
      lastCheckedAtRef.current = Date.now();
      acceptStatus(result.status);
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
      if (epoch !== requestEpoch.current) return;
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      setPhase("error");
    }
  }, []);

  const download = useCallback(async () => {
    setPhase("downloading");
    setError(null);
    try {
      await api.downloadAppUpdate();
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
      await api.installAppUpdate();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      setPhase("error");
      autoInstallTriggeredRef.current = false;
    }
  }, []);

  const cancel = useCallback(async () => {
    await api.cancelAppUpdate().catch(() => undefined);
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
    const off = api.onAppUpdateEvent((event: AppUpdateEvent) => {
      observedEventRef.current = true;
      switch (event.type) {
        case "status":
          if (event.status) acceptStatus(event.status);
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
          // A finished download is 100%, whatever the last progress event said.
          // Without this the byte counter keeps whatever fraction it stopped on
          // (38.94% in the recorded case) and anything rendering a bar from it
          // contradicts the "download complete" copy sitting next to it.
          setProgress((p) => (p.bytesTotal > 0 ? { bytesDone: p.bytesTotal, bytesTotal: p.bytesTotal } : p));
          setStatus((s) => ({ ...s, downloadedPath: event.downloadedPath, downloading: false }));
          return;
        case "installed":
          setPhase("installing");
          return;
        case "error":
          setError(event.message);
          setPhase("error");
          // Let a retry install itself again. The latch exists to stop the
          // effect below firing twice for one download, not to spend the user's
          // only automatic install on an attempt that failed.
          autoInstallTriggeredRef.current = false;
          return;
      }
    });
    return off;
  }, []);

  // Read the baked/persisted channel before the delayed network check, including
  // offline starts. Do not overwrite a newer event with a delayed bridge reply.
  useEffect(() => {
    let live = true;
    const epoch = requestEpoch.current;
    void api.getAppUpdateStatus().then((next) => {
      if (live && epoch === requestEpoch.current && !observedEventRef.current) acceptStatus(next);
    }).catch(() => undefined);
    return () => { live = false; };
  }, [api, acceptStatus]);

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
