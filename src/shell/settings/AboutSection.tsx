import { useCallback, useEffect, useState } from "react";
import {
  Download,
  Github,
  Globe,
  Info,
  LayoutGrid,
  MessageSquare,
  RefreshCw,
  Rocket,
  ShieldCheck,
} from "lucide-react";

import { Button, Modal, Progress } from "../../renderer/ui";
import { useT } from "../../renderer/i18n";
import { useDesktopApi } from "../../renderer/services/desktopApi";
import { useAppUpdate, type UseAppUpdateValue } from "../../renderer/useAppUpdate";
import { useShellAppUpdate } from "../chrome/UpdateGate";
import { SettingsSection, settingsSectionId } from "./SettingsPrimitives";

/**
 * About — the version, the links, the disclaimer, and the update check.
 *
 * The last one is why this section matters more than its size suggests: the
 * shell only ever had the *mandatory* update gate (`chrome/UpdateGate.tsx`), so
 * a user whose build was merely out of date had no way to see a version number
 * or ask for a newer one — audit item 86–99, "可选更新用户永远看不到、也无法主动检查".
 *
 * Inside the desktop app this reads the gate's updater (`useShellAppUpdate`),
 * the same one the sidebar's update button is drawn from, so a download started
 * in either place shows its progress in both. Only when no gate is above
 * (tests, a page rendered on its own) does it start an updater of its own.
 */
export function AboutSection() {
  const shared = useShellAppUpdate();
  return shared ? <AboutSectionBody update={shared} /> : <OwnUpdaterAboutSection />;
}

function OwnUpdaterAboutSection() {
  return <AboutSectionBody update={useAppUpdate()} />;
}

function AboutSectionBody({ update }: { update: UseAppUpdateValue }) {
  const api = useDesktopApi();
  const t = useT();
  const [version, setVersion] = useState("");
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .getAppVersion()
      .then((value) => {
        if (!cancelled) setVersion(value);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [api]);

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
    if (downloaded) void update.install();
    else void update.download();
  }, [downloaded, update]);

  const openExternal = useCallback(
    (url: string) => {
      void api.openExternal(url).catch(() => undefined);
    },
    [api],
  );

  const showDisclaimer = useCallback(() => {
    Modal.info({
      title: t("settings.about.disclaimerTitle"),
      content: t("settings.about.disclaimerBody"),
      okText: t("settings.common.ok"),
    });
  }, [t]);

  const displayVersion = version || status.currentVersion;

  return (
    <SettingsSection id={settingsSectionId("about")} title={t("settings.group.about")}>
      <div className="shell-settings-about">
        <span className="shell-settings-about-mark" aria-hidden="true">
          <LayoutGrid size={20} strokeWidth={1.6} />
        </span>
        <h3 className="shell-settings-about-name">{t("settings.about.productName")}</h3>
        <div className="shell-settings-about-version">
          {t("settings.about.versionValue", { version: displayVersion })}
        </div>
        {status.updateChannel ? (
          <div className="shell-settings-about-version">
            {t("settings.about.updateChannel", { channel: status.updateChannel })}
          </div>
        ) : null}
        <p className="shell-settings-about-desc">{t("settings.about.description")}</p>
        <div className="shell-settings-about-links" aria-label={t("settings.about.linksLabel")}>
          <Button type="text" icon={<Globe size={14} />} onClick={() => openExternal("https://officecli.io")}>
            {t("settings.about.website")}
          </Button>
          <Button
            type="text"
            icon={<Github size={14} />}
            onClick={() => openExternal("https://github.com/officecli/officedex")}
          >
            {t("settings.about.github")}
          </Button>
          <Button
            type="text"
            icon={<ShieldCheck size={14} />}
            onClick={() => openExternal("https://github.com/officecli/officedex/blob/main/LICENSE")}
          >
            {t("settings.about.license")}
          </Button>
        </div>
        <div className="shell-settings-about-meta">
          {status.manifestUrl ? <span>{status.manifestUrl}</span> : null}
          <span>
            {t("settings.about.lastChecked")}: {formatLastChecked(status.lastCheckedAt, t)}
          </span>
          {status.lastError ? (
            <span className="shell-settings-about-error">
              {t("settings.about.lastError")}: {status.lastError}
            </span>
          ) : null}
        </div>
        {downloading ? (
          <div className="shell-settings-about-progress">
            <Progress percent={percent} size="small" showInfo={false} />
            <span className="shell-settings-about-progress-label">
              {t("settings.about.downloading", { percent })}
            </span>
          </div>
        ) : null}
        <div className="shell-settings-about-actions">
          <Button
            icon={<MessageSquare size={14} />}
            onClick={() => openExternal("https://github.com/officecli/officedex/issues")}
          >
            {t("settings.about.feedback")}
          </Button>
          <Button icon={<Info size={14} />} onClick={showDisclaimer}>
            {t("settings.about.disclaimer")}
          </Button>
          <Button
            icon={<RefreshCw size={14} />}
            onClick={() => void handleCheck()}
            disabled={checking || downloading}
          >
            {t("settings.about.checking")}
          </Button>
          {status.updateAvailable && release ? (
            <Button
              type="primary"
              icon={downloaded ? <Rocket size={14} /> : <Download size={14} />}
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
            <span className="shell-settings-about-uptodate">{t("settings.about.upToDate")}</span>
          ) : null}
        </div>
      </div>
    </SettingsSection>
  );
}

/** "3 minutes ago", "just now" — the same phrasing the legacy card used. */
function formatLastChecked(
  timestamp: string | null,
  t: (key: string, vars?: Record<string, string | number>) => string,
): string {
  if (!timestamp) return t("settings.about.lastCheckedNever");
  const then = Date.parse(timestamp);
  if (Number.isNaN(then)) return timestamp;
  const elapsed = Math.max(0, Date.now() - then);
  if (elapsed < 60_000) return t("settings.about.lastCheckedJustNow");
  if (elapsed < 60 * 60_000) return t("settings.about.lastCheckedMinutes", { count: Math.floor(elapsed / 60_000) });
  if (elapsed < 24 * 60 * 60_000) return t("settings.about.lastCheckedHours", { count: Math.floor(elapsed / (60 * 60_000)) });
  return new Date(then).toLocaleString();
}
