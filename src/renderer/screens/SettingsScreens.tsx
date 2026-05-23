import { Button, Form, Input, Modal, Progress, Radio, Select, Space, Spin, Switch, Tag, message } from "antd";
import {
  CopyOutlined,
  DownloadOutlined,
  ExclamationCircleFilled,
  FolderOpenOutlined,
  GlobalOutlined,
  Loading3QuartersOutlined,
  LogoutOutlined,
  RocketOutlined,
  SyncOutlined,
  UserOutlined,
} from "@ant-design/icons";
import { useCallback, useEffect, useRef, useState } from "react";
import { MaterialSymbol, StatusDot } from "../components/Shell";
import { officecli } from "../bridge";
import { useSettings } from "../useSettings";
import { useAppUpdate } from "../useAppUpdate";
import { ProviderForm } from "./OnboardingScreen";
import { useT } from "../i18n";
import type { AuthEvent, DocumentType, GenerateDefaults, LlmProvider, WhoAmIResult } from "../../shared/types";

export function SettingsScreen() {
  const { settings, defaultWorkspaceDir, update, loading, saving, error } = useSettings();
  const t = useT();

  const updateDefaults = useCallback(
    (patch: Partial<GenerateDefaults>) => {
      update({ defaults: { ...settings.defaults, ...patch } }).catch(() => undefined);
    },
    [settings.defaults, update],
  );

  const pickOutputDir = useCallback(async () => {
    const picked = await officecli.openFileDialog();
    if (picked) {
      await update({ outputDir: picked }).catch(() => undefined);
    }
  }, [update]);

  const pickBridgeBinary = useCallback(async () => {
    const picked = await officecli.openFileDialog({ filters: [{ name: "All Files", extensions: ["*"] }] });
    if (picked) {
      await update({ bridgeBinaryPath: picked }).catch(() => undefined);
    }
  }, [update]);

  const rerunOnboarding = useCallback(() => {
    Modal.confirm({
      title: t("settings.row.onboarding.confirmTitle"),
      content: t("settings.row.onboarding.confirmBody"),
      okText: t("settings.row.onboarding.confirmOk"),
      cancelText: t("settings.common.cancel"),
      onOk: () => update({ onboardingCompletedAt: null }).catch(() => undefined),
    });
  }, [update, t]);

  const resetAll = useCallback(() => {
    Modal.confirm({
      title: t("settings.row.reset.confirmTitle"),
      content: t("settings.row.reset.confirmBody"),
      okText: t("settings.row.reset.button"),
      okButtonProps: { danger: true },
      cancelText: t("settings.common.cancel"),
      onOk: () =>
        update({
          defaults: {
            documentType: "pptx",
            mode: "fast",
            runtimeMode: "hosted",
            enableImages: true,
            imageQuality: "standard",
          },
          outputDir: null,
          bridgeBinaryPath: null,
          llmProvider: null,
          onboardingCompletedAt: null,
        }).catch(() => undefined),
    });
  }, [update, t]);

  return (
    <div className="settings-layout">
      <section className="settings-panel">
        <div className="page-header">
          <div>
            <h1>{t("settings.page.title")}</h1>
            <p>{t("settings.page.subtitle")}</p>
          </div>
          {saving ? <Tag color="processing">{t("settings.tag.saving")}</Tag> : <Tag color="green">{t("settings.tag.autoSaved")}</Tag>}
        </div>
        {error ? (
          <div className="settings-error">
            <ExclamationCircleFilled /> {error}
          </div>
        ) : null}
        {loading ? (
          <div className="settings-loading"><Spin /> <span>{t("settings.loading")}</span></div>
        ) : (
          <>
            <div className="setting-group">
              <h2>{t("settings.group.generation")}</h2>
              <SettingRow title={t("settings.row.documentType.title")} desc={t("settings.row.documentType.desc")}>
                <Select
                  value={settings.defaults.documentType}
                  onChange={(value: DocumentType) => updateDefaults({ documentType: value })}
                  options={[
                    { value: "pptx", label: t("settings.option.docType.pptx") },
                    { value: "docx", label: t("settings.option.docType.docx") },
                    { value: "xlsx", label: t("settings.option.docType.xlsx") },
                    { value: "report", label: t("settings.option.docType.report") },
                    { value: "img", label: t("settings.option.docType.img") },
                  ]}
                  style={{ minWidth: 220 }}
                />
              </SettingRow>
              <SettingRow title={t("settings.row.mode.title")} desc={t("settings.row.mode.desc")}>
                <Radio.Group
                  value={settings.defaults.mode}
                  onChange={(event) => updateDefaults({ mode: event.target.value })}
                  optionType="button"
                  buttonStyle="solid"
                  options={[
                    { value: "fast", label: t("settings.option.mode.fast") },
                    { value: "best", label: t("settings.option.mode.best") },
                  ]}
                />
              </SettingRow>
              <SettingRow title={t("settings.row.runtime.title")} desc={t("settings.row.runtime.desc")}>
                <Radio.Group
                  value={settings.defaults.runtimeMode}
                  onChange={(event) => updateDefaults({ runtimeMode: event.target.value })}
                >
                  <Space direction="vertical" size={8} style={{ width: "100%" }}>
                    <Radio value="hosted" className={`runtime-choice ${settings.defaults.runtimeMode === "hosted" ? "active" : ""}`}>
                      <StatusDot tone="green" />
                      <div>
                        <strong>{t("settings.row.runtime.hosted.title")}</strong>
                        <span>{t("settings.row.runtime.hosted.desc")}</span>
                      </div>
                    </Radio>
                    <Radio value="external" className={`runtime-choice ${settings.defaults.runtimeMode === "external" ? "active" : ""}`}>
                      <StatusDot tone="gray" />
                      <div>
                        <strong>{t("settings.row.runtime.external.title")}</strong>
                        <span>{t("settings.row.runtime.external.desc")}</span>
                      </div>
                    </Radio>
                  </Space>
                </Radio.Group>
              </SettingRow>
              <SettingRow title={t("settings.row.enableImages.title")} desc={t("settings.row.enableImages.desc")}>
                <Switch checked={settings.defaults.enableImages} onChange={(checked) => updateDefaults({ enableImages: checked })} />
              </SettingRow>
              <SettingRow title={t("settings.row.imageQuality.title")} desc={t("settings.row.imageQuality.desc")}>
                <Select
                  value={settings.defaults.imageQuality}
                  onChange={(value: "standard" | "premium") => updateDefaults({ imageQuality: value })}
                  options={[
                    { value: "standard", label: t("settings.option.imageQuality.standard") },
                    { value: "premium", label: t("settings.option.imageQuality.premium") },
                  ]}
                  style={{ minWidth: 180 }}
                />
              </SettingRow>
            </div>
            <div className="setting-group">
              <h2>{t("settings.group.workspace")}</h2>
              <SettingRow title={t("settings.row.outputDir.title")} desc={t("settings.row.outputDir.desc")}>
                <Space.Compact style={{ width: "100%" }}>
                  <Input
                    placeholder={defaultWorkspaceDir || t("settings.row.outputDir.placeholder")}
                    value={settings.outputDir ?? ""}
                    onChange={(event) => {
                      const value = event.target.value;
                      update({ outputDir: value.trim() ? value : null }).catch(() => undefined);
                    }}
                  />
                  <Button icon={<FolderOpenOutlined />} onClick={pickOutputDir}>{t("settings.row.outputDir.browse")}</Button>
                </Space.Compact>
                {settings.outputDir ? (
                  <Button type="link" size="small" onClick={() => update({ outputDir: null }).catch(() => undefined)}>
                    {t("settings.row.outputDir.reset")}
                  </Button>
                ) : null}
              </SettingRow>
            </div>
            <div className="setting-group">
              <h2>{t("settings.group.connection")}</h2>
              {settings.defaults.runtimeMode === "external" ? (
                <SettingRow title={t("settings.row.provider.title")} desc={t("settings.row.provider.desc")}>
                  <ProviderForm
                    provider={settings.llmProvider ?? { type: "openai", baseUrl: "", apiKey: "", model: "" }}
                    onChange={(patch: Partial<LlmProvider>) => {
                      const current = settings.llmProvider ?? { type: "openai" as const, baseUrl: "", apiKey: "", model: "" };
                      update({ llmProvider: { ...current, ...patch } }).catch(() => undefined);
                    }}
                  />
                  {settings.llmProvider ? (
                    <Button type="link" size="small" onClick={() => update({ llmProvider: null }).catch(() => undefined)}>
                      {t("settings.row.provider.clear")}
                    </Button>
                  ) : null}
                </SettingRow>
              ) : null}
              <SettingRow title={t("settings.row.bridgeBinary.title")} desc={t("settings.row.bridgeBinary.desc")}>
                <Space.Compact style={{ width: "100%" }}>
                  <Input
                    placeholder={t("settings.row.bridgeBinary.placeholder")}
                    value={settings.bridgeBinaryPath ?? ""}
                    onChange={(event) => {
                      const value = event.target.value;
                      update({ bridgeBinaryPath: value.trim() ? value : null }).catch(() => undefined);
                    }}
                  />
                  <Button icon={<FolderOpenOutlined />} onClick={pickBridgeBinary}>{t("settings.row.outputDir.browse")}</Button>
                </Space.Compact>
                {settings.bridgeBinaryPath ? (
                  <Button type="link" size="small" onClick={() => update({ bridgeBinaryPath: null }).catch(() => undefined)}>
                    {t("settings.row.outputDir.reset")}
                  </Button>
                ) : null}
              </SettingRow>
            </div>
            <div className="setting-group">
              <h2>{t("settings.group.subscription")}</h2>
              <SettingRow title={t("settings.row.redeem.title")} desc={t("settings.row.redeem.desc")}>
                <RedeemCodeCard />
              </SettingRow>
            </div>
            <div className="setting-group">
              <h2>{t("settings.group.about")}</h2>
              <AboutCard />
            </div>
            <div className="setting-group">
              <h2>{t("settings.group.reset")}</h2>
              <SettingRow title={t("settings.row.onboarding.title")} desc={t("settings.row.onboarding.desc")}>
                <Button onClick={rerunOnboarding}>{t("settings.row.onboarding.button")}</Button>
              </SettingRow>
              <SettingRow title={t("settings.row.reset.title")} desc={t("settings.row.reset.desc")}>
                <Button danger onClick={resetAll}>{t("settings.row.reset.button")}</Button>
              </SettingRow>
            </div>
          </>
        )}
      </section>
    </div>
  );
}

type LoginPhase = "loading" | "anonymous" | "awaiting" | "success" | "failure";

function AboutCard() {
  const update = useAppUpdate();
  const t = useT();
  const [version, setVersion] = useState<string>("");
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    let cancelled = false;
    officecli
      .getAppVersion()
      .then((v) => {
        if (!cancelled) setVersion(v);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const status = update.status;
  const release = update.release;
  const downloading = update.phase === "downloading";
  const downloaded = update.phase === "downloaded" || update.phase === "installing";
  const percent =
    update.progress.bytesTotal > 0
      ? Math.min(100, Math.round((update.progress.bytesDone / update.progress.bytesTotal) * 100))
      : 0;

  const handleCheck = useCallback(async () => {
    setChecking(true);
    try {
      await update.check();
    } finally {
      setChecking(false);
    }
  }, [update]);

  const handleUpdate = useCallback(() => {
    if (downloaded) {
      void update.install();
    } else {
      void update.download();
    }
  }, [downloaded, update]);

  return (
    <div className="about-card">
      <div className="about-row">
        <span className="about-label">{t("settings.about.version")}</span>
        <span className="about-value">{t("settings.about.versionValue", { version: version || status.currentVersion })}</span>
      </div>
      <div className="about-row">
        <span className="about-label">{t("settings.about.lastChecked")}</span>
        <span className="about-value">{formatLastChecked(status.lastCheckedAt, t)}</span>
      </div>
      {status.lastError ? (
        <div className="about-row about-row-error">
          <span className="about-label">{t("settings.about.lastError")}</span>
          <span className="about-value">{status.lastError}</span>
        </div>
      ) : null}
      {downloading ? (
        <div className="about-progress">
          <Progress percent={percent} size="small" showInfo={false} />
          <span className="about-progress-label">{t("settings.about.downloading", { percent })}</span>
        </div>
      ) : null}
      <Space size={8} className="about-actions">
        <Button icon={<SyncOutlined spin={checking} />} onClick={handleCheck} disabled={checking || downloading}>
          {t("settings.about.checking")}
        </Button>
        {status.updateAvailable && release ? (
          <Button
            type="primary"
            icon={downloaded ? <RocketOutlined /> : <DownloadOutlined />}
            onClick={handleUpdate}
            disabled={downloading}
          >
            {downloaded
              ? t("settings.about.restartToInstall", { version: release.version })
              : downloading
                ? t("settings.about.downloadingLabel")
                : t("settings.about.updateTo", { version: release.version })}
          </Button>
        ) : !checking ? (
          <span className="about-uptodate">{t("settings.about.upToDate")}</span>
        ) : null}
      </Space>
    </div>
  );
}

function formatLastChecked(timestamp: string | null, t: (key: string, vars?: Record<string, string | number>) => string): string {
  if (!timestamp) return t("settings.about.lastCheckedNever");
  const then = Date.parse(timestamp);
  if (Number.isNaN(then)) return timestamp;
  const elapsed = Math.max(0, Date.now() - then);
  if (elapsed < 60_000) return t("settings.about.lastCheckedJustNow");
  if (elapsed < 60 * 60_000) return t("settings.about.lastCheckedMinutes", { count: Math.floor(elapsed / 60_000) });
  if (elapsed < 24 * 60 * 60_000) return t("settings.about.lastCheckedHours", { count: Math.floor(elapsed / (60 * 60_000)) });
  return new Date(then).toLocaleString();
}

export function LoginScreen() {
  const [phase, setPhase] = useState<LoginPhase>("loading");
  const [whoami, setWhoami] = useState<WhoAmIResult | null>(null);
  const [loginUrl, setLoginUrl] = useState<string | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const mountedRef = useRef(true);
  const phaseRef = useRef<LoginPhase>("loading");
  const t = useT();

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  const refreshWhoami = useCallback(async () => {
    try {
      const result = await officecli.whoami();
      if (!mountedRef.current) return;
      setWhoami(result);
      setPhase(result.mode === "anonymous" ? "anonymous" : "success");
    } catch (error) {
      if (!mountedRef.current) return;
      setErrorText(errorMessage(error));
      setPhase("failure");
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
        void refreshWhoami();
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
  }, [refreshWhoami]);

  const startLogin = useCallback(async () => {
    setBusy(true);
    setErrorText(null);
    try {
      const result = await officecli.login();
      setLoginUrl(result.url);
      setPhase("awaiting");
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

        <span className="copyright">{t("login.copyright")}</span>
      </div>
    </div>
  );
}

function RedeemCodeCard() {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [lastSuccess, setLastSuccess] = useState<{ code: string; amount: number; balance: number } | null>(null);
  const t = useT();

  const handleSubmit = useCallback(async () => {
    const trimmed = code.trim();
    if (!trimmed) {
      void message.error(t("settings.redeem.empty"));
      return;
    }
    setBusy(true);
    try {
      const result = await officecli.redeem(trimmed);
      setLastSuccess({ code: result.code, amount: result.credit_amount, balance: result.new_balance });
      setCode("");
      void message.success(t("settings.redeem.success", { amount: result.credit_amount }));
    } catch (error) {
      void message.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }, [code, t]);

  return (
    <Space direction="vertical" size={8} style={{ width: "100%" }}>
      <Space.Compact style={{ width: "100%", display: "flex" }}>
        <Input
          style={{ flex: 1 }}
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          onPressEnter={handleSubmit}
          placeholder={t("settings.redeem.placeholder")}
          maxLength={64}
          autoComplete="off"
          disabled={busy}
        />
        <Button type="primary" loading={busy} onClick={handleSubmit}>{t("settings.redeem.submit")}</Button>
      </Space.Compact>
      {lastSuccess ? (
        <div style={{ fontSize: 12, color: "#388E3C" }}>
          {t("settings.redeem.successRecord", { code: lastSuccess.code, amount: lastSuccess.amount, balance: lastSuccess.balance })}
        </div>
      ) : null}
    </Space>
  );
}

function titleFor(phase: LoginPhase, t: (key: string) => string): string {
  return t(`login.title.${phase}`);
}

function subtitleFor(phase: LoginPhase, whoami: WhoAmIResult | null, t: (key: string, vars?: Record<string, string | number>) => string): string {
  if (phase === "success") {
    return whoami?.userId ? t("login.subtitle.successUser", { userId: whoami.userId }) : t("login.subtitle.successDefault");
  }
  return t(`login.subtitle.${phase}`);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function SettingRow({ title, desc, children }: { title: string; desc: string; children: React.ReactNode }) {
  return (
    <div className="setting-row">
      <div>
        <h3>{title}</h3>
        <p>{desc}</p>
      </div>
      <div className="setting-control">{children}</div>
    </div>
  );
}
