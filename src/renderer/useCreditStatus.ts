import { useCallback, useEffect, useRef, useState } from "react";
import type { CreditStatus } from "../shared/types";
import type { CreditInfo } from "./components/Shell";
import { officecli } from "./bridge";

const POLL_INTERVAL_MS = 60_000;

// deriveCreditInfo maps the raw CLI quota snapshot onto the sidebar meter's
// { used, total, planLabel } shape. Priority: paid API-key burndown →
// hosted-credit balance → free-trial limits → zero placeholder.
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
      planLabel: status.planName || status.accessMode || "Hosted plan",
    };
  }
  if (status.freeTrialLimit > 0 || status.freeTrialUsed > 0 || status.freeTrialRemaining > 0) {
    const limit = Math.max(status.freeTrialLimit, status.freeTrialUsed + status.freeTrialRemaining);
    return {
      used: status.freeTrialUsed,
      total: limit,
      planLabel: status.planName || "Free trial",
    };
  }
  return {
    used: 0,
    total: 0,
    planLabel: status.planName || status.accessMode || "Free trial",
  };
}

export interface UseCreditStatusResult {
  credit: CreditInfo | undefined;
  status: CreditStatus | undefined;
  refresh: () => void;
}

export function useCreditStatus(): UseCreditStatusResult {
  const [status, setStatus] = useState<CreditStatus | undefined>();
  const [credit, setCredit] = useState<CreditInfo | undefined>();
  const inflightRef = useRef(false);

  const refresh = useCallback(() => {
    if (inflightRef.current) return;
    inflightRef.current = true;
    officecli
      .getCreditStatus()
      .then((next) => {
        setStatus(next);
        setCredit(deriveCreditInfo(next));
      })
      .catch((err) => {
        console.warn("getCreditStatus failed", err);
      })
      .finally(() => {
        inflightRef.current = false;
      });
  }, []);

  useEffect(() => {
    refresh();
    const interval = window.setInterval(refresh, POLL_INTERVAL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);

  return { credit, status, refresh };
}
