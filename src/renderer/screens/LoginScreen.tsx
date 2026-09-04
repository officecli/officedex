import { Button, Space, toast as message } from "../ui";
import { RedeemCodeCard, formatCreditValue } from "./settings/RedeemCodeCard";
import { CopyOutlined, ExclamationCircleFilled, GlobalOutlined, Loading3QuartersOutlined, LogoutOutlined, LeftOutlined, ThunderboltOutlined } from "../ui/icons";
import { useCallback, useEffect, useRef, useState } from "react";
import { MaterialSymbol, type CreditInfo } from "../components/Shell";
import { officecli } from "../bridge";
import { useT } from "../i18n";
import type { AuthEvent, WhoAmIResult } from "../../shared/types";
import { errorMessage } from "../utils/values";


type LoginPhase = "loading" | "anonymous" | "awaiting" | "success" | "failure";

export function LoginScreen({ onReturn, onAuthenticated, credit, hasCustomProvider }: { onReturn?: () => void; onAuthenticated?: () => void; credit?: CreditInfo; hasCustomProvider?: boolean } = {}) {
  const [phase, setPhase] = useState<LoginPhase>("loading");
  const [whoami, setWhoami] = useState<WhoAmIResult | null>(null);
  const [loginUrl, setLoginUrl] = useState<string | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const mountedRef = useRef(true);
  const phaseRef = useRef<LoginPhase>("loading");
  const loginStartedRef = useRef(false);
  const t = useT();

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  const refreshWhoami = useCallback(async (): Promise<WhoAmIResult | null> => {
    try {
      const result = await officecli.whoami();
      if (!mountedRef.current) return null;
      setWhoami(result);
      setPhase(result.mode === "anonymous" ? "anonymous" : "success");
      return result;
    } catch (error) {
      if (!mountedRef.current) return null;
      setErrorText(errorMessage(error));
      setPhase("failure");
      return null;
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void refreshWhoami();
    const unsubscribe = officecli.onAuthEvent((event: AuthEvent) => {
      if (!mountedRef.current) return;
      if (event.type === "url") {
        setLoginUrl(event.url);
        setPhase("awaiting");
      } else if (event.type === "success") {
        void refreshWhoami().then((result) => {
          if (result?.mode === "logged_in" && loginStartedRef.current) {
            loginStartedRef.current = false;
            onAuthenticated?.();
          }
        });
      } else if (event.type === "failure") {
        setErrorText(event.message);
        setPhase("failure");
      } else if (event.type === "exit") {
        if (event.code !== 0 && phaseRef.current === "awaiting") {
          setErrorText(t("login.exitCode", { code: event.code ?? "null" }));
          setPhase("failure");
        }
      }
    });
    return () => {
      mountedRef.current = false;
      unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onAuthenticated, refreshWhoami]);

  const startLogin = useCallback(async () => {
    loginStartedRef.current = true;
    setBusy(true);
    setErrorText(null);
    try {
      const result = await officecli.login({});
      setLoginUrl(result.url);
      setPhase("awaiting");
      // The desktop app is the single opener of the verification URL: the
      // login subprocess runs with OFFICECLI_NO_BROWSER=1 (see
      // internal/login/env.go) so the CLI only prints the URL. Opening it here
      // keeps the browser hand-off automatic without racing the CLI into a
      // second tab; the awaiting screen still keeps a manual "open again"
      // fallback.
      if (result.url) await officecli.openExternal(result.url).catch(() => undefined);
    } catch (error) {
      setErrorText(errorMessage(error));
      setPhase("failure");
    } finally {
      setBusy(false);
    }
  }, []);

  const cancelLogin = useCallback(async () => {
    await officecli.cancelLogin().catch(() => undefined);
    setPhase("anonymous");
    setLoginUrl(null);
  }, []);

  const openLoginUrl = useCallback(async () => {
    if (!loginUrl) return;
    await officecli.openExternal(loginUrl).catch(() => undefined);
  }, [loginUrl]);

  const copyLoginUrl = useCallback(async () => {
    if (!loginUrl) return;
    try {
      await navigator.clipboard.writeText(loginUrl);
      void message.success(t("login.url.copied"));
    } catch {
      void message.error(t("login.url.copyFailed"));
    }
  }, [loginUrl, t]);

  const doLogout = useCallback(async () => {
    setBusy(true);
    try {
      await officecli.logout();
      setWhoami({ mode: "anonymous" });
      setPhase("anonymous");
      setLoginUrl(null);
      loginStartedRef.current = false;
    } catch (error) {
      setErrorText(errorMessage(error));
      setPhase("failure");
    } finally {
      setBusy(false);
    }
  }, []);

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-mark">
          <MaterialSymbol name={phase === "success" ? "person" : "lock_open"} />
        </div>
        <h1>{titleFor(phase, t)}</h1>
        <p>{subtitleFor(phase, whoami, t)}</p>

        {credit ? (
          <div className="login-credit" role="status">
            <ThunderboltOutlined aria-hidden />
            <span>{hasCustomProvider ? t("shell.creditMeter.freeLabel") : credit.planLabel || t("shell.creditMeter.label")}</span>
            {!hasCustomProvider ? <strong>{formatCreditValue(credit)}</strong> : null}
          </div>
        ) : null}

        {phase === "loading" ? (
          <div className="login-status loading">
            <Loading3QuartersOutlined spin />
            <span>{t("login.status.checking")}</span>
          </div>
        ) : null}

        {phase === "anonymous" ? (
          <Space direction="vertical" size={12} style={{ width: "100%", marginTop: 16 }}>
            <Button type="primary" icon={<GlobalOutlined />} block loading={busy} onClick={startLogin}>
              {t("login.button.signIn")}
            </Button>
            <p className="copyright">{t("login.hint.signInBrowser")}</p>
          </Space>
        ) : null}

        {phase === "awaiting" ? (
          <Space direction="vertical" size={12} style={{ width: "100%", marginTop: 16 }}>
            <div className="login-status awaiting">
              <Loading3QuartersOutlined spin />
              <span>{t("login.status.awaiting")}</span>
            </div>
            {loginUrl ? (
              <div className="login-url-box">
                <span className="login-url-text" title={loginUrl}>{loginUrl}</span>
                <Space>
                  <Button size="small" icon={<CopyOutlined />} onClick={copyLoginUrl}>{t("login.url.copy")}</Button>
                  <Button size="small" type="link" onClick={openLoginUrl}>{t("login.url.openAgain")}</Button>
                </Space>
              </div>
            ) : null}
            <Button block onClick={cancelLogin}>{t("login.button.cancel")}</Button>
          </Space>
        ) : null}

        {phase === "success" && whoami ? (
          <Space direction="vertical" size={12} style={{ width: "100%", marginTop: 16 }}>
            <Button type="primary" block icon={<LeftOutlined />} onClick={onReturn}>
              {t("login.button.return")}
            </Button>
            <Button block icon={<LogoutOutlined />} loading={busy} onClick={doLogout}>
              {t("login.button.signOut")}
            </Button>
          </Space>
        ) : null}

        {phase === "failure" ? (
          <Space direction="vertical" size={12} style={{ width: "100%", marginTop: 16 }}>
            <div className="login-status failure">
              <ExclamationCircleFilled />
              <span>{errorText || t("login.status.failure.default")}</span>
            </div>
            <Button type="primary" block onClick={startLogin}>
              {t("login.button.tryAgain")}
            </Button>
          </Space>
        ) : null}

        {onReturn && phase !== "success" ? (
          <Button className="login-return" block type="text" icon={<LeftOutlined />} onClick={onReturn}>
            {t("login.button.return")}
          </Button>
        ) : null}

        <span className="copyright">{t("login.copyright")}</span>
      </div>
    </div>
  );
}

function titleFor(phase: LoginPhase, t: (key: string) => string): string {
  return t(`login.title.${phase}`);
}

function subtitleFor(phase: LoginPhase, whoami: WhoAmIResult | null, t: (key: string, vars?: Record<string, string | number>) => string): string {
  if (phase === "success") {
    const identifier = whoami?.email ?? whoami?.userId;
    return identifier ? t("login.subtitle.successUser", { userId: identifier }) : t("login.subtitle.successDefault");
  }
  return t(`login.subtitle.${phase}`);
}
