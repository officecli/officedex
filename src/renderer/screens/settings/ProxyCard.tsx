import { Button, Space, Switch, toast as message } from "../../ui";
import { useCallback, useEffect, useState } from "react";
import { useSettings } from "../../useSettings";
import { useT } from "../../i18n";
import { defaultProxySettings, isValidProxyUrl } from "../../defaults";
import type { ProxySettings } from "../../../shared/types";
import { ImeInput } from "../../components/ImeInput";
export function ProxyCard({
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
