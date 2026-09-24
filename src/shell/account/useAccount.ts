import { useCallback, useEffect, useRef, useState } from "react";

import type { WhoAmIResult } from "../../shared/types";
import { useDesktopApi } from "../../renderer/services/desktopApi";

/**
 * Who is signed in, as far as the shell is allowed to know.
 *
 * The shell owns no session and must not grow one. The credential belongs to
 * `officecli` — `license.session_token` in the CLI's own config file, see
 * `internal/login` — and the only question this app can ask about it is
 * `whoami`. So this hook asks that question, once per mount, and holds the
 * answer.
 *
 * Asked once, not polled. `whoami` spawns a subprocess, and buying a process
 * per tick to re-learn a fact that changes only when the user signs in or out
 * would be paying continuously for something the account page already knows:
 * both of those paths call `refresh()` from the page that caused them.
 *
 * Failure is `unknown`, not `anonymous`. Outside the desktop app there is no
 * CLI to ask; inside it, the CLI can be missing or wedged. Reporting "not
 * signed in" for either would be a guess about a user who may be perfectly
 * signed in, and the chip is the wrong place to be wrong about that — the
 * account page reports the failure itself, and `unknown` still opens it.
 */
export type AccountMode = "anonymous" | "account" | "unknown";

export interface Account {
  mode: AccountMode;
  /** Email when the CLI reported one, otherwise the user id. Never invented. */
  label?: string;
}

export function accountFromWhoAmI(result: WhoAmIResult): Account {
  if (result.mode === "anonymous") return { mode: "anonymous" };
  const label = result.email?.trim() || result.userId?.trim();
  return label ? { mode: "account", label } : { mode: "account" };
}

export interface UseAccountResult {
  account: Account;
  refresh: () => void;
}

export function useAccount(): UseAccountResult {
  const api = useDesktopApi();
  const [account, setAccount] = useState<Account>({ mode: "unknown" });
  const mountedRef = useRef(true);
  /*
   * The transport goes through a ref so `refresh` can stay stable. A provider
   * that hands down a fresh API object per render — which is what a test does
   * until somebody memoises it — would otherwise re-fetch `whoami` on every
   * render, each one a subprocess in the desktop app.
   */
  const apiRef = useRef(api);
  apiRef.current = api;
  /** Invalidates a reply that arrives after a newer question was asked. */
  const generationRef = useRef(0);

  const refresh = useCallback(() => {
    generationRef.current += 1;
    const token = generationRef.current;
    apiRef.current
      .whoami()
      .then((result) => {
        if (generationRef.current !== token || !mountedRef.current) return;
        setAccount(accountFromWhoAmI(result));
      })
      .catch(() => {
        if (generationRef.current !== token || !mountedRef.current) return;
        setAccount({ mode: "unknown" });
      });
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    refresh();
    // Authentication can finish after the account page has been closed.
    const unsubscribe = apiRef.current.onAuthEvent((event) => {
      if (event.type === "success") refresh();
    });
    return () => {
      unsubscribe();
      mountedRef.current = false;
      generationRef.current = -1;
    };
  }, [refresh]);

  return { account, refresh };
}
