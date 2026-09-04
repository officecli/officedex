import { Button, Input, PasswordInput, Select, Spin, Tag, toast as message } from "../../ui";
import { GlobalOutlined } from "../../ui/icons";
import { useCallback, useEffect, useState } from "react";
import { officecli } from "../../bridge";
import { useT } from "../../i18n";
import type { JiraAuthType, JiraConnectionSummary, JiraProbeResult } from "../../../shared/verticals";
import { errorMessage } from "../../utils/values";


const ATLASSIAN_PAT_DOCUMENTATION_URL = "https://confluence.atlassian.com/enterprise/using-personal-access-tokens-1026032365.html";

export function JiraConnectionCard() {
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
