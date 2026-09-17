import { useEffect, useState } from "react";
import type { ReportCapabilityResult } from "../shared/types";
import { useDesktopApi } from "./services/desktopApi";

let cachedResult: ReportCapabilityResult | null = null;

export function useReportCapability(): ReportCapabilityResult | null {
  const api = useDesktopApi();
  const [result, setResult] = useState<ReportCapabilityResult | null>(cachedResult);

  useEffect(() => {
    if (cachedResult) return;
    let cancelled = false;
    let promise: Promise<ReportCapabilityResult>;
    try {
      promise = api.getReportCapability();
    } catch {
      const fallback: ReportCapabilityResult = { enabled: false, reason: "probe-failed" };
      cachedResult = fallback;
      setResult(fallback);
      return;
    }
    if (!promise || typeof promise.then !== "function") {
      const fallback: ReportCapabilityResult = { enabled: false, reason: "probe-failed" };
      cachedResult = fallback;
      setResult(fallback);
      return;
    }
    promise.then((r) => {
      if (cancelled) return;
      cachedResult = r;
      setResult(r);
    }).catch(() => {
      if (cancelled) return;
      const fallback: ReportCapabilityResult = { enabled: false, reason: "probe-failed" };
      cachedResult = fallback;
      setResult(fallback);
    });
    return () => { cancelled = true; };
  }, []);

  return result;
}
