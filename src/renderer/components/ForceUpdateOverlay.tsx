import { useEffect } from "react";
import { Button, Progress } from "antd";
import { LockOutlined, RocketOutlined } from "@ant-design/icons";
import { notion } from "../designTokens";
import type { AppUpdateRelease } from "../../shared/types";
import type { UpdatePhase } from "../useAppUpdate";

export interface ForceUpdateOverlayProps {
  release: AppUpdateRelease;
  phase: UpdatePhase;
  progress: { bytesDone: number; bytesTotal: number };
  error: string | null;
  currentVersion: string;
  onUpdate: () => void;
  onInstall: () => void;
}

export function ForceUpdateOverlay({
  release,
  phase,
  progress,
  error,
  currentVersion,
  onUpdate,
  onInstall,
}: ForceUpdateOverlayProps) {
  // Lock background scroll while overlay is mounted.
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  // Block ESC so users cannot try to dismiss (no dismiss path exists in
  // force mode; this just suppresses the AntD/browser shortcut surface).
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

  const downloading = phase === "downloading";
  const downloaded = phase === "downloaded";
  const installing = phase === "installing";
  const percent =
    progress.bytesTotal > 0 ? Math.min(100, Math.round((progress.bytesDone / progress.bytesTotal) * 100)) : 0;

  return (
    <div className="force-update-overlay" role="alertdialog" aria-modal="true" aria-labelledby="force-update-title">
      <div className="force-update-card">
        <div className="force-update-glyph">
          <LockOutlined />
        </div>
        <h1 id="force-update-title" className="force-update-title">Required update</h1>
        <div className="force-update-version">
          Version {release.version} <span className="force-update-version-current">(current {currentVersion})</span>
        </div>
        {release.notes ? <p className="force-update-notes">{release.notes}</p> : null}
        <p className="force-update-reason">
          This release contains required changes. OfficeDex will resume once the update is installed.
        </p>
        {downloading || downloaded || installing ? (
          <div className="force-update-progress">
            <Progress
              percent={installing ? 100 : percent}
              status={installing ? "active" : "normal"}
              strokeColor={notion.primary}
              railColor={notion.hairline}
              showInfo={false}
              aria-valuenow={installing ? 100 : percent}
            />
            <div className="force-update-progress-label">
              {installing
                ? "Restarting..."
                : downloaded
                  ? "Download complete. Restarting..."
                  : `Downloading... ${formatBytes(progress.bytesDone)} / ${formatBytes(progress.bytesTotal)}`}
            </div>
          </div>
        ) : (
          <Button
            type="primary"
            size="large"
            icon={<RocketOutlined />}
            onClick={onUpdate}
            className="force-update-action"
          >
            Update now
          </Button>
        )}
        {downloaded && !installing ? (
          <Button type="primary" size="large" icon={<RocketOutlined />} onClick={onInstall} className="force-update-action">
            Restart to install
          </Button>
        ) : null}
        {error ? <div className="force-update-error">{error}</div> : null}
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
