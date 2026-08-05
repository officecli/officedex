import { Select, Space } from "../ui";
import { providerPresets } from "../providerPresets";
import { useT } from "../i18n";
import type { LlmProvider, ProviderTestResult } from "../../shared/types";
import { ImeInput, ImePasswordInput } from "./ImeInput";

export function ProviderForm({
  provider,
  onChange,
  customProviderEnabled = true,
}: {
  provider: LlmProvider;
  onChange: (patch: Partial<LlmProvider>) => void;
  customProviderEnabled?: boolean;
}) {
  const displayType: "official" | "custom" = provider.type === "official" ? "official" : "custom";
  const isCustom = displayType === "custom";
  const customLocked = isCustom && !customProviderEnabled;
  const preset = isCustom ? providerPresets.custom : providerPresets.official;
  const t = useT();
  return (
    <Space direction="vertical" size={10} style={{ width: "100%" }}>
      <Select
        value={displayType}
        disabled={customLocked}
        onChange={(value) => {
          if (value === "custom" && !customProviderEnabled) return;
          if (value === "official") {
            onChange({ type: "official", baseUrl: "", apiKey: "", model: "" });
          } else {
            onChange({
              type: "custom",
              baseUrl: provider.baseUrl || providerPresets.custom.defaultBaseUrl,
              model: provider.model || providerPresets.custom.defaultModel,
            });
          }
        }}
        options={[
          { value: "official", label: t("onboarding.provider.official") },
          { value: "custom", label: t("onboarding.provider.custom"), disabled: !customProviderEnabled },
        ]}
        style={{ width: "100%" }}
      />
      {isCustom ? (
        <>
          <ImeInput
            placeholder={preset.defaultBaseUrl || t("onboarding.provider.baseUrlPlaceholder")}
            value={provider.baseUrl}
            onValueChange={(value) => onChange({ baseUrl: value })}
            disabled={!customProviderEnabled}
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
          />
          <span className="provider-hint">{t("onboarding.provider.customEndpointHint")}</span>
          <ImePasswordInput
            placeholder={t("onboarding.provider.apiKeyPlaceholder")}
            value={provider.apiKey}
            onValueChange={(value) => onChange({ apiKey: value })}
            disabled={!customProviderEnabled}
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
          />
          <ImeInput
            placeholder={preset.defaultModel || t("onboarding.provider.modelPlaceholder")}
            value={provider.model}
            onValueChange={(value) => onChange({ model: value })}
            disabled={!customProviderEnabled}
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
          />
        </>
      ) : null}
    </Space>
  );
}

export function formatTestResult(
  result: ProviderTestResult,
  t: (key: string) => string,
): { tone: "green" | "red" | "amber"; text: string } {
  if (result.unavailable) {
    return { tone: "amber", text: t("settings.effective.testUnavailable") };
  }
  if (result.probeType === "officialPaid") {
    if (result.ok) {
      return {
        tone: "green",
        text: t("settings.effective.testOkOfficialPaid").replace("{latency}", String(result.latencyMs)),
      };
    }
    return {
      tone: "red",
      text: t("settings.effective.testFailOfficialPaid").replace("{error}", result.error || "unknown error"),
    };
  }
  if (result.error && result.httpStatus === 0 && !result.ok) {
    return { tone: "red", text: t("settings.effective.testNetworkError").replace("{error}", result.error) };
  }
  if (result.ok) {
    const base = result.httpStatus > 0
      ? t("settings.effective.testOkHttp")
        .replace("{status}", String(result.httpStatus))
        .replace("{latency}", String(result.latencyMs))
      : t("settings.effective.testOkBridge")
        .replace("{latency}", String(result.latencyMs));
    if (result.responseMessage) {
      return { tone: "green", text: base + ` · ${t("settings.effective.testReply")}: ${result.responseMessage}` };
    }
    return { tone: "green", text: base };
  }
  const status = result.httpStatus;
  let key = "settings.effective.testFail";
  if (status === 401 || status === 403) key = "settings.effective.testFailAuth";
  else if (status === 404) key = "settings.effective.testFailNotFound";
  else if (status >= 500) key = "settings.effective.testFailUpstream";
  return {
    tone: "red",
    text: t(key).replace("{status}", String(status)),
  };
}
