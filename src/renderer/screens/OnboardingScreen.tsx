import { Button, Input, Radio, Select, Space, Switch } from "antd";
import { FolderOpenOutlined } from "@ant-design/icons";
import { useCallback, useState } from "react";
import { officecli } from "../bridge";
import { providerPresets } from "../providerPresets";
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
    } finally {
      setBusy(false);
    }
  }, [draft, onComplete]);

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

  const stepTitle = ["Generation defaults", "Workspace & runtime"][step];
  const isExternal = draft.defaults.runtimeMode === "external";

  return (
    <div className="onboarding-overlay" role="dialog" aria-modal="true">
      <div className="onboarding-card">
        <div className="onboarding-header">
          <span className="onboarding-eyebrow">Welcome to OfficeDex</span>
          <div className="onboarding-title-row">
            <h1 className="onboarding-title">{stepTitle}</h1>
            <span className="onboarding-step-counter">Step {step + 1}/2</span>
          </div>
        </div>

        {step === 0 ? (
          <Space direction="vertical" size={20} style={{ width: "100%" }}>
            <Field label="Default document type">
              <Select
                value={draft.defaults.documentType}
                onChange={(value: DocumentType) => updateDefaults({ documentType: value })}
                options={[
                  { value: "pptx", label: "PowerPoint (.pptx)" },
                  { value: "docx", label: "Word (.docx)" },
                  { value: "xlsx", label: "Excel (.xlsx)" },
                  { value: "report", label: "Report" },
                  { value: "img", label: "Image" },
                ]}
                style={{ width: "100%" }}
              />
            </Field>
            <Field label="Generation mode">
              <Radio.Group
                optionType="button"
                buttonStyle="solid"
                value={draft.defaults.mode}
                onChange={(event) => updateDefaults({ mode: event.target.value })}
                options={[
                  { value: "fast", label: "Fast" },
                  { value: "best", label: "Smart" },
                ]}
              />
            </Field>
            <Field label="Embed AI-generated images">
              <Switch checked={draft.defaults.enableImages} onChange={(checked) => updateDefaults({ enableImages: checked })} />
            </Field>
          </Space>
        ) : null}

        {step === 1 ? (
          <Space direction="vertical" size={20} style={{ width: "100%" }}>
            <Field label="Runtime environment">
              <Radio.Group
                value={draft.defaults.runtimeMode}
                onChange={(event) => updateDefaults({ runtimeMode: event.target.value })}
              >
                <Space direction="vertical" size={8}>
                  <Radio value="hosted">Hosted (Recommended — Use OfficeCLI as LLM provider)</Radio>
                  <Radio value="external">External (Use my own LLM provider)</Radio>
                </Space>
              </Radio.Group>
            </Field>
            {isExternal ? (
              <Field label="LLM provider">
                <ProviderForm provider={draft.llmProvider} onChange={updateProvider} />
              </Field>
            ) : null}
            <Field label="Workspace output directory (optional)">
              <Space.Compact style={{ width: "100%" }}>
                <Input
                  placeholder={defaultWorkspaceDir || "(default workspace)"}
                  value={draft.outputDir ?? ""}
                  onChange={(event) => setDraft((current) => ({ ...current, outputDir: event.target.value.trim() ? event.target.value : null }))}
                />
                <Button icon={<FolderOpenOutlined />} onClick={pickOutputDir}>Browse</Button>
              </Space.Compact>
            </Field>
          </Space>
        ) : null}

        <div className="onboarding-actions">
          <Button type="link" onClick={skip} disabled={busy}>Skip for now</Button>
          <Space>
            {step > 0 ? <Button onClick={() => setStep((current) => current - 1)} disabled={busy}>Back</Button> : null}
            {step < 1 ? (
              <Button type="primary" onClick={() => setStep((current) => current + 1)}>Next</Button>
            ) : (
              <Button type="primary" loading={busy} onClick={finish}>Finish</Button>
            )}
          </Space>
        </div>
      </div>
    </div>
  );
}

export function ProviderForm({ provider, onChange }: { provider: LlmProvider; onChange: (patch: Partial<LlmProvider>) => void }) {
  const preset = providerPresets[provider.type];
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
          { value: "openai", label: "OpenAI (or OpenAI-compatible)" },
          { value: "anthropic", label: "Anthropic" },
          { value: "azure", label: "Azure OpenAI" },
          { value: "custom", label: "Custom endpoint" },
        ]}
        style={{ width: "100%" }}
      />
      <Input
        placeholder={preset.defaultBaseUrl || "https://your-endpoint.example.com/v1"}
        value={provider.baseUrl}
        onChange={(event) => onChange({ baseUrl: event.target.value })}
      />
      <Input.Password
        placeholder="API key"
        value={provider.apiKey}
        onChange={(event) => onChange({ apiKey: event.target.value })}
        autoComplete="off"
      />
      <Input
        placeholder={preset.defaultModel || "Model name (e.g. gpt-4o-mini)"}
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
