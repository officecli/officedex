import { useCallback, useEffect, useRef, useState } from "react";
import type { CreditStatus } from "../shared/types";
import type { CreditInfo } from "./components/Shell";
import { officecli } from "./bridge";

const POLL_INTERVAL_MS = 60_000;
const NUDGE_DELAY_MS = 800;

// deriveCreditInfo maps the raw CLI quota snapshot onto the sidebar meter's
// { used, total, planLabel } shape. Priority: paid API-key burndown →
// hosted-credit balance → anonymous credits → zero placeholder.
export function deriveCreditInfo(status: CreditStatus): CreditInfo {
  if (status.mode === "api_key" && status.paidKeyTotal > 0) {
    const prefix = status.paidKeyPrefix ? ` ${status.paidKeyPrefix}` : "";
    return {
      used: status.paidKeyUsed,
      total: status.paidKeyTotal,
      planLabel: `API key${prefix}`,
    };
  }
  if (status.mode !== "anonymous" && status.hostedCreditBalance !== null) {
    const balance = Math.max(0, status.hostedCreditBalance);
    return {
      used: 0,
      total: balance,
      planLabel: status.planName || status.accessMode || "Hosted credits",
    };
  }
  if (status.anonymousCreditBalance !== null) {
    const total = Math.max(0, status.anonymousCreditBalance);
    const available = Math.max(0, status.anonymousCreditAvailable ?? 0);
    const used = Math.max(0, total - available);
    return {
      used,
      total,
      planLabel: status.planName || "Credits",
    };
  }
  return {
    used: 0,
    total: 0,
    planLabel: status.planName || status.accessMode || "Credits",
  };
}

export interface UseCreditStatusResult {
  credit: CreditInfo | undefined;
  status: CreditStatus | undefined;
  refresh: () => void;
  nudgeForTaskTransition: () => void;
}

export function useCreditStatus(): UseCreditStatusResult {
  const [status, setStatus] = useState<CreditStatus | undefined>();
  const [credit, setCredit] = useState<CreditInfo | undefined>();
  const inflightRef = useRef(false);
  const generationRef = useRef(0);
  const mountedRef = useRef(true);
  const pendingDeferRef = useRef(false);

  const refresh = useCallback(() => {
    if (inflightRef.current) return;
    inflightRef.current = true;
    generationRef.current += 1;
    const token = generationRef.current;
    officecli
      .getCreditStatus()
      .then((next) => {
        if (generationRef.current !== token || !mountedRef.current) return;
        setStatus(next);
        setCredit(deriveCreditInfo(next));
      })
      .catch((err) => {
        if (generationRef.current !== token || !mountedRef.current) return;
        console.warn("getCreditStatus failed", err);
      })
      .finally(() => {
        inflightRef.current = false;
        if (pendingDeferRef.current && mountedRef.current) {
          pendingDeferRef.current = false;
          refresh();
        }
      });
  }, []);

  const nudgeForTaskTransition = useCallback(() => {
    refresh();
    window.setTimeout(() => {
      if (!mountedRef.current) return;
      if (inflightRef.current) {
        pendingDeferRef.current = true;
        return;
      }
      refresh();
    }, NUDGE_DELAY_MS);
  }, [refresh]);

  useEffect(() => {
    mountedRef.current = true;
    refresh();
    const interval = window.setInterval(refresh, POLL_INTERVAL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      mountedRef.current = false;
      generationRef.current = -1;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);

  return { credit, status, refresh, nudgeForTaskTransition };
}
