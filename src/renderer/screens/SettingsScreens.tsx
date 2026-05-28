import { Button, Form, Input, Modal, Progress, Radio, Select, Space, Spin, Switch, Tag, message } from "antd";
import {
  CommentOutlined,
  CopyOutlined,
  DownloadOutlined,
  ExclamationCircleFilled,
  FolderOpenOutlined,
  GithubOutlined,
  GlobalOutlined,
  InfoCircleOutlined,
  Loading3QuartersOutlined,
  LogoutOutlined,
  RocketOutlined,
  SafetyCertificateOutlined,
  SyncOutlined,
  UserOutlined,
} from "@ant-design/icons";
import { useCallback, useEffect, useRef, useState } from "react";
import { MaterialSymbol, StatusDot } from "../components/Shell";
import { DiagnosticsPanel } from "../components/DiagnosticsPanel";
import { officecli } from "../bridge";
import { useSettings } from "../useSettings";
import { useAppUpdate } from "../useAppUpdate";
import { formatTestResult, ProviderForm } from "../components/ProviderForm";
import { useT } from "../i18n";
import { defaultProxySettings, isValidProxyUrl } from "../defaults";
import type { AuthEvent, DocumentType, GenerateDefaults, LlmProvider, ProviderTestResult, ProxySettings, WhoAmIResult } from "../../shared/types";

export function SettingsScreen({
  onCreditRefresh,
  onOpenLogin,
}: {
  onCreditRefresh?: () => void;
  onOpenLogin?: () => void;
} = {}) {
  const { settings, defaultWorkspaceDir, update: rawUpdate, loading, saving, error } = useSettings();
  const t = useT();
  const [whoami, setWhoami] = useState<WhoAmIResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    officecli
      .whoami()
      .then((result) => {
        if (!cancelled) setWhoami(result);
      })
      .catch(() => {
        if (!cancelled) setWhoami({ mode: "anonymous" });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const update = useCallback<typeof rawUpdate>(
    async (patch) => {
      const next = await rawUpdate(patch);
      void message.success({
        content: t("settings.toast.autoSaved"),
        key: "settings-auto-saved",
        duration: 2,
      });
      return next;
    },
    [rawUpdate, t],
  );

  const updateDefaults = useCallback(
    (patch: Partial<GenerateDefaults>) => {
      update({ defaults: { ...settings.defaults, ...patch } }).catch(() => undefined);
    },
    [settings.defaults, update],
  );

  const pickOutputDir = useCallback(async () => {
    const picked = await officecli.openDirectoryDialog();
    if (picked) {
      await update({ outputDir: picked }).catch(() => undefined);
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
            enableImages: true,
            imageQuality: "premium",
          },
          outputDir: null,
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
              <SettingRow title={t("settings.row.enableImages.title")} desc={t("settings.row.enableImages.desc")}>
                <Switch checked={settings.defaults.enableImages} onChange={(checked) => updateDefaults({ enableImages: checked })} />
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
              <SettingRow title={t("settings.row.provider.title")} desc={t("settings.row.provider.desc")}>
                <ProviderFormControl
                  remote={settings.llmProvider}
                  onSave={(next) => update({ llmProvider: next }).catch(() => undefined)}
                  clearLabel={t("settings.row.provider.clear")}
                  customProviderEnabled={whoami === null || whoami.mode === "logged_in"}
                  onOpenLogin={onOpenLogin}
                />
              </SettingRow>
              <SettingRow title={t("settings.row.proxy.title")} desc={t("settings.row.proxy.desc")}>
                <ProxyCard
                  remote={settings.proxy}
                  onSave={(next) => update({ proxy: next })}
                />
              </SettingRow>
            </div>
            <div className="setting-group">
              <h2>{t("settings.group.subscription")}</h2>
              <SettingRow title={t("settings.row.redeem.title")} desc={t("settings.row.redeem.desc")}>
                <RedeemCodeCard onCreditRefresh={onCreditRefresh} />
              </SettingRow>
            </div>
            <div className="setting-group">
              <h2>{t("settings.group.about")}</h2>
              <AboutCard />
            </div>
            <div className="setting-group">
              <h2>{t("diagnostics.title")}</h2>
              <DiagnosticsPanel />
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

const EMPTY_PROVIDER_DRAFT: LlmProvider = { type: "official", baseUrl: "", apiKey: "", model: "" };

function providerHasContent(p: LlmProvider): boolean {
  return p.type !== "official" && Boolean(p.baseUrl.trim() || p.apiKey.trim() || p.model.trim());
}

function ProviderFormControl({
  remote,
  onSave,
  clearLabel,
  customProviderEnabled,
  onOpenLogin,
}: {
  remote: LlmProvider | null;
  onSave: (next: LlmProvider | null) => void;
  clearLabel: string;
  customProviderEnabled: boolean;
  onOpenLogin?: () => void;
}) {
  const t = useT();
  const [draft, setDraft] = useState<LlmProvider>(() => remote ?? { ...EMPTY_PROVIDER_DRAFT });
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<ProviderTestResult | null>(null);

  // Reconcile when the remote value changes from outside (e.g. reset, initial load).
  // We avoid overwriting the user's in-flight type choice when remote is still null
  // because the backend drops all-empty providers on the round trip.
  useEffect(() => {
    if (remote) {
      setDraft(remote);
    } else if (!providerHasContent(draft)) {
      // Keep the locally-chosen type even when remote is null, only reset to
      // the canonical default when the local draft is also empty.
      setDraft((current) => (providerHasContent(current) ? current : { ...EMPTY_PROVIDER_DRAFT, type: current.type }));
    }
    // We intentionally depend only on the remote identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remote]);

  const handleChange = useCallback(
    (patch: Partial<LlmProvider>) => {
      if (!customProviderEnabled && (patch.type === "custom" || draft.type !== "official")) {
        return;
      }
      setDraft((current) => {
        const next = { ...current, ...patch };
        if (providerHasContent(next)) {
          onSave(next);
        } else if (remote !== null) {
          onSave(null);
        }
        return next;
      });
      // Stale test result no longer reflects the current configuration.
      setTestResult(null);
    },
    [onSave, remote],
  );

  const handleClear = useCallback(() => {
    setDraft({ ...EMPTY_PROVIDER_DRAFT });
    onSave(null);
    setTestResult(null);
  }, [onSave]);

  const runTest = useCallback(async () => {
    if (draft.type !== "official" && !customProviderEnabled) return;
    setTesting(true);
    setTestResult(null);
    try {
      const result = draft.type === "official"
        ? await officecli.testProvider({
          useProviderOverride: true,
          llmProvider: null,
          allowPaidOfficialProbe: true,
        })
        : await officecli.testProvider();
      setTestResult(result);
    } catch (err) {
      setTestResult({
        ok: false,
        httpStatus: 0,
        latencyMs: 0,
        url: "",
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setTesting(false);
    }
  }, [draft.type, customProviderEnabled]);

  const confirmAndRunTest = useCallback(() => {
    if (draft.type !== "official") {
      void runTest();
      return;
    }
    Modal.confirm({
      title: t("onboarding.provider.paidProbeTitle"),
      content: t("onboarding.provider.paidProbeBody"),
      okText: t("onboarding.provider.paidProbeOk"),
      cancelText: t("settings.common.cancel"),
      onOk: () => runTest(),
    });
  }, [draft.type, runTest, t]);

  const canTest = draft.type === "official" || (customProviderEnabled && providerHasContent(draft));
  const testTag = testResult ? formatTestResult(testResult, t) : null;

  return (
    <>
      <ProviderForm provider={draft} onChange={handleChange} customProviderEnabled={customProviderEnabled} />
      {!customProviderEnabled ? (
        <div className="provider-hint" style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span>{t("settings.row.provider.loginRequired")}</span>
          {onOpenLogin ? (
            <Button type="link" size="small" onClick={onOpenLogin} style={{ paddingInline: 0 }}>
              {t("login.button.signIn")}
            </Button>
          ) : null}
        </div>
      ) : null}
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginTop: 4 }}>
        <Button
          icon={<RocketOutlined />}
          loading={testing}
          disabled={(!canTest && !testing) || (draft.type !== "official" && !customProviderEnabled)}
          onClick={confirmAndRunTest}
        >
          {testing ? t("settings.effective.testRunning") : t("settings.effective.testButton")}
        </Button>
        {testTag ? (
          <Tag color={testTag.tone === "green" ? "success" : testTag.tone === "red" ? "error" : "warning"}>
            {testTag.text}
          </Tag>
        ) : null}
        {remote || providerHasContent(draft) ? (
          <Button type="link" size="small" onClick={handleClear} disabled={draft.type !== "official" && !customProviderEnabled} style={{ marginLeft: "auto" }}>
            {clearLabel}
          </Button>
        ) : null}
      </div>
    </>
  );
}

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

  const openExternal = useCallback((url: string) => {
    void officecli.openExternal(url).catch(() => undefined);
  }, []);

  const showDisclaimer = useCallback(() => {
    Modal.info({
      title: t("settings.about.disclaimerTitle"),
      content: t("settings.about.disclaimerBody"),
      okText: t("settings.common.ok"),
    });
  }, [t]);

  const displayVersion = version || status.currentVersion;

  return (
    <div className="about-card">
      <div className="about-hero">
        <div className="about-app-icon" aria-hidden>
          <MaterialSymbol name="grid_view" />
        </div>
        <h3>{t("settings.about.productName")}</h3>
        <div className="about-version">{t("settings.about.versionValue", { version: displayVersion })}</div>
        <p className="about-description">{t("settings.about.description")}</p>
        <div className="about-links" aria-label={t("settings.about.linksLabel")}>
          <Button type="text" icon={<GlobalOutlined />} onClick={() => openExternal("https://officecli.io")}>
            {t("settings.about.website")}
          </Button>
          <Button type="text" icon={<GithubOutlined />} onClick={() => openExternal("https://github.com/officecli/officedex")}>
            {t("settings.about.github")}
          </Button>
          <Button type="text" icon={<SafetyCertificateOutlined />} onClick={() => openExternal("https://github.com/officecli/officedex/blob/main/LICENSE")}>
            {t("settings.about.license")}
          </Button>
        </div>
      </div>

      <div className="about-channel">
        <span>{t("settings.about.updateChannel")}</span>
        <Select
          value="stable"
          disabled
          options={[{ value: "stable", label: t("settings.about.channelStable") }]}
          aria-label={t("settings.about.updateChannel")}
          style={{ width: 136 }}
        />
      </div>

      <div className="about-meta">
        <span className="about-label">{t("settings.about.lastChecked")}: {formatLastChecked(status.lastCheckedAt, t)}</span>
        {status.lastError ? <span className="about-error">{t("settings.about.lastError")}: {status.lastError}</span> : null}
      </div>

      {downloading ? (
        <div className="about-progress">
          <Progress percent={percent} size="small" showInfo={false} />
          <span className="about-progress-label">{t("settings.about.downloading", { percent })}</span>
        </div>
      ) : null}

      <div className="about-actions">
        <Button icon={<CommentOutlined />} onClick={() => openExternal("https://github.com/officecli/officedex/issues")}>
          {t("settings.about.feedback")}
        </Button>
        <Button icon={<InfoCircleOutlined />} onClick={showDisclaimer}>
          {t("settings.about.disclaimer")}
        </Button>
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
      </div>
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

function RedeemCodeCard({ onCreditRefresh }: { onCreditRefresh?: () => void }) {
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
      onCreditRefresh?.();
    } catch (error) {
      void message.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }, [code, t, onCreditRefresh]);

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
    const identifier = whoami?.email ?? whoami?.userId;
    return identifier ? t("login.subtitle.successUser", { userId: identifier }) : t("login.subtitle.successDefault");
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

function ProxyCard({
  remote,
  onSave,
}: {
  remote: ProxySettings | null;
  onSave: (next: ProxySettings | null) => Promise<unknown>;
}) {
  const t = useT();
  const effectiveRemote = remote ?? defaultProxySettings;
  const [enabled, setEnabled] = useState<boolean>(effectiveRemote.enabled);
  const [url, setUrl] = useState<string>(effectiveRemote.url);
  const [submitting, setSubmitting] = useState(false);
  const [validationError, setValidationError] = useState<string | undefined>(undefined);

  useEffect(() => {
    const nextRemote = remote ?? defaultProxySettings;
    setEnabled(nextRemote.enabled);
    setUrl(nextRemote.url);
    setValidationError(undefined);
  }, [remote?.enabled, remote?.url]);

  const trimmedUrl = url.trim();
  const dirty =
    enabled !== effectiveRemote.enabled || trimmedUrl !== effectiveRemote.url;
  const canSave = dirty && !submitting && (!enabled || (trimmedUrl !== "" && isValidProxyUrl(trimmedUrl)));

  const handleSave = useCallback(async () => {
    if (enabled && (trimmedUrl === "" || !isValidProxyUrl(trimmedUrl))) {
      setValidationError(t("settings.row.proxy.invalidUrl"));
      return;
    }
    setSubmitting(true);
    setValidationError(undefined);
    try {
      const next: ProxySettings = enabled
        ? { enabled: true, url: trimmedUrl }
        : { enabled: false, url: trimmedUrl || defaultProxySettings.url };
      await onSave(next);
      void message.success({
        content: t("settings.row.proxy.saveSuccess"),
        key: "settings-proxy-saved",
        duration: 2,
      });
    } catch {
      // useSettings already surfaces the error via its error state.
    } finally {
      setSubmitting(false);
    }
  }, [enabled, trimmedUrl, onSave, t]);

  return (
    <Space direction="vertical" style={{ width: "100%" }} size="middle">
      <Space align="center" size="small">
        <Switch
          checked={enabled}
          onChange={(checked) => {
            setEnabled(checked);
            if (!checked) {
              setValidationError(undefined);
            }
          }}
          aria-label={t("settings.row.proxy.enableLabel")}
        />
        <span>{t("settings.row.proxy.enableLabel")}</span>
      </Space>
      {enabled ? (
        <Input
          placeholder={t("settings.row.proxy.urlPlaceholder")}
          value={url}
          onChange={(event) => {
            setUrl(event.target.value);
            if (validationError) setValidationError(undefined);
          }}
          aria-label={t("settings.row.proxy.urlLabel")}
          status={validationError ? "error" : undefined}
        />
      ) : null}
      {validationError ? (
        <div role="alert" style={{ color: "var(--n-red, #d92d20)" }}>
          {validationError}
        </div>
      ) : null}
      <Button type="primary" onClick={handleSave} disabled={!canSave} loading={submitting}>
        {t("settings.row.proxy.save")}
      </Button>
    </Space>
  );
}
