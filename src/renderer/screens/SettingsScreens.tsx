import { Button, Input, Modal, PasswordInput, Progress, Select, Space, Spin, Switch, Tag, toast as message } from "../ui";
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
} from "../ui/icons";
import { useCallback, useEffect, useRef, useState } from "react";
import { MaterialSymbol } from "../components/Shell";
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
import type { AuthEvent, CreditStatus, DocumentType, GenerateDefaults, ImagePromptTemplate, InviteInfo, JiraAuthType, JiraConnectionSummary, JiraProbeResult, LiquipediaConnectionSummary, LiquipediaProbeResult, LlmProvider, ProviderTestResult, ProxySettings, WhoAmIResult } from "../../shared/types";
import { exportLocalImageTemplatesJSON, importLocalImageTemplatesJSON, loadLocalImageTemplates, saveLocalImageTemplates } from "../localImageTemplates";
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
  const { settings, defaultWorkspaceDir, update: rawUpdate, loading, saving, error } = useSettings();
  const t = useT();
  const locale = useLocale();
  const setLocale = useSetLocale();
  const [notificationsEnabled, setNotificationsEnabled] = useState(() => readNotificationsEnabled());
  const [whoami, setWhoami] = useState<WhoAmIResult | null>(null);
  const [creditStatus, setCreditStatus] = useState<CreditStatus | null>(null);
  const [inviteInfo, setInviteInfo] = useState<InviteInfo | null>(null);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteLoading, setInviteLoading] = useState(false);
  const [localTemplates, setLocalTemplates] = useState<ImagePromptTemplate[]>(() => loadLocalImageTemplates());
  const [pasteModalOpen, setPasteModalOpen] = useState(false);
  const [pasteTemplateJSON, setPasteTemplateJSON] = useState("");
  const [activeSettingsSection, setActiveSettingsSection] = useState("generation");
  const localTemplateFileInputRef = useRef<HTMLInputElement>(null);

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
          waiting2048Enabled: false,
        }).catch(() => undefined),
    });
  }, [update, t]);

  const replaceLocalTemplates = useCallback((raw: string): boolean => {
    try {
      const imported = importLocalImageTemplatesJSON(raw);
      saveLocalImageTemplates(imported);
      setLocalTemplates(imported);
      void message.success(t("settings.localImageTemplates.importSuccess", { count: imported.length }));
      return true;
    } catch (error) {
      void message.error(t("settings.localImageTemplates.importError", { error: error instanceof Error ? error.message : String(error) }));
      return false;
    }
  }, [t]);

  const importLocalTemplatesFile = useCallback(async (file: File) => {
    try {
      replaceLocalTemplates(await readFileText(file));
    } catch (error) {
      void message.error(t("settings.localImageTemplates.importError", { error: error instanceof Error ? error.message : String(error) }));
    }
  }, [replaceLocalTemplates, t]);

  const downloadLocalTemplates = useCallback(() => {
    const json = exportLocalImageTemplatesJSON(localTemplates);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "officedex-local-image-templates.json";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    void message.success(t("settings.localImageTemplates.exportSuccess", { count: localTemplates.length }));
  }, [localTemplates, t]);

  const copyLocalTemplatesJSON = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(exportLocalImageTemplatesJSON(localTemplates));
      void message.success(t("settings.localImageTemplates.copySuccess", { count: localTemplates.length }));
    } catch {
      void message.error(t("settings.localImageTemplates.copyError"));
    }
  }, [localTemplates, t]);

  const importPastedLocalTemplates = useCallback(() => {
    const ok = replaceLocalTemplates(pasteTemplateJSON);
    if (ok) {
      setPasteTemplateJSON("");
      setPasteModalOpen(false);
    }
  }, [pasteTemplateJSON, replaceLocalTemplates]);

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

  const settingsSections = [
    { key: "generation", label: t("settings.group.generation"), icon: "auto_awesome" },
    { key: "notifications", label: t("settings.group.notifications"), icon: "notifications" },
    { key: "appearance", label: t("settings.group.appearance"), icon: "palette" },
    { key: "workspace", label: t("settings.group.workspace"), icon: "folder_open" },
    { key: "connection", label: t("settings.group.connection"), icon: "tune" },
    { key: "subscription", label: t("settings.group.subscription"), icon: "shield_lock" },
    { key: "activity", label: t("settings.group.activity"), icon: "schedule" },
    { key: "diagnostics", label: t("diagnostics.title"), icon: "query_stats" },
    { key: "reset", label: t("settings.group.reset"), icon: "history_edu" },
    { key: "about", label: t("settings.group.about"), icon: "grid_view" },
  ];

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
        <div className="settings-secondary-menu">
        <nav aria-label={t("settings.secondaryMenu.label")}>
          {settingsSections.map((section) => (
            <button
              key={section.key}
              type="button"
              className={activeSettingsSection === section.key ? "active" : ""}
              aria-label={section.label}
              aria-current={activeSettingsSection === section.key ? "true" : undefined}
              onClick={() => selectSettingsSection(section.key)}
            >
              <MaterialSymbol name={section.icon} />
              <span>{section.label}</span>
            </button>
          ))}
        </nav>
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
            {activeSettingsSection === "generation" ? (
            <div className="setting-group" id={settingsSectionId("generation")}>
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
                    { value: "gif", label: t("settings.option.docType.gif") },
                  ]}
                  style={{ minWidth: 220 }}
                />
              </SettingRow>
              <SettingRow title={t("settings.row.enableImages.title")} desc={t("settings.row.enableImages.desc")}>
                <Switch
                  aria-label={t("settings.row.enableImages.title")}
                  checked={settings.defaults.enableImages}
                  onChange={(checked) => updateDefaults({ enableImages: checked })}
                />
              </SettingRow>
              <SettingRow title={t("settings.row.waiting2048.title")} desc={t("settings.row.waiting2048.desc")}>
                <Switch
                  aria-label={t("settings.row.waiting2048.title")}
                  checked={settings.waiting2048Enabled}
                  onChange={(checked) => update({ waiting2048Enabled: checked }).catch(() => undefined)}
                />
              </SettingRow>
              <SettingRow title={t("settings.row.imageWatermark.title")} desc={t("settings.row.imageWatermark.desc")}>
                <div className="settings-stack">
                  <Switch
                    aria-label={t("settings.row.imageWatermark.showLabel")}
                    checked={displayedShowWatermark}
                    disabled={!hasPaidEntitlement}
                    onChange={(checked) =>
                      update({
                        imageWatermark: { ...watermarkSettings, showWatermark: checked, preferenceSource: "user" },
                      }).catch(() => undefined)
                    }
                  />
                  <span className="settings-inline-label">{t("settings.row.imageWatermark.showLabel")}</span>
                  <div className="settings-note">
                    {hasPaidEntitlement
                      ? t("settings.row.imageWatermark.paidNotice")
                      : t("settings.row.imageWatermark.freeNotice")}
                  </div>
                </div>
              </SettingRow>
              <SettingRow title={t("settings.localImageTemplates.title")} desc={t("settings.localImageTemplates.desc")}>
                <div className="local-image-template-tools">
                  <div className="settings-note">{formatLocalTemplateCount(localTemplates.length, t)}</div>
                  <Space wrap>
                    <Button icon={<FolderOpenOutlined />} onClick={() => localTemplateFileInputRef.current?.click()}>
                      {t("settings.localImageTemplates.importFile")}
                    </Button>
                    <Button icon={<CopyOutlined />} onClick={() => setPasteModalOpen(true)}>
                      {t("settings.localImageTemplates.paste")}
                    </Button>
                    <Button icon={<DownloadOutlined />} onClick={downloadLocalTemplates}>
                      {t("settings.localImageTemplates.download")}
                    </Button>
                    <Button icon={<CopyOutlined />} onClick={copyLocalTemplatesJSON}>
                      {t("settings.localImageTemplates.copy")}
                    </Button>
                  </Space>
                  <input
                    ref={localTemplateFileInputRef}
                    type="file"
                    accept="application/json,.json"
                    className="local-image-template-file-input"
                    onChange={(event) => {
                      const file = event.currentTarget.files?.[0];
                      event.currentTarget.value = "";
                      if (file) void importLocalTemplatesFile(file);
                    }}
                  />
                </div>
              </SettingRow>
            </div>
            ) : null}
            {activeSettingsSection === "notifications" ? (
            <div className="setting-group" id={settingsSectionId("notifications")}>
              <h2>{t("settings.group.notifications")}</h2>
              <SettingRow title={t("settings.notifications.label")} desc={t("settings.notifications.desc")}>
                <Switch
                  aria-label={t("settings.notifications.label")}
                  checked={notificationsEnabled}
                  onChange={updateNotificationsEnabled}
                />
              </SettingRow>
              <SettingRow title={t("settings.notifications.testTitle")} desc={t("settings.notifications.testDesc")}>
                <Button onClick={sendTestNotification} disabled={!notificationsEnabled}>
                  {t("settings.notifications.testButton")}
                </Button>
              </SettingRow>
            </div>
            ) : null}
            {activeSettingsSection === "appearance" ? (
            <div className="setting-group" id={settingsSectionId("appearance")}>
              <h2>{t("settings.group.appearance")}</h2>
              <SettingRow title={t("settings.row.language.title")} desc={t("settings.row.language.desc")}>
                <Select
                  value={locale}
                  onChange={(value: Locale) => setLocale(value)}
                  options={[
                    { value: "zh", label: t("settings.option.language.zh") },
                    { value: "en", label: t("settings.option.language.en") },
                  ]}
                  style={{ minWidth: 220 }}
                />
              </SettingRow>
            </div>
            ) : null}
            {activeSettingsSection === "workspace" ? (
            <div className="setting-group" id={settingsSectionId("workspace")}>
              <h2>{t("settings.group.workspace")}</h2>
              <SettingRow title={t("settings.row.outputDir.title")} desc={t("settings.row.outputDir.desc")}>
                <ImeInput
                  disabled
                  value={defaultWorkspaceDir || t("settings.row.outputDir.placeholder")}
                />
              </SettingRow>
            </div>
            ) : null}
            {activeSettingsSection === "connection" ? (
            <div className="setting-group" id={settingsSectionId("connection")}>
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
              <SettingRow title={t("settings.row.jira.title")} desc={t("settings.row.jira.desc")}>
                <JiraConnectionCard />
              </SettingRow>
              <SettingRow title="Liquipedia Dota 2" desc="通过官方 MediaWiki API 获取赛事和版本更新，数据写入 OfficeDex 托管 Sheet。">
                <LiquipediaConnectionCard />
              </SettingRow>
            </div>
            ) : null}
            {activeSettingsSection === "subscription" ? (
            <div className="setting-group" id={settingsSectionId("subscription")}>
              <h2>{t("settings.group.subscription")}</h2>
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
            </div>
            ) : null}
            {activeSettingsSection === "activity" ? (
            <div className="setting-group" id={settingsSectionId("activity")}>
              <h2>{t("settings.group.activity")}</h2>
              <p className="setting-group__hint">{t("settings.activity.hint")}</p>
              {activity}
            </div>
            ) : null}
            {activeSettingsSection === "diagnostics" ? (
            <div className="setting-group" id={settingsSectionId("diagnostics")}>
              <h2>{t("diagnostics.title")}</h2>
              <DiagnosticsPanel />
              <h2 className="setting-group__subhead">{t("tasks.runtime.title")}</h2>
              <RuntimeRunsPanel />
            </div>
            ) : null}
            {activeSettingsSection === "reset" ? (
            <div className="setting-group" id={settingsSectionId("reset")}>
              <h2>{t("settings.group.reset")}</h2>
              <SettingRow title={t("settings.row.onboarding.title")} desc={t("settings.row.onboarding.desc")}>
                <Button onClick={rerunOnboarding}>{t("settings.row.onboarding.button")}</Button>
              </SettingRow>
              <SettingRow title={t("settings.row.reset.title")} desc={t("settings.row.reset.desc")}>
                <Button danger onClick={resetAll}>{t("settings.row.reset.button")}</Button>
              </SettingRow>
            </div>
            ) : null}
            {activeSettingsSection === "about" ? (
            <div className="setting-group" id={settingsSectionId("about")}>
              <h2>{t("settings.group.about")}</h2>
              <AboutCard />
            </div>
            ) : null}
            <Modal
              title={t("settings.localImageTemplates.pasteTitle")}
              open={pasteModalOpen}
              okText={t("settings.localImageTemplates.import")}
              cancelText={t("settings.common.cancel")}
              onOk={importPastedLocalTemplates}
              onCancel={() => setPasteModalOpen(false)}
              destroyOnHidden
            >
              <ImeTextArea
                value={pasteTemplateJSON}
                onValueChange={setPasteTemplateJSON}
                placeholder={t("settings.localImageTemplates.pastePlaceholder")}
                autoSize={{ minRows: 8, maxRows: 16 }}
              />
            </Modal>
          </>
        )}
      </section>
    </div>
  );
}

function hasImageWatermarkEntitlement(status: CreditStatus | null | undefined): boolean {
  if (!status) return false;
  return status.paidEntitlement === true;
}

function formatLocalTemplateCount(count: number, t: (key: string, vars?: Record<string, string | number>) => string): string {
  return count === 1
    ? t("settings.localImageTemplates.countOne")
    : t("settings.localImageTemplates.countOther", { count });
}

function readFileText(file: File): Promise<string> {
  if (typeof file.text === "function") return file.text();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read file."));
    reader.readAsText(file);
  });
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
      const result = await officecli.login({});
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
        setError("Jira 连接读取超时，请稍后重试。");
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
  }, []);

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
        setError("Liquipedia 连接读取超时，请稍后重试。");
      }
    }, 15_000);
    officecli.getLiquipediaConnection().then((summary) => {
      if (cancelled) return;
      setRemote(summary);
      if (summary.baseUrl) setBaseUrl(summary.baseUrl);
      if (summary.contact) setContact(summary.contact);
    }).catch((err) => { if (!cancelled) setError(errorMessage(err)); }).finally(() => { window.clearTimeout(timeout); if (!cancelled) setLoading(false); });
    return () => { cancelled = true; window.clearTimeout(timeout); };
  }, []);

  const canSave = Boolean(baseUrl.trim() && contact.trim()) && !saving;
  const save = useCallback(async () => {
    if (!canSave) return;
    setSaving(true); setError(null); setProbe(null);
    try {
      const nextProbe = await officecli.saveLiquipediaConnection({ baseUrl: baseUrl.trim(), contact: contact.trim() });
      const summary = await officecli.getLiquipediaConnection();
      setRemote(summary); setProbe(nextProbe);
      window.dispatchEvent(new Event("officedex:liquipedia-connection-updated"));
      void message.success("Liquipedia 连接已测试并保存。");
    } catch (err) { setError(errorMessage(err)); } finally { setSaving(false); }
  }, [baseUrl, canSave, contact]);
  const clear = useCallback(async () => {
    setClearing(true); setError(null);
    try {
      await officecli.clearLiquipediaConnection();
      setRemote({ configured: false, baseUrl: "https://liquipedia.net/dota2" }); setProbe(null);
      window.dispatchEvent(new Event("officedex:liquipedia-connection-updated"));
      void message.success("Liquipedia 连接已清除。");
    } catch (err) { setError(errorMessage(err)); } finally { setClearing(false); }
  }, []);
  if (loading) return <Spin />;
  return <div className="jira-connection-card">
    <label><span>数据源地址</span><Input aria-label="Liquipedia 数据源地址" value={baseUrl} onChange={(event) => { setBaseUrl(event.target.value); setProbe(null); }} /></label>
    <label><span>联系邮箱或网址</span><Input aria-label="Liquipedia 联系方式" value={contact} placeholder="例如：dev@example.com" onChange={(event) => { setContact(event.target.value); setProbe(null); }} /></label>
    <div className="jira-connection-card__help">
      <strong>为什么需要联系方式</strong>
      <div>Liquipedia 官方要求 API User-Agent 标识项目并包含联系方式。OfficeDex 会使用 MediaWiki API，并缓存结果、限制到每 2 秒最多 1 次请求；解析请求每 30 秒最多 1 次。</div>
      <div className="settings-note">自动访问 HTML 页面不被允许；OfficeDex 只同步文本字段与来源链接，并在 Sheet 中保留 CC BY-SA 署名。</div>
      <a className="jira-connection-card__documentation-link" href={LIQUIPEDIA_API_TERMS_URL} target="_blank" rel="noopener noreferrer"><GlobalOutlined /><span>查看 Liquipedia 官方 API 条款</span></a>
    </div>
    {remote.configured ? <div className="jira-connection-card__status"><Tag color="success">已配置</Tag><span>{remote.baseUrl}</span></div> : null}
    {probe ? <div className="jira-connection-card__probe">{probe.siteName} · {probe.generator}<br />{probe.userAgent}</div> : null}
    {error ? <div className="jira-connection-card__error" role="alert">{error}</div> : null}
    <div className="jira-connection-card__actions"><Button type="primary" loading={saving} disabled={!canSave} onClick={() => void save()}>测试并保存</Button>{remote.configured ? <Button type="link" danger loading={clearing} onClick={() => void clear()}>清除连接</Button> : null}</div>
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
