import { Button, Input, message, Radio, Select, Space, Switch } from "antd";
import { FolderOpenOutlined } from "@ant-design/icons";
import { useCallback, useState } from "react";
import { officecli } from "../bridge";
import { providerPresets } from "../providerPresets";
import { useT } from "../i18n";
import type { DocumentType, GenerateDefaults, LlmProvider, LlmProviderType, UserSettings } from "../../shared/types";

interface OnboardingScreenProps {
  settings: UserSettings;
  defaultWorkspaceDir: string;
  onComplete: () => void;
}

interface DraftSettings {
  defaults: GenerateDefaults;
  outputDir: string | null;
  bridgeBinaryPath: string | null;
  llmProvider: LlmProvider;
}

const EMPTY_PROVIDER: LlmProvider = { type: "openai", baseUrl: "", apiKey: "", model: "" };

export function OnboardingScreen({ settings, defaultWorkspaceDir, onComplete }: OnboardingScreenProps) {
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const t = useT();
  const [draft, setDraft] = useState<DraftSettings>(() => ({
    defaults: { ...settings.defaults },
    outputDir: settings.outputDir,
    bridgeBinaryPath: settings.bridgeBinaryPath,
    llmProvider: settings.llmProvider ?? { ...EMPTY_PROVIDER },
  }));

  const updateDefaults = useCallback((patch: Partial<GenerateDefaults>) => {
    setDraft((current) => ({ ...current, defaults: { ...current.defaults, ...patch } }));
  }, []);

  const updateProvider = useCallback((patch: Partial<LlmProvider>) => {
    setDraft((current) => ({ ...current, llmProvider: { ...current.llmProvider, ...patch } }));
  }, []);

  const pickOutputDir = useCallback(async () => {
    const picked = await officecli.openFileDialog();
    if (picked) {
      setDraft((current) => ({ ...current, outputDir: picked }));
    }
  }, []);

  const finish = useCallback(async () => {
    setBusy(true);
    try {
      const isExternal = draft.defaults.runtimeMode === "external";
      const provider = isExternal && (draft.llmProvider.baseUrl || draft.llmProvider.apiKey || draft.llmProvider.model)
        ? draft.llmProvider
        : null;
      await officecli.updateSettings({
        defaults: draft.defaults,
        outputDir: draft.outputDir,
        bridgeBinaryPath: draft.bridgeBinaryPath,
        llmProvider: provider,
        onboardingCompletedAt: new Date().toISOString(),
      });
      onComplete();
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      message.error(t("onboarding.finishFailed", { error: errMsg }));
      throw err;
    } finally {
      setBusy(false);
    }
  }, [draft, onComplete, t]);

  const skip = useCallback(async () => {
    setBusy(true);
    try {
      await officecli.updateSettings({
        onboardingCompletedAt: new Date().toISOString(),
      });
      onComplete();
    } finally {
      setBusy(false);
    }
  }, [onComplete]);

  const stepTitle = t(`onboarding.step.${step}.title`);
  const isExternal = draft.defaults.runtimeMode === "external";

  return (
    <div className="onboarding-overlay" role="dialog" aria-modal="true">
      <div className="onboarding-card">
        <div className="onboarding-header">
          <span className="onboarding-eyebrow">{t("onboarding.welcome")}</span>
          <div className="onboarding-title-row">
            <h1 className="onboarding-title">{stepTitle}</h1>
            <span className="onboarding-step-counter">{t("onboarding.step.counter", { current: step + 1, total: 2 })}</span>
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
            <Field label={t("onboarding.field.runtime")}>
              <Radio.Group
                value={draft.defaults.runtimeMode}
                onChange={(event) => updateDefaults({ runtimeMode: event.target.value })}
              >
                <Space direction="vertical" size={8}>
                  <Radio value="hosted">{t("onboarding.runtime.hosted")}</Radio>
                  <Radio value="external">{t("onboarding.runtime.external")}</Radio>
                </Space>
              </Radio.Group>
            </Field>
            {isExternal ? (
              <Field label={t("onboarding.field.provider")}>
                <ProviderForm provider={draft.llmProvider} onChange={updateProvider} />
              </Field>
            ) : null}
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

        <div className="onboarding-actions">
          <Button type="link" onClick={skip} disabled={busy}>{t("onboarding.skip")}</Button>
          <Space>
            {step > 0 ? <Button onClick={() => setStep((current) => current - 1)} disabled={busy}>{t("onboarding.back")}</Button> : null}
            {step < 1 ? (
              <Button type="primary" onClick={() => setStep((current) => current + 1)}>{t("onboarding.next")}</Button>
            ) : (
              <Button type="primary" loading={busy} onClick={finish}>{t("onboarding.finish")}</Button>
            )}
          </Space>
        </div>
      </div>
    </div>
  );
}

export function ProviderForm({ provider, onChange }: { provider: LlmProvider; onChange: (patch: Partial<LlmProvider>) => void }) {
  const preset = providerPresets[provider.type];
  const t = useT();
  return (
    <Space direction="vertical" size={10} style={{ width: "100%" }}>
      <Select
        value={provider.type}
        onChange={(value: LlmProviderType) => {
          const presetForValue = providerPresets[value];
          onChange({
            type: value,
            baseUrl: provider.baseUrl || presetForValue.defaultBaseUrl,
            model: provider.model || presetForValue.defaultModel,
          });
        }}
        options={[
          { value: "openai", label: t("onboarding.provider.openai") },
          { value: "anthropic", label: t("onboarding.provider.anthropic") },
          { value: "azure", label: t("onboarding.provider.azure") },
          { value: "custom", label: t("onboarding.provider.custom") },
        ]}
        style={{ width: "100%" }}
      />
      <Input
        placeholder={preset.defaultBaseUrl || t("onboarding.provider.baseUrlPlaceholder")}
        value={provider.baseUrl}
        onChange={(event) => onChange({ baseUrl: event.target.value })}
      />
      <Input.Password
        placeholder={t("onboarding.provider.apiKeyPlaceholder")}
        value={provider.apiKey}
        onChange={(event) => onChange({ apiKey: event.target.value })}
        autoComplete="off"
      />
      <Input
        placeholder={preset.defaultModel || t("onboarding.provider.modelPlaceholder")}
        value={provider.model}
        onChange={(event) => onChange({ model: event.target.value })}
      />
    </Space>
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
