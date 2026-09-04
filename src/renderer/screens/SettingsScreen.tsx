import { Button, Modal, Progress, Select, Spin, Tag, toast as message } from "../ui";
import { BgColorsOutlined, ClockCircleOutlined, CommentOutlined, ControlOutlined, CopyOutlined, DownloadOutlined, ExclamationCircleFilled, GridOutlined, GithubOutlined, GlobalOutlined, HistoryOutlined, InfoCircleOutlined, LineChartOutlined, NotificationOutlined, RocketOutlined, SafetyCertificateOutlined, StarOutlined, SyncOutlined } from "../ui/icons";
import { useCallback, useEffect, useState } from "react";
import { MaterialSymbol } from "../components/Shell";
import type { ReactNode } from "react";
import { DiagnosticsPanel } from "../components/DiagnosticsPanel";
import { RuntimeRunsPanel } from "../components/RuntimeRunsPanel";
import { officecli } from "../bridge";
import { useSettings } from "../useSettings";
import { useAppUpdate } from "../useAppUpdate";
import { formatTestResult, ProviderForm } from "../components/ProviderForm";
import { useT, useLocale, useSetLocale, type Locale } from "../i18n";
import { readNotificationsEnabled, setNotificationsEnabled as persistNotificationsEnabled } from "../notifications";
import type { CreditStatus, DocumentType, GenerateDefaults, InviteInfo, LlmProvider, ProviderTestResult, WhoAmIResult } from "../../shared/types";
import { errorMessage } from "../utils/values";

import { settingsSectionId, SettingsSection, SettingsToggle, SettingRow, toggleStatusLabel } from "./settings/SettingsPrimitives";
import { RedeemCodeCard } from "./settings/RedeemCodeCard";
import { JiraConnectionCard } from "./settings/JiraConnectionCard";
import { LiquipediaConnectionCard } from "./settings/LiquipediaConnectionCard";
import { ProxyCard } from "./settings/ProxyCard";

function hasImageWatermarkEntitlement(status: CreditStatus | null | undefined): boolean {
  if (!status) return false;
  return status.paidEntitlement === true;
}

const EMPTY_PROVIDER_DRAFT: LlmProvider = { type: "official", baseUrl: "", apiKey: "", model: "" };

function providerHasContent(p: LlmProvider): boolean {
  return p.type !== "official" && Boolean(p.baseUrl.trim() || p.apiKey.trim() || p.model.trim());
}

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
