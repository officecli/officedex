import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Progress } from "../ui";
import { LockOutlined, RocketOutlined } from "../ui/icons";
import { notion } from "../designTokens";
import type { AppUpdateAsset, AppUpdateRelease } from "../../shared/types";
import type { UpdatePhase } from "../useAppUpdate";
import { useT } from "../i18n";

/**
 * The styles travel with the component, deliberately.
 *
 * This is the one visual component outside `renderer/ui` that a caller can
 * render directly, and it has two of them: the legacy entry's `App.tsx` and the
 * shell (`chrome/UpdateGate.tsx`, plus `shell/main.tsx`'s `?forceUpdate=`
 * preview). The stylesheet used to be imported by the legacy *entry* only, so
 * the shell build linked a CSS bundle with no `force-update-*` rule in it and
 * the page rendered as black-on-white Times with no layout — on the one screen
 * a user cannot navigate away from. Importing it at the entry would have fixed
 * exactly one of the two call sites. Importing it here covers every caller,
 * present and future, and cannot drift from the component.
 */
import "../styles/onboarding-update.css";

export interface ForceUpdateOverlayProps {
  release: AppUpdateRelease;
  phase: UpdatePhase;
  progress: { bytesDone: number; bytesTotal: number };
  error: string | null;
  currentVersion: string;
  onUpdate: () => void;
  onInstall: () => void;
  /**
   * Whether the caller installs by itself once the download lands.
   *
   * `useAppUpdate` does exactly that for a mandatory update, and this surface
   * only exists for mandatory updates, so the default is `true`. When it holds,
   * `downloaded` lasts a single render pass and a "Restart to install" button
   * there is a control nobody can ever press — so it is not drawn, and the
   * page says what is actually happening instead. A caller that installs on
   * demand passes `false` and gets the button.
   */
  autoInstall?: boolean;
}

/** Human labels for the manifest's asset keys (`platform-arch`, see internal/appupdate). */
const PLATFORM_LABELS: Record<string, string> = {
  "darwin-arm64": "macOS (Apple silicon)",
  "darwin-amd64": "macOS (Intel)",
  "windows-amd64": "Windows",
  "windows-arm64": "Windows (ARM)",
  "linux-amd64": "Linux",
  "linux-arm64": "Linux (ARM)",
};

/**
 * The assets worth offering as a manual download.
 *
 * The browser cannot tell an Apple-silicon Mac from an Intel one (both report
 * "Intel Mac OS X"), so this narrows by platform and then lists whatever is
 * left rather than guessing an architecture and handing someone a build that
 * will not launch. No match at all means every asset is offered, labelled.
 */
function downloadOptions(assets: Record<string, AppUpdateAsset> | undefined): { key: string; label: string; url: string }[] {
  const entries = Object.entries(assets ?? {}).filter(([, asset]) => Boolean(asset?.url));
  if (entries.length === 0) return [];
  const ua = typeof navigator === "undefined" ? "" : navigator.userAgent;
  const platform = /Win/i.test(ua) ? "windows" : /Mac/i.test(ua) ? "darwin" : /Linux|Android|X11/i.test(ua) ? "linux" : "";
  const matching = platform ? entries.filter(([key]) => key.startsWith(`${platform}-`)) : [];
  return (matching.length > 0 ? matching : entries).map(([key, asset]) => ({
    key,
    label: PLATFORM_LABELS[key] ?? key,
    url: asset.url,
  }));
}

export function ForceUpdateOverlay({
  release,
  phase,
  progress,
  error,
  currentVersion,
  onUpdate,
  onInstall,
  autoInstall = true,
}: ForceUpdateOverlayProps) {
  const t = useT();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.stopPropagation();
        event.preventDefault();
      }
    }
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, []);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  const bytesPercent =
    progress.bytesTotal > 0 ? Math.min(100, Math.round((progress.bytesDone / progress.bytesTotal) * 100)) : 0;

  /**
   * One description of the page per phase — bar, status line and button all
   * read from the same object.
   *
   * They used to be three independent expressions, which is how `downloaded`
   * managed to show a 39% bar above "Download complete. Restarting..." above a
   * "Restart to install" button: the bar followed the byte counter, the
   * sentence followed the phase, and nothing reconciled them. Note that the
   * bar is `100` for `downloaded`/`installing` by definition of the phase, not
   * by whatever the last progress event happened to say.
   */
  const view = useMemo(() => {
    switch (phase) {
      case "downloading":
        return {
          percent: bytesPercent,
          barStatus: "normal" as const,
          status: t("update.force.downloadingProgress", {
            done: formatBytes(progress.bytesDone),
            total: formatBytes(progress.bytesTotal),
          }),
          action: null,
        };
      case "downloaded":
        return {
          percent: 100,
          barStatus: "normal" as const,
          status: autoInstall ? t("update.force.downloadComplete") : t("update.force.downloadReady"),
          action: autoInstall ? null : ("install" as const),
        };
      case "installing":
        return {
          percent: 100,
          barStatus: "active" as const,
          status: t("update.force.restarting"),
          action: null,
        };
      case "checking":
        return {
          percent: null,
          barStatus: "normal" as const,
          status: t("update.force.statusChecking"),
          action: "checking" as const,
        };
      case "error":
        return {
          percent: null,
          barStatus: "normal" as const,
          status: t("update.force.statusError"),
          action: "retry" as const,
        };
      case "available":
        return {
          percent: null,
          barStatus: "normal" as const,
          status: t("update.force.statusAvailable", { version: release.version }),
          action: "update" as const,
        };
      case "idle":
      default:
        return {
          percent: null,
          barStatus: "normal" as const,
          status: t("update.force.statusIdle"),
          action: "update" as const,
        };
    }
  }, [phase, bytesPercent, progress.bytesDone, progress.bytesTotal, autoInstall, release.version, t]);

  const options = useMemo(() => downloadOptions(release.assets), [release.assets]);

  const copyDetails = useCallback(() => {
    const details = [
      `OfficeDex ${currentVersion} -> ${release.version}`,
      `phase: ${phase}`,
      error ? `error: ${error}` : null,
    ]
      .filter(Boolean)
      .join("\n");
    const clipboard = typeof navigator === "undefined" ? undefined : navigator.clipboard;
    // A clipboard that refuses (permissions, insecure origin) must not leave
    // the button looking broken: the details are also on screen to read.
    void Promise.resolve(clipboard?.writeText(details)).catch(() => undefined);
    setCopied(true);
  }, [currentVersion, release.version, phase, error]);

  return (
    <div className="force-update-overlay" role="alertdialog" aria-modal="true" aria-labelledby="force-update-title">
      <div className="force-update-card">
        <div className="force-update-glyph">
          <LockOutlined />
        </div>
        <h1 id="force-update-title" className="force-update-title">{t("update.force.title")}</h1>
        <div className="force-update-version">
          {t("update.force.versionLine", { version: release.version })} <span className="force-update-version-current">{t("update.force.currentSuffix", { version: currentVersion })}</span>
        </div>
        {release.notes ? (
          <section className="force-update-notes-block">
            {/*
              The notes come from the update server and are whatever language it
              was written in. Labelling them keeps a stray English paragraph from
              reading as a sentence this app wrote in the middle of a Chinese card.
            */}
            <h2 className="force-update-notes-heading">{t("update.force.notesHeading")}</h2>
            <p className="force-update-notes">{release.notes}</p>
          </section>
        ) : null}
        <p className="force-update-reason">
          {t("update.force.reason")}
        </p>
        {view.percent !== null ? (
          <div className="force-update-progress">
            <Progress
              percent={view.percent}
              status={view.barStatus}
              strokeColor={notion.primary}
              railColor={notion.hairline}
              showInfo={false}
              aria-valuenow={view.percent}
            />
            <div className="force-update-progress-label">{view.status}</div>
          </div>
        ) : (
          <p className="force-update-status">{view.status}</p>
        )}
        {view.action === "update" || view.action === "checking" || view.action === "retry" ? (
          <Button
            type="primary"
            size="large"
            icon={<RocketOutlined />}
            onClick={onUpdate}
            disabled={view.action === "checking"}
            className="force-update-action"
          >
            {view.action === "checking"
              ? t("update.force.checking")
              : view.action === "retry"
                ? t("update.force.retry")
                : t("update.force.updateNow")}
          </Button>
        ) : null}
        {view.action === "install" ? (
          <Button type="primary" size="large" icon={<RocketOutlined />} onClick={onInstall} className="force-update-action">
            {t("update.force.restartToInstall")}
          </Button>
        ) : null}
        {error ? (
          <div className="force-update-error">
            <span className="force-update-error-label">{t("update.force.errorLabel")}</span>
            <span className="force-update-error-detail">{error}</span>
          </div>
        ) : null}
        {phase === "error" ? (
          /*
            The only screen in the product with no way past it, so failing here
            has to leave more than a button that reads exactly like the one that
            just failed. The release already carries per-platform download URLs;
            this page simply never read them.
          */
          <section className="force-update-fallback">
            <h2 className="force-update-fallback-heading">{t("update.force.fallbackHeading")}</h2>
            {options.map((option) => (
              <a
                key={option.key}
                className="force-update-download"
                href={option.url}
                target="_blank"
                rel="noreferrer"
              >
                {options.length > 1
                  ? t("update.force.downloadFor", { platform: option.label })
                  : t("update.force.downloadManually", { version: release.version })}
              </a>
            ))}
            <Button size="medium" onClick={copyDetails} className="force-update-secondary">
              {copied ? t("update.force.copyDetailsDone") : t("update.force.copyDetails")}
            </Button>
          </section>
        ) : null}
      </div>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (!bytes || bytes < 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unitIdx = 0;
  while (value >= 1024 && unitIdx < units.length - 1) {
    value /= 1024;
    unitIdx += 1;
  }
  return `${value.toFixed(value >= 10 || unitIdx === 0 ? 0 : 1)} ${units[unitIdx]}`;
}
