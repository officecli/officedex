import { Button, Input, Modal, PasswordInput, Progress, Select, Space, Spin, Switch, Tag, toast as message } from "../ui";
import {
  BgColorsOutlined,
  ClockCircleOutlined,
  CommentOutlined,
  ControlOutlined,
  CopyOutlined,
  DownloadOutlined,
  ExclamationCircleFilled,
  GridOutlined,
  GithubOutlined,
  GlobalOutlined,
  HistoryOutlined,
  InfoCircleOutlined,
  Loading3QuartersOutlined,
  LineChartOutlined,
  LogoutOutlined,
  LeftOutlined,
  NotificationOutlined,
  RocketOutlined,
  SafetyCertificateOutlined,
  StarOutlined,
  SyncOutlined,
  ThunderboltOutlined,
} from "../ui/icons";
import { useCallback, useEffect, useRef, useState } from "react";
import { MaterialSymbol, type CreditInfo } from "../components/Shell";
import type { ReactNode } from "react";
import { DiagnosticsPanel } from "../components/DiagnosticsPanel";
import { RuntimeRunsPanel } from "../components/RuntimeRunsPanel";
import { officecli } from "../bridge";
import { useSettings } from "../useSettings";
import { useAppUpdate } from "../useAppUpdate";
import { formatTestResult, ProviderForm } from "../components/ProviderForm";
import { useT, useLocale, useSetLocale, type Locale } from "../i18n";
import { defaultProxySettings, isValidProxyUrl } from "../defaults";
import { readNotificationsEnabled, setNotificationsEnabled as persistNotificationsEnabled } from "../notifications";
import type { AuthEvent, CreditStatus, DocumentType, GenerateDefaults, InviteInfo, JiraAuthType, JiraConnectionSummary, JiraProbeResult, LiquipediaConnectionSummary, LiquipediaProbeResult, LlmProvider, ProviderTestResult, ProxySettings, WhoAmIResult } from "../../shared/types";
import { ImeInput, ImeTextArea } from "../components/ImeInput";
import { errorMessage } from "../utils/values";

export function SettingsScreen({
  onCreditRefresh,
  onOpenLogin,
  activity,
}: {
  onCreditRefresh?: () => void;
  onOpenLogin?: () => void;
  activity?: ReactNode;
} = {}) {
  const { settings, update: rawUpdate, loading, saving, error } = useSettings();
  const t = useT();
  const locale = useLocale();
  const setLocale = useSetLocale();
  const [notificationsEnabled, setNotificationsEnabled] = useState(() => readNotificationsEnabled());
  const [whoami, setWhoami] = useState<WhoAmIResult | null>(null);
  const [creditStatus, setCreditStatus] = useState<CreditStatus | null>(null);
  const [inviteInfo, setInviteInfo] = useState<InviteInfo | null>(null);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteLoading, setInviteLoading] = useState(false);
  const [activeSettingsSection, setActiveSettingsSection] = useState("generation");

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

  useEffect(() => {
    if (whoami?.mode !== "logged_in") {
      setInviteInfo(null);
      setInviteError(null);
      setInviteLoading(false);
      return;
    }
    let cancelled = false;
    setInviteLoading(true);
    setInviteError(null);
    officecli
      .getInviteInfo()
      .then((result) => {
        if (!cancelled) setInviteInfo(result);
      })
      .catch((error) => {
        if (!cancelled) setInviteError(errorMessage(error));
      })
      .finally(() => {
        if (!cancelled) setInviteLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [whoami]);

  useEffect(() => {
    let cancelled = false;
    officecli
      .getCreditStatus()
      .then((result) => {
        if (!cancelled) setCreditStatus(result);
      })
      .catch(() => {
        if (!cancelled) setCreditStatus(null);
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

  const hasPaidEntitlement = hasImageWatermarkEntitlement(creditStatus);
  const watermarkSettings = settings.imageWatermark ?? { showWatermark: true, preferenceSource: "system" as const };
  const displayedShowWatermark = hasPaidEntitlement
    ? watermarkSettings.preferenceSource === "user"
      ? watermarkSettings.showWatermark
      : false
    : true;

  const rerunOnboarding = useCallback(() => {
    Modal.confirm({
      title: t("settings.row.onboarding.confirmTitle"),
      content: t("settings.row.onboarding.confirmBody"),
      okText: t("settings.row.onboarding.confirmOk"),
      cancelText: t("settings.common.cancel"),
      onOk: () => update({ onboardingCompletedAt: null }).catch(() => undefined),
    });
  }, [update, t]);

  const updateNotificationsEnabled = useCallback((checked: boolean) => {
    setNotificationsEnabled(checked);
    persistNotificationsEnabled(checked);
  }, []);

  const sendTestNotification = useCallback(async () => {
    try {
      if (!officecli.sendDesktopNotification) {
        throw new Error("Desktop notifications require a newer OfficeDex runtime.");
      }
      await officecli.sendDesktopNotification({
        title: t("notification.title"),
        body: t("settings.notifications.testBody"),
      });
      void message.success(t("settings.notifications.testSuccess"));
    } catch (error) {
      void message.error(t("settings.notifications.testError", { error: errorMessage(error) }));
    }
  }, [t]);

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
            enableImages: true,
            imageQuality: "premium",
          },
          workspaceDir: null,
          outputDir: null,
          llmProvider: null,
          onboardingCompletedAt: null,
          imageWatermark: { showWatermark: true, preferenceSource: "system" },
        }).catch(() => undefined),
    });
  }, [update, t]);

  const selectSettingsSection = useCallback((section: string) => {
    setActiveSettingsSection(section);
  }, []);

  const copyInviteCode = useCallback(async () => {
    const code = inviteInfo?.invite_code?.trim();
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      void message.success(t("login.invite.copied"));
    } catch {
      void message.error(t("login.invite.copyFailed"));
    }
  }, [inviteInfo, t]);

  const advancedLabel = t("settings.group.advanced");
  const settingsSections = [
    { key: "generation", label: t("settings.group.generation"), icon: <StarOutlined /> },
    { key: "notifications", label: t("settings.group.notifications"), icon: <NotificationOutlined /> },
    { key: "appearance", label: t("settings.group.appearance"), icon: <BgColorsOutlined /> },
    { key: "connection", label: t("settings.group.connection"), icon: <ControlOutlined /> },
    { key: "subscription", label: t("settings.group.subscription"), icon: <SafetyCertificateOutlined /> },
    { key: "activity", label: t("settings.group.activity"), icon: <ClockCircleOutlined /> },
    { key: "advanced", label: advancedLabel, icon: <LineChartOutlined /> },
    { key: "reset", label: t("settings.group.reset"), icon: <HistoryOutlined /> },
    { key: "about", label: t("settings.group.about"), icon: <GridOutlined /> },
  ];

  return (
    <div className="settings-stage">
      <div className="settings-page">
        <div className="settings-hero page-header">
          <div>
            <p className="settings-eyebrow">OFFICEDEX SETTINGS</p>
            <h1>{t("settings.page.title")}</h1>
            <p>{t("settings.page.subtitle")}</p>
          </div>
          <div className="settings-save-status" data-state={saving ? "saving" : "saved"}>
            <span aria-hidden="true" />
            {saving ? t("settings.tag.saving") : t("settings.tag.autoSaved")}
          </div>
        </div>
        <div className="settings-layout">
        <div className="settings-secondary-menu">
        <nav aria-label={t("settings.secondaryMenu.label")}>
          {settingsSections.map((section) => (
            <div className={section.key === "activity" ? "settings-nav-group-start" : undefined} key={section.key}>
            <button
              type="button"
              className={activeSettingsSection === section.key ? "active" : ""}
              aria-label={section.label}
              aria-current={activeSettingsSection === section.key ? "true" : undefined}
              onClick={() => selectSettingsSection(section.key)}
            >
              <span className="settings-nav-icon" aria-hidden="true">{section.icon}</span>
              <span>{section.label}</span>
            </button>
            </div>
          ))}
        </nav>
        </div>
        <section className="settings-content">
        {error ? (
          <div className="settings-error">
            <ExclamationCircleFilled /> {error}
          </div>
        ) : null}
        {loading ? (
          <div className="settings-loading"><Spin /> <span>{t("settings.loading")}</span></div>
        ) : (
          <>
            {activeSettingsSection === "generation" ? (
            <SettingsSection
              id={settingsSectionId("generation")}
              title={t("settings.group.generation")}
            >
              <SettingRow title={t("settings.row.documentType.title")} desc={t("settings.row.documentType.desc")}>
                <Select
                  className="settings-select"
                  value={settings.defaults.documentType}
                  onChange={(value: DocumentType) => updateDefaults({ documentType: value })}
                  options={[
                    { value: "pptx", label: t("settings.option.docType.pptx") },
                    { value: "docx", label: t("settings.option.docType.docx") },
                    { value: "xlsx", label: t("settings.option.docType.xlsx") },
                    { value: "report", label: t("settings.option.docType.report") },
                    { value: "img", label: t("settings.option.docType.img") },
                    { value: "gif", label: t("settings.option.docType.gif") },
                  ]}
                  style={{ minWidth: 220 }}
                />
              </SettingRow>
              <SettingRow title={t("settings.row.enableImages.title")} desc={t("settings.row.enableImages.desc")}>
                <SettingsToggle
                  label={toggleStatusLabel(settings.defaults.enableImages, locale)}
                  checked={settings.defaults.enableImages}
                  ariaLabel={t("settings.row.enableImages.title")}
                  onChange={(checked) => updateDefaults({ enableImages: checked })}
                />
              </SettingRow>
            </SettingsSection>
            ) : null}
            {activeSettingsSection === "notifications" ? (
            <SettingsSection
              id={settingsSectionId("notifications")}
              title={t("settings.group.notifications")}
            >
              <SettingRow title={t("settings.notifications.label")} desc={t("settings.notifications.desc")}>
                <SettingsToggle
                  label={toggleStatusLabel(notificationsEnabled, locale)}
                  checked={notificationsEnabled}
                  ariaLabel={t("settings.notifications.label")}
                  onChange={updateNotificationsEnabled}
                />
              </SettingRow>
              <SettingRow title={t("settings.notifications.testTitle")} desc={t("settings.notifications.testDesc")}>
                <Button className="settings-action" onClick={sendTestNotification} disabled={!notificationsEnabled}>
                  {t("settings.notifications.testButton")}
                </Button>
              </SettingRow>
            </SettingsSection>
            ) : null}
            {activeSettingsSection === "appearance" ? (
            <SettingsSection
              id={settingsSectionId("appearance")}
              title={t("settings.group.appearance")}
            >
              <SettingRow title={t("settings.row.language.title")} desc={t("settings.row.language.desc")}>
                <Select
                  className="settings-select"
                  value={locale}
                  onChange={(value: Locale) => setLocale(value)}
                  options={[
                    { value: "zh", label: t("settings.option.language.zh") },
                    { value: "en", label: t("settings.option.language.en") },
                  ]}
                  style={{ minWidth: 220 }}
                />
              </SettingRow>
            </SettingsSection>
            ) : null}
            {activeSettingsSection === "connection" ? (
            <SettingsSection
              id={settingsSectionId("connection")}
              title={t("settings.group.connection")}
            >
              <SettingRow variant="form" title={t("settings.row.jira.title")} desc={t("settings.row.jira.desc")}>
                <JiraConnectionCard />
              </SettingRow>
              <SettingRow variant="form" title={t("settings.row.liquipedia.title")} desc={t("settings.row.liquipedia.desc")}>
                <LiquipediaConnectionCard />
              </SettingRow>
            </SettingsSection>
            ) : null}
            {activeSettingsSection === "subscription" ? (
            <SettingsSection
              id={settingsSectionId("subscription")}
              title={t("settings.group.subscription")}
            >
              <SettingRow title={t("settings.row.redeem.title")} desc={t("settings.row.redeem.desc")}>
                <RedeemCodeCard onCreditRefresh={onCreditRefresh} />
              </SettingRow>
              {whoami?.mode === "logged_in" ? (
                <SettingRow title={t("login.invite.title")} desc={t("settings.row.invite.desc")}>
                  <div className="login-url-box">
                    <span className="login-url-text" title={inviteInfo?.invite_code || inviteError || ""}>
                      {inviteLoading
                        ? t("login.invite.loading")
                        : inviteError
                          ? inviteError
                          : inviteInfo?.invite_code || t("login.invite.unavailable")}
                    </span>
                    <Button
                      className="settings-action"
                      size="small"
                      icon={<CopyOutlined />}
                      aria-label={t("login.invite.copy")}
                      disabled={!inviteInfo?.invite_code}
                      onClick={copyInviteCode}
                    >
                      {t("login.url.copy")}
                    </Button>
                  </div>
                </SettingRow>
              ) : null}
            </SettingsSection>
            ) : null}
            {activeSettingsSection === "activity" ? (
            <SettingsSection
              id={settingsSectionId("activity")}
              title={t("settings.group.activity")}
              variant="full"
            >
              {activity}
            </SettingsSection>
            ) : null}
            {activeSettingsSection === "advanced" ? (
            <SettingsSection
              id={settingsSectionId("advanced")}
              title={advancedLabel}
              variant="full"
            >
              <SettingRow title={t("settings.row.imageWatermark.title")} desc={t("settings.row.imageWatermark.desc")}>
                <div className="settings-toggle-stack">
                  <SettingsToggle
                    label={t("settings.row.imageWatermark.showLabel")}
                    checked={displayedShowWatermark}
                    ariaLabel={t("settings.row.imageWatermark.showLabel")}
                    disabled={!hasPaidEntitlement}
                    onChange={(checked) => update({ imageWatermark: { ...watermarkSettings, showWatermark: checked, preferenceSource: "user" } }).catch(() => undefined)}
                  />
                  <div className="settings-note">{hasPaidEntitlement ? t("settings.row.imageWatermark.paidNotice") : t("settings.row.imageWatermark.freeNotice")}</div>
                </div>
              </SettingRow>
              <SettingRow variant="form" title={t("settings.row.provider.title")} desc={t("settings.row.provider.desc")}>
                <ProviderFormControl remote={settings.llmProvider} onSave={(next) => update({ llmProvider: next }).catch(() => undefined)} clearLabel={t("settings.row.provider.clear")} customProviderEnabled={whoami === null || whoami.mode === "logged_in"} onOpenLogin={onOpenLogin} />
              </SettingRow>
              <SettingRow variant="form" title={t("settings.row.proxy.title")} desc={t("settings.row.proxy.desc")}>
                <ProxyCard remote={settings.proxy} onSave={(next) => update({ proxy: next })} />
              </SettingRow>
              <DiagnosticsPanel />
              <h2 className="setting-group__subhead">{t("tasks.runtime.title")}</h2>
              <RuntimeRunsPanel />
              <SettingRow title={t("settings.row.onboarding.title")} desc={t("settings.row.onboarding.desc")}>
                <Button className="settings-action" onClick={rerunOnboarding}>{t("settings.row.onboarding.button")}</Button>
              </SettingRow>
            </SettingsSection>
            ) : null}
            {activeSettingsSection === "reset" ? (
            <SettingsSection
              id={settingsSectionId("reset")}
              title={t("settings.group.reset")}
              variant="danger"
            >
              <SettingRow title={t("settings.row.reset.title")} desc={t("settings.row.reset.desc")}>
                <Button className="settings-action" danger onClick={resetAll}>{t("settings.row.reset.button")}</Button>
              </SettingRow>
            </SettingsSection>
            ) : null}
            {activeSettingsSection === "about" ? (
            <SettingsSection
              id={settingsSectionId("about")}
              title={t("settings.group.about")}
              variant="full"
            >
              <AboutCard />
            </SettingsSection>
            ) : null}
          </>
        )}
        </section>
        </div>
      </div>
    </div>
  );
}

function hasImageWatermarkEntitlement(status: CreditStatus | null | undefined): boolean {
  if (!status) return false;
  return status.paidEntitlement === true;
}

function settingsSectionId(section: string): string {
  return `settings-section-${section}`;
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
      const next = { ...draft, ...patch };
      setDraft(next);
      if (providerHasContent(next)) {
        onSave(next);
      } else if (remote !== null) {
        onSave(null);
      }
      // Stale test result no longer reflects the current configuration.
      setTestResult(null);
    },
    [customProviderEnabled, draft, onSave, remote],
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

function formatCreditValue(credit: CreditInfo): string {
  if (credit.displayMode === "balance") return String(Math.max(0, credit.total));
  return `${Math.max(0, credit.total - credit.used)} / ${credit.total}`;
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
        <ImeInput
          style={{ flex: 1 }}
          value={code}
          onValueChange={(value) => setCode(value.toUpperCase())}
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

function SettingsSection({
  id,
  title,
  variant = "standard",
  children,
}: {
  id: string;
  title: string;
  variant?: "standard" | "full" | "danger";
  children: ReactNode;
}) {
  const titleId = `${id}-title`;
  return (
    <section className="setting-group" id={id} data-variant={variant} aria-labelledby={titleId}>
      <h2 className="ui-sr-only" id={titleId}>{title}</h2>
      <div className="settings-section-body">{children}</div>
    </section>
  );
}

function SettingsToggle({
  label,
  ariaLabel,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  ariaLabel: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="settings-toggle-control">
      <span>{label}</span>
      <Switch aria-label={ariaLabel} checked={checked} disabled={disabled} onChange={onChange} />
    </div>
  );
}

function toggleStatusLabel(checked: boolean, locale: Locale): string {
  if (locale === "zh") return checked ? "已开启" : "已关闭";
  return checked ? "On" : "Off";
}

function SettingRow({
  title,
  desc,
  variant = "standard",
  children,
}: {
  title: string;
  desc: string;
  variant?: "standard" | "form" | "actions";
  children: React.ReactNode;
}) {
  return (
    <div className="setting-row" data-variant={variant}>
      <div className="setting-copy">
        <h3>{title}</h3>
        <p>{desc}</p>
      </div>
      <div className="setting-control">{children}</div>
    </div>
  );
}

const ATLASSIAN_PAT_DOCUMENTATION_URL = "https://confluence.atlassian.com/enterprise/using-personal-access-tokens-1026032365.html";
const LIQUIPEDIA_API_TERMS_URL = "https://liquipedia.net/api-terms-of-use";

function JiraConnectionCard() {
  const t = useT();
  const [remote, setRemote] = useState<JiraConnectionSummary>({ configured: false, baseUrl: "", authType: "" });
  const [baseUrl, setBaseUrl] = useState("");
  const [authType, setAuthType] = useState<JiraAuthType>("token");
  const [username, setUsername] = useState("");
  const [secret, setSecret] = useState("");
  const [probe, setProbe] = useState<JiraProbeResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const timeout = window.setTimeout(() => {
      if (!cancelled) {
        setLoading(false);
        setError(t("settings.row.jira.loadTimeout"));
      }
    }, 15_000);
    officecli.getJiraConnection()
      .then((summary) => {
        if (cancelled) return;
        setRemote(summary);
        if (summary.baseUrl) {
          setBaseUrl(summary.baseUrl);
        }
        if (summary.configured) {
          setAuthType(summary.authType === "basic" ? "basic" : "token");
          setUsername(summary.username ?? "");
        }
      })
      .catch((err) => {
        if (!cancelled) setError(errorMessage(err));
      })
      .finally(() => {
        window.clearTimeout(timeout);
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [t]);

  const sameStoredScope = remote.configured &&
    remote.baseUrl.replace(/\/+$/, "") === baseUrl.trim().replace(/\/+$/, "") &&
    remote.authType === authType &&
    (remote.username ?? "") === (authType === "basic" ? username.trim() : "");
  const canSave = Boolean(baseUrl.trim()) && (authType !== "basic" || Boolean(username.trim())) &&
    (Boolean(secret.trim()) || sameStoredScope) && !saving;

  const save = useCallback(async () => {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    setProbe(null);
    try {
      const nextProbe = await officecli.saveJiraConnection({
        baseUrl: baseUrl.trim(),
        auth: {
          type: authType,
          ...(authType === "basic" ? { username: username.trim() } : {}),
          secret,
        },
      });
      const summary = await officecli.getJiraConnection();
      setRemote(summary);
      setProbe(nextProbe);
      setSecret("");
      window.dispatchEvent(new Event("officedex:jira-connection-updated"));
      void message.success(t("settings.row.jira.saveSuccess"));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }, [authType, baseUrl, canSave, secret, t, username]);

  const clear = useCallback(async () => {
    setClearing(true);
    setError(null);
    try {
      await officecli.clearJiraConnection();
      setRemote({ configured: false, baseUrl: "", authType: "" });
      setProbe(null);
      setSecret("");
      window.dispatchEvent(new Event("officedex:jira-connection-updated"));
      void message.success(t("settings.row.jira.clearSuccess"));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setClearing(false);
    }
  }, [t]);

  if (loading) return <Spin />;

  return (
    <div className="jira-connection-card">
      <label>
        <span>{t("settings.row.jira.baseUrl")}</span>
        <Input aria-label={t("settings.row.jira.baseUrl")} value={baseUrl} onChange={(event) => { setBaseUrl(event.target.value); setProbe(null); }} />
      </label>
      <label>
        <span>{t("settings.row.jira.authType")}</span>
        <Select<JiraAuthType>
          ariaLabel={t("settings.row.jira.authType")}
          value={authType}
          options={[
            { value: "token", label: "Personal Access Token" },
            { value: "basic", label: t("settings.row.jira.basicAuth") },
          ]}
          onChange={(value) => { setAuthType(value); setSecret(""); setProbe(null); }}
        />
      </label>
      {authType === "basic" ? (
        <label>
          <span>{t("settings.row.jira.username")}</span>
          <Input aria-label={t("settings.row.jira.username")} autoComplete="username" value={username} onChange={(event) => { setUsername(event.target.value); setProbe(null); }} />
        </label>
      ) : null}
      <label>
        <span>{authType === "token" ? "PAT" : t("settings.row.jira.password")}</span>
        <PasswordInput
          aria-label={authType === "token" ? "PAT" : t("settings.row.jira.password")}
          autoComplete="off"
          value={secret}
          placeholder={remote.configured && sameStoredScope ? t("settings.row.jira.keepSecret") : undefined}
          onChange={(event) => { setSecret(event.target.value); setProbe(null); }}
          visibilityLabels={{ show: t("settings.row.jira.showSecret"), hide: t("settings.row.jira.hideSecret") }}
        />
      </label>
      {authType === "token" ? (
        <div className="jira-connection-card__help">
          <strong>{t("settings.row.jira.patHelpTitle")}</strong>
          <ol>
            <li>{t("settings.row.jira.patHelpStep1")}</li>
            <li>{t("settings.row.jira.patHelpStep2")}</li>
            <li>{t("settings.row.jira.patHelpStep3")}</li>
          </ol>
          <div className="settings-note">{t("settings.row.jira.patHelpAdminNote")}</div>
          <a
            className="jira-connection-card__documentation-link"
            href={ATLASSIAN_PAT_DOCUMENTATION_URL}
            target="_blank"
            rel="noopener noreferrer"
          >
            <GlobalOutlined />
            <span>{t("settings.row.jira.patDocumentation")}</span>
          </a>
        </div>
      ) : null}
      <div className="settings-note">{t("settings.row.jira.secretNote")}</div>
      {remote.configured ? (
        <div className="jira-connection-card__status">
          <Tag color="success">{t("settings.row.jira.configured")}</Tag>
          <span>{remote.baseUrl}</span>
        </div>
      ) : null}
      {probe ? <div className="jira-connection-card__probe">{probe.server.serverTitle || "Jira"} {probe.server.version} · {probe.user.displayName || probe.user.name}</div> : null}
      {error ? <div className="jira-connection-card__error" role="alert">{error}</div> : null}
      <div className="jira-connection-card__actions">
        <Button type="primary" loading={saving} disabled={!canSave} onClick={() => void save()}>
          {t("settings.row.jira.saveAndTest")}
        </Button>
        {remote.configured ? <Button type="link" danger loading={clearing} onClick={() => void clear()}>{t("settings.row.jira.clear")}</Button> : null}
      </div>
    </div>
  );
}

function LiquipediaConnectionCard() {
  const t = useT();
  const [remote, setRemote] = useState<LiquipediaConnectionSummary>({ configured: false, baseUrl: "https://liquipedia.net/dota2" });
  const [baseUrl, setBaseUrl] = useState("https://liquipedia.net/dota2");
  const [contact, setContact] = useState("");
  const [probe, setProbe] = useState<LiquipediaProbeResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const timeout = window.setTimeout(() => {
      if (!cancelled) {
        setLoading(false);
        setError(t("settings.row.liquipedia.loadTimeout"));
      }
    }, 15_000);
    officecli.getLiquipediaConnection().then((summary) => {
      if (cancelled) return;
      setRemote(summary);
      if (summary.baseUrl) setBaseUrl(summary.baseUrl);
      if (summary.contact) setContact(summary.contact);
    }).catch((err) => { if (!cancelled) setError(errorMessage(err)); }).finally(() => { window.clearTimeout(timeout); if (!cancelled) setLoading(false); });
    return () => { cancelled = true; window.clearTimeout(timeout); };
  }, [t]);

  const canSave = Boolean(baseUrl.trim() && contact.trim()) && !saving;
  const save = useCallback(async () => {
    if (!canSave) return;
    setSaving(true); setError(null); setProbe(null);
    try {
      const nextProbe = await officecli.saveLiquipediaConnection({ baseUrl: baseUrl.trim(), contact: contact.trim() });
      const summary = await officecli.getLiquipediaConnection();
      setRemote(summary); setProbe(nextProbe);
      window.dispatchEvent(new Event("officedex:liquipedia-connection-updated"));
      void message.success(t("settings.row.liquipedia.saveSuccess"));
    } catch (err) { setError(errorMessage(err)); } finally { setSaving(false); }
  }, [baseUrl, canSave, contact, t]);
  const clear = useCallback(async () => {
    setClearing(true); setError(null);
    try {
      await officecli.clearLiquipediaConnection();
      setRemote({ configured: false, baseUrl: "https://liquipedia.net/dota2" }); setProbe(null);
      window.dispatchEvent(new Event("officedex:liquipedia-connection-updated"));
      void message.success(t("settings.row.liquipedia.clearSuccess"));
    } catch (err) { setError(errorMessage(err)); } finally { setClearing(false); }
  }, [t]);
  if (loading) return <Spin />;
  return <div className="jira-connection-card">
    <label><span>{t("settings.row.liquipedia.baseUrl")}</span><Input aria-label={t("settings.row.liquipedia.baseUrl")} value={baseUrl} onChange={(event) => { setBaseUrl(event.target.value); setProbe(null); }} /></label>
    <label><span>{t("settings.row.liquipedia.contact")}</span><Input aria-label={t("settings.row.liquipedia.contact")} value={contact} placeholder={t("settings.row.liquipedia.contactPlaceholder")} onChange={(event) => { setContact(event.target.value); setProbe(null); }} /></label>
    <div className="jira-connection-card__help">
      <strong>{t("settings.row.liquipedia.contactHelpTitle")}</strong>
      <div>{t("settings.row.liquipedia.contactHelpBody")}</div>
      <div className="settings-note">{t("settings.row.liquipedia.termsNote")}</div>
      <a className="jira-connection-card__documentation-link" href={LIQUIPEDIA_API_TERMS_URL} target="_blank" rel="noopener noreferrer"><GlobalOutlined /><span>{t("settings.row.liquipedia.termsLink")}</span></a>
    </div>
    {remote.configured ? <div className="jira-connection-card__status"><Tag color="success">{t("settings.row.liquipedia.configured")}</Tag><span>{remote.baseUrl}</span></div> : null}
    {probe ? <div className="jira-connection-card__probe">{probe.siteName} · {probe.generator}<br />{probe.userAgent}</div> : null}
    {error ? <div className="jira-connection-card__error" role="alert">{error}</div> : null}
    <div className="jira-connection-card__actions"><Button type="primary" loading={saving} disabled={!canSave} onClick={() => void save()}>{t("settings.row.liquipedia.saveAndTest")}</Button>{remote.configured ? <Button type="link" danger loading={clearing} onClick={() => void clear()}>{t("settings.row.liquipedia.clear")}</Button> : null}</div>
  </div>;
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
        <ImeInput
          placeholder={t("settings.row.proxy.urlPlaceholder")}
          value={url}
          onValueChange={(value) => {
            setUrl(value);
            if (validationError) setValidationError(undefined);
          }}
          aria-label={t("settings.row.proxy.urlLabel")}
          status={validationError ? "error" : undefined}
        />
      ) : null}
      {validationError ? (
        <div role="alert" style={{ color: "var(--od-danger, #d92d20)" }}>
          {validationError}
        </div>
      ) : null}
      <Button type="primary" onClick={handleSave} disabled={!canSave} loading={submitting}>
        {t("settings.row.proxy.save")}
      </Button>
    </Space>
  );
}
