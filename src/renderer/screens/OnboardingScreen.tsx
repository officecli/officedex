import { Alert, Button, Input, Modal, message, Radio, Select, Space, Switch, Tag } from "antd";
import { FolderOpenOutlined } from "@ant-design/icons";
import { useCallback, useEffect, useState } from "react";
import { officecli } from "../bridge";
import { useT } from "../i18n";
import { broadcastSettingsChanged } from "../useSettings";
import { defaultProxySettings, isValidProxyUrl } from "../defaults";
import { formatTestResult, ProviderForm } from "../components/ProviderForm";
import type { DocumentType, GenerateDefaults, LlmProvider, ProviderTestResult, ProxySettings, UserSettings, WhoAmIResult } from "../../shared/types";

interface OnboardingScreenProps {
  settings: UserSettings;
  defaultWorkspaceDir: string;
  onComplete: () => void;
}

interface DraftSettings {
  defaults: GenerateDefaults;
  outputDir: string | null;
  llmProvider: LlmProvider;
  proxy: ProxySettings | null;
}

const EMPTY_PROVIDER: LlmProvider = { type: "official", baseUrl: "", apiKey: "", model: "" };

function shouldOfferProxyStep(result: ProviderTestResult): boolean {
  if (result.unavailable) return false;
  const messageText = `${result.error ?? ""}`.toLowerCase();
  return [
    "network",
    "connect",
    "connection",
    "timeout",
    "timed out",
    "proxy",
    "dial",
    "lookup",
    "unreachable",
    "refused",
    "reset",
    "tls",
  ].some((needle) => messageText.includes(needle));
}

export function OnboardingScreen({ settings, defaultWorkspaceDir, onComplete }: OnboardingScreenProps) {
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [providerTestResult, setProviderTestResult] = useState<ProviderTestResult | null>(null);
  const [proxyValidationError, setProxyValidationError] = useState<string | undefined>(undefined);
  const [whoami, setWhoami] = useState<WhoAmIResult | null>(null);
  const t = useT();
  const [draft, setDraft] = useState<DraftSettings>(() => ({
    defaults: { ...settings.defaults },
    outputDir: settings.outputDir,
    llmProvider: settings.llmProvider ?? { ...EMPTY_PROVIDER },
    proxy: settings.proxy,
  }));
  const customProviderEnabled = whoami === null || whoami.mode === "logged_in";

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

  const updateDefaults = useCallback((patch: Partial<GenerateDefaults>) => {
    setDraft((current) => ({ ...current, defaults: { ...current.defaults, ...patch } }));
  }, []);

  const updateProvider = useCallback((patch: Partial<LlmProvider>) => {
    setDraft((current) => ({ ...current, llmProvider: { ...current.llmProvider, ...patch } }));
    setProviderTestResult(null);
  }, []);

  const pickOutputDir = useCallback(async () => {
    const picked = await officecli.openDirectoryDialog();
    if (picked) {
      setDraft((current) => ({ ...current, outputDir: picked }));
    }
  }, []);

  const finish = useCallback(async (proxyOverride?: ProxySettings | null) => {
    setBusy(true);
    try {
      const providerHasDraftContent = Boolean(draft.llmProvider.baseUrl || draft.llmProvider.apiKey || draft.llmProvider.model);
      const provider = providerHasDraftContent
        ? draft.llmProvider
        : null;
      const patch: Partial<UserSettings> = {
        defaults: draft.defaults,
        outputDir: draft.outputDir,
        onboardingCompletedAt: new Date().toISOString(),
      };
      if (provider === null || customProviderEnabled) {
        patch.llmProvider = provider;
      }
      if (proxyOverride !== undefined) {
        patch.proxy = proxyOverride;
      }
      const next = await officecli.updateSettings(patch);
      broadcastSettingsChanged(next);
      onComplete();
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      message.error(t("onboarding.finishFailed", { error: errMsg }));
      throw err;
    } finally {
      setBusy(false);
    }
  }, [customProviderEnabled, draft, onComplete, t]);

  const testOfficialProvider = useCallback(async (proxy: ProxySettings | null) => {
    const result = await officecli.testProvider({
      llmProvider: null,
      proxy,
      useProviderOverride: true,
      useProxyOverride: true,
      allowPaidOfficialProbe: true,
    });
    setProviderTestResult(result);
    return result;
  }, []);

  const runOfficialProbeAndFinish = useCallback(async (proxy: ProxySettings | null, proxyOverride?: ProxySettings | null) => {
    setBusy(true);
    try {
      const result = await testOfficialProvider(proxy);
      if (result.ok) {
        await finish(proxyOverride);
        return;
      }
      if (shouldOfferProxyStep(result)) {
        setDraft((current) => ({
          ...current,
          proxy: {
            enabled: true,
            url: current.proxy?.url || defaultProxySettings.url,
          },
        }));
        setProxyValidationError(undefined);
        setStep(2);
      }
    } catch (err) {
      const result: ProviderTestResult = {
        ok: false,
        httpStatus: 0,
        latencyMs: 0,
        url: "",
        error: err instanceof Error ? err.message : String(err),
        probeType: "officialPaid",
      };
      setProviderTestResult(result);
      if (shouldOfferProxyStep(result)) {
        setDraft((current) => ({
          ...current,
          proxy: {
            enabled: true,
            url: current.proxy?.url || defaultProxySettings.url,
          },
        }));
        setStep(2);
      }
    } finally {
      setBusy(false);
    }
  }, [finish, testOfficialProvider]);

  const confirmOfficialProbe = useCallback((onOk: () => Promise<void>) => {
    Modal.confirm({
      title: t("onboarding.provider.paidProbeTitle"),
      content: t("onboarding.provider.paidProbeBody"),
      okText: t("onboarding.provider.paidProbeOk"),
      cancelText: t("settings.common.cancel"),
      onOk,
    });
  }, [t]);

  const finishOrTestOfficial = useCallback(async () => {
    const provider = customProviderEnabled && (draft.llmProvider.baseUrl || draft.llmProvider.apiKey || draft.llmProvider.model)
      ? draft.llmProvider
      : null;
    if (provider !== null) {
      await finish();
      return;
    }

    confirmOfficialProbe(() => runOfficialProbeAndFinish(draft.proxy));
  }, [confirmOfficialProbe, customProviderEnabled, draft.llmProvider, draft.proxy, finish, runOfficialProbeAndFinish]);

  const saveProxyAndRetry = useCallback(async () => {
    const proxy = draft.proxy ?? { ...defaultProxySettings, enabled: true };
    const trimmedUrl = proxy.url.trim();
    if (proxy.enabled && (trimmedUrl === "" || !isValidProxyUrl(trimmedUrl))) {
      setProxyValidationError(t("settings.row.proxy.invalidUrl"));
      return;
    }
    const nextProxy: ProxySettings = proxy.enabled
      ? { enabled: true, url: trimmedUrl }
      : { enabled: false, url: trimmedUrl || defaultProxySettings.url };

    setBusy(true);
    try {
      const result = await testOfficialProvider(nextProxy);
      if (result.ok) {
        await finish(nextProxy);
      }
    } catch (err) {
      setProviderTestResult({
        ok: false,
        httpStatus: 0,
        latencyMs: 0,
        url: "",
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusy(false);
    }
  }, [draft.proxy, finish, t, testOfficialProvider]);

  const skip = useCallback(async () => {
    setBusy(true);
    try {
      const next = await officecli.updateSettings({
        onboardingCompletedAt: new Date().toISOString(),
      });
      broadcastSettingsChanged(next);
      onComplete();
    } finally {
      setBusy(false);
    }
  }, [onComplete]);

  const stepTitle = t(`onboarding.step.${step}.title`);
  const totalSteps = step === 2 ? 3 : 2;
  const providerTestTag = providerTestResult ? formatTestResult(providerTestResult, t) : null;
  const proxy = draft.proxy ?? { ...defaultProxySettings, enabled: true };

  return (
    <div className="onboarding-overlay" role="dialog" aria-modal="true">
      <div className="onboarding-card">
        <div className="onboarding-header">
          <span className="onboarding-eyebrow">{t("onboarding.welcome")}</span>
          <div className="onboarding-title-row">
            <h1 className="onboarding-title">{stepTitle}</h1>
            <span className="onboarding-step-counter">{t("onboarding.step.counter", { current: step + 1, total: totalSteps })}</span>
          </div>
        </div>

        {step === 0 ? (
          <Space direction="vertical" size={20} style={{ width: "100%" }}>
            <Field label={t("onboarding.field.documentType")}>
              <Select
                value={draft.defaults.documentType}
                onChange={(value: DocumentType) => updateDefaults({ documentType: value })}
                options={[
                  { value: "pptx", label: t("settings.option.docType.pptx") },
                  { value: "docx", label: t("settings.option.docType.docx") },
                  { value: "xlsx", label: t("settings.option.docType.xlsx") },
                  { value: "report", label: t("settings.option.docType.report") },
                  { value: "img", label: t("settings.option.docType.img") },
                ]}
                style={{ width: "100%" }}
              />
            </Field>
            <Field label={t("onboarding.field.mode")}>
              <Radio.Group
                optionType="button"
                buttonStyle="solid"
                value={draft.defaults.mode}
                onChange={(event) => updateDefaults({ mode: event.target.value })}
                options={[
                  { value: "fast", label: t("settings.option.mode.fast") },
                  { value: "best", label: t("settings.option.mode.best") },
                ]}
              />
            </Field>
            <Field label={t("onboarding.field.images")}>
              <Switch checked={draft.defaults.enableImages} onChange={(checked) => updateDefaults({ enableImages: checked })} />
            </Field>
          </Space>
        ) : null}

	        {step === 1 ? (
	          <Space direction="vertical" size={20} style={{ width: "100%" }}>
	            <Field label={t("onboarding.field.provider")}>
	              <ProviderForm provider={draft.llmProvider} onChange={updateProvider} customProviderEnabled={customProviderEnabled} />
	              {!customProviderEnabled ? (
	                <span className="provider-hint">{t("settings.row.provider.loginRequired")}</span>
	              ) : null}
	              {draft.llmProvider.type === "official" ? (
	                <span className="provider-hint">{t("onboarding.provider.officialTestHint")}</span>
	              ) : null}
	              {providerTestTag ? (
	                <Tag color={providerTestTag.tone === "green" ? "success" : providerTestTag.tone === "red" ? "error" : "warning"}>
	                  {providerTestTag.text}
	                </Tag>
	              ) : null}
	            </Field>
            <Field label={t("onboarding.field.outputDir")}>
              <Space.Compact style={{ width: "100%" }}>
                <Input
                  placeholder={defaultWorkspaceDir || t("settings.row.outputDir.placeholder")}
                  value={draft.outputDir ?? ""}
                  onChange={(event) => setDraft((current) => ({ ...current, outputDir: event.target.value.trim() ? event.target.value : null }))}
                />
                <Button icon={<FolderOpenOutlined />} onClick={pickOutputDir}>{t("settings.row.outputDir.browse")}</Button>
              </Space.Compact>
            </Field>
          </Space>
        ) : null}

        {step === 2 ? (
          <Space direction="vertical" size={16} style={{ width: "100%" }}>
            <Alert
              type="warning"
              showIcon
              title={t("onboarding.proxy.alertTitle")}
              description={t("onboarding.proxy.alertBody")}
            />
            {providerTestTag ? (
              <Tag color={providerTestTag.tone === "green" ? "success" : providerTestTag.tone === "red" ? "error" : "warning"}>
                {providerTestTag.text}
              </Tag>
            ) : null}
            <Field label={t("settings.row.proxy.title")}>
              <Space direction="vertical" style={{ width: "100%" }} size="middle">
                <Space align="center" size="small">
                  <Switch
                    checked={proxy.enabled}
                    onChange={(checked) => {
                      setDraft((current) => ({
                        ...current,
                        proxy: { enabled: checked, url: current.proxy?.url || defaultProxySettings.url },
                      }));
                      if (!checked) setProxyValidationError(undefined);
                    }}
                    aria-label={t("settings.row.proxy.enableLabel")}
                  />
                  <span>{t("settings.row.proxy.enableLabel")}</span>
                </Space>
                {proxy.enabled ? (
                  <Input
                    placeholder={t("settings.row.proxy.urlPlaceholder")}
                    value={proxy.url}
                    onChange={(event) => {
                      setDraft((current) => ({
                        ...current,
                        proxy: { enabled: true, url: event.target.value },
                      }));
                      if (proxyValidationError) setProxyValidationError(undefined);
                    }}
                    aria-label={t("settings.row.proxy.urlLabel")}
                    status={proxyValidationError ? "error" : undefined}
                  />
                ) : null}
                {proxyValidationError ? (
                  <div role="alert" style={{ color: "var(--n-red, #d92d20)" }}>
                    {proxyValidationError}
                  </div>
                ) : null}
              </Space>
            </Field>
          </Space>
        ) : null}

        <div className="onboarding-actions">
          <Button type="link" onClick={skip} disabled={busy}>{t("onboarding.skip")}</Button>
          <Space>
            {step > 0 ? <Button onClick={() => setStep((current) => current - 1)} disabled={busy}>{t("onboarding.back")}</Button> : null}
            {step < 1 ? (
              <Button type="primary" onClick={() => setStep((current) => current + 1)}>{t("onboarding.next")}</Button>
            ) : step === 2 ? (
              <Button type="primary" loading={busy} onClick={saveProxyAndRetry}>{t("onboarding.proxy.saveAndRetry")}</Button>
            ) : (
              <Button type="primary" loading={busy} onClick={finishOrTestOfficial}>{busy ? t("settings.effective.testRunning") : t("onboarding.finish")}</Button>
            )}
          </Space>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="onboarding-field">
      <label>{label}</label>
      {children}
    </div>
  );
}
