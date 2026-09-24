import { useCallback, useEffect, useState } from "react";

import { Button, Input, PasswordInput, Select, Spin, Tag, toast } from "../../renderer/ui";
import { GlobalOutlined } from "../../renderer/ui/icons";
import { useT } from "../../renderer/i18n";
import { useDesktopApi } from "../../renderer/services/desktopApi";
import { errorMessage } from "../../renderer/utils/values";
import type {
  JiraAuthType,
  JiraConnectionSummary,
  JiraProbeResult,
} from "../../shared/verticals";
import { SettingRow, SettingsSection, settingsSectionId } from "./SettingsPrimitives";

const ATLASSIAN_PAT_DOCUMENTATION_URL =
  "https://confluence.atlassian.com/enterprise/using-personal-access-tokens-1026032365.html";

/**
 * Connection — Jira only.
 *
 * Liquipedia used to sit beside it. The shell's connection page is for the
 * connector people actually configure here; the Liquipedia form stays in the
 * spreadsheet surface that uses it, not as a second card on this page.
 */
export function ConnectionSection() {
  const t = useT();
  return (
    <SettingsSection id={settingsSectionId("connection")} title={t("settings.group.connection")}>
      <SettingRow variant="form" title={t("settings.row.jira.title")} desc={t("settings.row.jira.desc")}>
        <JiraConnector />
      </SettingRow>
    </SettingsSection>
  );
}

function JiraConnector() {
  const api = useDesktopApi();
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

  /*
   * The load has a deadline. `getJiraConnection` shells out, and a wedged CLI
   * would otherwise leave a spinner forever with no way to tell a slow read
   * from a dead one — which is why the legacy card carried the same timer.
   */
  useEffect(() => {
    let cancelled = false;
    const timeout = window.setTimeout(() => {
      if (!cancelled) {
        setLoading(false);
        setError(t("settings.row.jira.loadTimeout"));
      }
    }, 15_000);
    api
      .getJiraConnection()
      .then((summary) => {
        if (cancelled) return;
        setRemote(summary);
        if (summary.baseUrl) setBaseUrl(summary.baseUrl);
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
  }, [api, t]);

  /*
   * Whether the typed scope is the one already stored. It is what decides
   * whether an empty credential field means "keep the saved secret" or "you
   * have not filled the form in".
   */
  const sameStoredScope =
    remote.configured &&
    remote.baseUrl.replace(/\/+$/, "") === baseUrl.trim().replace(/\/+$/, "") &&
    remote.authType === authType &&
    (remote.username ?? "") === (authType === "basic" ? username.trim() : "");
  const canSave =
    Boolean(baseUrl.trim()) &&
    (authType !== "basic" || Boolean(username.trim())) &&
    (Boolean(secret.trim()) || sameStoredScope) &&
    !saving;

  const save = useCallback(async () => {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    setProbe(null);
    try {
      const nextProbe = await api.saveJiraConnection({
        baseUrl: baseUrl.trim(),
        auth: {
          type: authType,
          ...(authType === "basic" ? { username: username.trim() } : {}),
          secret,
        },
      });
      const summary = await api.getJiraConnection();
      setRemote(summary);
      setProbe(nextProbe);
      setSecret("");
      window.dispatchEvent(new Event("officedex:jira-connection-updated"));
      void toast.success(t("settings.row.jira.saveSuccess"));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }, [api, authType, baseUrl, canSave, secret, t, username]);

  const clear = useCallback(async () => {
    setClearing(true);
    setError(null);
    try {
      await api.clearJiraConnection();
      setRemote({ configured: false, baseUrl: "", authType: "" });
      setProbe(null);
      setSecret("");
      window.dispatchEvent(new Event("officedex:jira-connection-updated"));
      void toast.success(t("settings.row.jira.clearSuccess"));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setClearing(false);
    }
  }, [api, t]);

  if (loading) return <Spin />;

  return (
    <div className="shell-settings-connector" role="group" aria-label={t("settings.connector.jira.aria")}>
      <label className="shell-settings-connector-field">
        <span>{t("settings.row.jira.baseUrl")}</span>
        <Input
          aria-label={t("settings.row.jira.baseUrl")}
          value={baseUrl}
          onChange={(event) => {
            setBaseUrl(event.target.value);
            setProbe(null);
          }}
        />
      </label>
      <label className="shell-settings-connector-field">
        <span>{t("settings.row.jira.authType")}</span>
        <Select<JiraAuthType>
          ariaLabel={t("settings.row.jira.authType")}
          value={authType}
          options={[
            { value: "token", label: t("shell.misc.personalAccessToken") },
            { value: "basic", label: t("settings.row.jira.basicAuth") },
          ]}
          onChange={(value) => {
            setAuthType(value);
            setSecret("");
            setProbe(null);
          }}
        />
      </label>
      {authType === "basic" ? (
        <label className="shell-settings-connector-field">
          <span>{t("settings.row.jira.username")}</span>
          <Input
            aria-label={t("settings.row.jira.username")}
            autoComplete="username"
            value={username}
            onChange={(event) => {
              setUsername(event.target.value);
              setProbe(null);
            }}
          />
        </label>
      ) : null}
      <label className="shell-settings-connector-field">
        <span>{authType === "token" ? "PAT" : t("settings.row.jira.password")}</span>
        <PasswordInput
          aria-label={authType === "token" ? "PAT" : t("settings.row.jira.password")}
          autoComplete="off"
          value={secret}
          placeholder={remote.configured && sameStoredScope ? t("settings.row.jira.keepSecret") : undefined}
          onChange={(event) => {
            setSecret(event.target.value);
            setProbe(null);
          }}
          visibilityLabels={{
            show: t("settings.row.jira.showSecret"),
            hide: t("settings.row.jira.hideSecret"),
          }}
        />
      </label>
      {authType === "token" ? (
        <div className="shell-settings-connector-wide shell-settings-connector-help">
          <strong>{t("settings.row.jira.patHelpTitle")}</strong>
          <ol>
            <li>{t("settings.row.jira.patHelpStep1")}</li>
            <li>{t("settings.row.jira.patHelpStep2")}</li>
            <li>{t("settings.row.jira.patHelpStep3")}</li>
          </ol>
          <div className="shell-settings-note">{t("settings.row.jira.patHelpAdminNote")}</div>
          <a
            className="shell-settings-connector-link"
            href={ATLASSIAN_PAT_DOCUMENTATION_URL}
            target="_blank"
            rel="noopener noreferrer"
          >
            <GlobalOutlined />
            <span>{t("settings.row.jira.patDocumentation")}</span>
          </a>
        </div>
      ) : null}
      <div className="shell-settings-connector-wide shell-settings-note">{t("settings.row.jira.secretNote")}</div>
      {remote.configured ? (
        <div className="shell-settings-connector-wide shell-settings-connector-status">
          <Tag tone="success">{t("settings.row.jira.configured")}</Tag>
          <span>{remote.baseUrl}</span>
        </div>
      ) : null}
      {probe ? (
        <div className="shell-settings-connector-wide shell-settings-connector-probe">
          {probe.server.serverTitle || "Jira"} {probe.server.version} · {probe.user.displayName || probe.user.name}
        </div>
      ) : null}
      {error ? (
        <div className="shell-settings-connector-wide shell-settings-error" role="alert">
          {error}
        </div>
      ) : null}
      <div className="shell-settings-connector-wide shell-settings-actions" data-align="end">
        <Button type="primary" loading={saving} disabled={!canSave} onClick={() => void save()}>
          {t("settings.row.jira.saveAndTest")}
        </Button>
        {remote.configured ? (
          <Button type="link" danger loading={clearing} onClick={() => void clear()}>
            {t("settings.row.jira.clear")}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
