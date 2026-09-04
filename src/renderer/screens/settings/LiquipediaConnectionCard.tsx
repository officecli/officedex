import { Button, Input, Spin, Tag, toast as message } from "../../ui";
import { GlobalOutlined } from "../../ui/icons";
import { useCallback, useEffect, useState } from "react";
import { officecli } from "../../bridge";
import { useT } from "../../i18n";
import type { LiquipediaConnectionSummary, LiquipediaProbeResult } from "../../../shared/verticals";
import { errorMessage } from "../../utils/values";


const LIQUIPEDIA_API_TERMS_URL = "https://liquipedia.net/api-terms-of-use";

export function LiquipediaConnectionCard() {
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
