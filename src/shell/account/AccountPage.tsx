import { useCallback, useEffect, useRef, useState } from "react";
import { CircleAlert, Copy, ExternalLink, Loader2, LogOut, UserRound } from "lucide-react";

import type { AuthEvent, WhoAmIResult } from "../../shared/types";
import { useT } from "../../renderer/i18n";
import { useDesktopApi } from "../../renderer/services/desktopApi";
import { toast } from "../../renderer/ui";
import { errorMessage } from "../../renderer/utils/values";
import "./account.css";

/**
 * Signing in, as a full-page surface owned by the shell.
 *
 * Full page on purpose, and that is a rule rather than a taste: R-B-09 says the
 * sign-in flow does not render inside the shell frame, because a card floating
 * over a live sidebar makes the browser hand-off look like a stuck intermediate
 * state. The old renderer enforced it by returning the login screen *instead of*
 * the shell; this one keeps the shell mounted underneath and covers it, because
 * unmounting the workspace would take the open document's editor with it — the
 * one thing decision 4 in `App.tsx` exists to prevent. The cover is opaque, so
 * what R-B-09 is about (nothing of the workspace showing behind the card) holds
 * either way.
 *
 * Keeping the shell mounted is also what makes R-B-10 free: closing this page
 * puts the user back exactly where they were, because nothing moved. There is no
 * "return nav" to remember and no route to restore.
 *
 * The flow is the same five phases the old renderer's `LoginScreen` drives,
 * against the same transport — `login` starts `officecli login` (browser
 * hand-off), `onAuthEvent` reports the URL and the outcome, `whoami` is the
 * authority on whether it worked, `logout` reverses it. The credential is never
 * here: this page learns *that* someone is signed in, never the token, and
 * `logout` asks the CLI to forget it.
 */
type AccountPhase = "loading" | "anonymous" | "awaiting" | "success" | "failure";

export function AccountPage({
  onClose,
  onAccountChanged,
}: {
  onClose: () => void;
  /**
   * Called after a sign-in or sign-out that this page caused. The shell's
   * account chip is not polling, so this is how it hears about either.
   */
  onAccountChanged?: () => void;
}) {
  const api = useDesktopApi();
  const t = useT();
  const [phase, setPhase] = useState<AccountPhase>("loading");
  const [whoami, setWhoami] = useState<WhoAmIResult | null>(null);
  const [loginUrl, setLoginUrl] = useState<string | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const mountedRef = useRef(true);
  const phaseRef = useRef<AccountPhase>("loading");
  /**
   * Whether *this page* started the flow. The success event is broadcast, so a
   * sign-in finished somewhere else must not be reported as this one's result.
   */
  const signInStartedRef = useRef(false);
  const apiRef = useRef(api);
  apiRef.current = api;

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  const refreshWhoami = useCallback(async (): Promise<WhoAmIResult | null> => {
    try {
      const result = await apiRef.current.whoami();
      if (!mountedRef.current) return null;
      setWhoami(result);
      // Returning from the browser can precede the CLI saving its session.
      // Keep the pending flow visible until whoami confirms authentication.
      if (result.mode !== "anonymous") {
        phaseRef.current = "success";
        setPhase("success");
        if (result.mode === "logged_in" && signInStartedRef.current) {
          signInStartedRef.current = false;
          onAccountChanged?.();
        }
      } else if (!signInStartedRef.current) {
        setPhase("anonymous");
      }
      return result;
    } catch (error) {
      if (!mountedRef.current) return null;
      setErrorText(errorMessage(error));
      setPhase("failure");
      return null;
    }
  }, [onAccountChanged]);

  useEffect(() => {
    mountedRef.current = true;
    void refreshWhoami();
    const unsubscribe = apiRef.current.onAuthEvent((event: AuthEvent) => {
      if (!mountedRef.current) return;
      if (event.type === "url") {
        setLoginUrl(event.url);
        setPhase("awaiting");
      } else if (event.type === "success") {
        void refreshWhoami();
      } else if (event.type === "failure") {
        setErrorText(event.message);
        setPhase("failure");
      } else if (event.type === "exit") {
        // A cancelled flow exits non-zero, and cancelling is not a failure:
        // only an exit that interrupts an *awaiting* hand-off is reported.
        if (event.code !== 0 && phaseRef.current === "awaiting") {
          setErrorText(t("login.exitCode", { code: event.code ?? "null" }));
          setPhase("failure");
        }
      }
    });
    const onFocus = () => {
      if (signInStartedRef.current) void refreshWhoami();
    };
    window.addEventListener("focus", onFocus);
    return () => {
      mountedRef.current = false;
      window.removeEventListener("focus", onFocus);
      unsubscribe();
    };
  }, [onAccountChanged, refreshWhoami, t]);

  const startSignIn = useCallback(async () => {
    signInStartedRef.current = true;
    setBusy(true);
    setErrorText(null);
    try {
      const result = await apiRef.current.login({});
      if (!mountedRef.current || !signInStartedRef.current) return;
      setLoginUrl(result.url);
      setPhase("awaiting");
      /*
       * This page opens the verification URL, not the CLI. The login subprocess
       * runs with OFFICECLI_NO_BROWSER=1 (internal/login/env.go), so it only
       * prints the URL; opening it here is what makes the hand-off automatic
       * without racing the CLI into a second tab. The awaiting phase keeps a
       * manual "open again" for when the browser did not come to the front.
       */
      if (result.url) await apiRef.current.openExternal(result.url).catch(() => undefined);
    } catch (error) {
      if (!mountedRef.current) return;
      setErrorText(errorMessage(error));
      setPhase("failure");
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  }, []);

  const cancelSignIn = useCallback(async () => {
    signInStartedRef.current = false;
    phaseRef.current = "anonymous";
    await apiRef.current.cancelLogin().catch(() => undefined);
    if (!mountedRef.current) return;
    setPhase("anonymous");
    setLoginUrl(null);
  }, []);

  const openLoginUrl = useCallback(async () => {
    if (!loginUrl) return;
    await apiRef.current.openExternal(loginUrl).catch(() => undefined);
  }, [loginUrl]);

  const copyLoginUrl = useCallback(async () => {
    if (!loginUrl) return;
    try {
      await navigator.clipboard.writeText(loginUrl);
      void toast.success(t("login.url.copied"));
    } catch {
      void toast.error(t("login.url.copyFailed"));
    }
  }, [loginUrl, t]);

  const signOut = useCallback(async () => {
    setBusy(true);
    try {
      await apiRef.current.logout();
      if (!mountedRef.current) return;
      setWhoami({ mode: "anonymous" });
      setPhase("anonymous");
      setLoginUrl(null);
      signInStartedRef.current = false;
      onAccountChanged?.();
    } catch (error) {
      if (!mountedRef.current) return;
      setErrorText(errorMessage(error));
      setPhase("failure");
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  }, [onAccountChanged]);

  const identifier = whoami?.email ?? whoami?.userId ?? null;

  return (
    <div className="shell-account" role="dialog" aria-modal="true" aria-label={t("shell.account.openHint")}>
      <div className="shell-account-card">
        <span className="shell-account-mark" aria-hidden="true">
          <UserRound size={20} strokeWidth={1.6} />
        </span>
        <h1 className="shell-account-title">{t(`login.title.${phase}`)}</h1>
        <p className="shell-account-subtitle">
          {phase === "success"
            ? identifier
              ? t("login.subtitle.successUser", { userId: identifier })
              : t("login.subtitle.successDefault")
            : t(`login.subtitle.${phase}`)}
        </p>

        {phase === "loading" ? (
          <p className="shell-account-status is-loading">
            <Loader2 className="shell-account-spin" size={14} aria-hidden="true" />
            <span>{t("login.status.checking")}</span>
          </p>
        ) : null}

        {phase === "anonymous" ? (
          <div className="shell-account-actions">
            <button
              type="button"
              className="shell-account-primary"
              disabled={busy}
              onClick={() => void startSignIn()}
            >
              <ExternalLink size={14} aria-hidden="true" />
              <span>{t("login.button.signIn")}</span>
            </button>
            <p className="shell-account-hint">{t("login.hint.signInBrowser")}</p>
          </div>
        ) : null}

        {phase === "awaiting" ? (
          <div className="shell-account-actions">
            <p className="shell-account-status is-awaiting">
              <Loader2 className="shell-account-spin" size={14} aria-hidden="true" />
              <span>{t("login.status.awaiting")}</span>
            </p>
            {loginUrl ? (
              <div className="shell-account-url">
                <span className="shell-account-url-text" title={loginUrl}>
                  {loginUrl}
                </span>
                <span className="shell-account-url-actions">
                  <button type="button" className="shell-account-secondary" onClick={() => void copyLoginUrl()}>
                    <Copy size={13} aria-hidden="true" />
                    <span>{t("login.url.copy")}</span>
                  </button>
                  <button type="button" className="shell-account-secondary" onClick={() => void openLoginUrl()}>
                    <span>{t("login.url.openAgain")}</span>
                  </button>
                </span>
              </div>
            ) : null}
            <button type="button" className="shell-account-primary" onClick={() => void refreshWhoami()}>
              <span>{t("login.button.checkStatus")}</span>
            </button>
            <button type="button" className="shell-account-secondary" onClick={() => void cancelSignIn()}>
              <span>{t("login.button.cancel")}</span>
            </button>
          </div>
        ) : null}

        {phase === "success" ? (
          <div className="shell-account-actions">
            <button
              type="button"
              className="shell-account-secondary"
              disabled={busy}
              onClick={() => void signOut()}
            >
              <LogOut size={13} aria-hidden="true" />
              <span>{t("login.button.signOut")}</span>
            </button>
          </div>
        ) : null}

        {phase === "failure" ? (
          <div className="shell-account-actions">
            <p className="shell-account-status is-failure">
              <CircleAlert size={14} aria-hidden="true" />
              <span>{errorText || t("login.status.failure.default")}</span>
            </p>
            <button type="button" className="shell-account-primary" disabled={busy} onClick={() => void startSignIn()}>
              <span>{t("login.button.tryAgain")}</span>
            </button>
          </div>
        ) : null}

        <button type="button" className="shell-account-back" onClick={onClose}>
          <span>{t("login.button.return")}</span>
        </button>
        <span className="shell-account-copyright">{t("login.copyright")}</span>
      </div>
    </div>
  );
}
