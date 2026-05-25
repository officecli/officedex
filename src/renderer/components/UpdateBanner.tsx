import { Button, Progress } from "antd";
import { CloseOutlined, DownloadOutlined, RocketOutlined } from "@ant-design/icons";
import { notion } from "../designTokens";
import type { AppUpdateRelease } from "../../shared/types";
import type { UpdatePhase } from "../useAppUpdate";
import { useT } from "../i18n";

export interface UpdateBannerProps {
  release: AppUpdateRelease;
  phase: UpdatePhase;
  progress: { bytesDone: number; bytesTotal: number };
  error: string | null;
  onUpdate: () => void;
  onInstall: () => void;
  onDismiss: () => void;
}

export function UpdateBanner({
  release,
  phase,
  progress,
  error,
  onUpdate,
  onInstall,
  onDismiss,
}: UpdateBannerProps) {
  const t = useT();
  const downloading = phase === "downloading";
  const downloaded = phase === "downloaded" || phase === "installing";
  const percent =
    progress.bytesTotal > 0 ? Math.min(100, Math.round((progress.bytesDone / progress.bytesTotal) * 100)) : 0;

  return (
    <div className="update-banner" role="status" aria-live="polite">
      <div className="update-banner-icon">
        <RocketOutlined />
      </div>
      <div className="update-banner-body">
        <div className="update-banner-title">{t("update.banner.title", { version: release.version })}</div>
        {downloading ? (
          <div className="update-banner-progress">
            <Progress
              percent={percent}
              size="small"
              showInfo={false}
              strokeColor={notion.onPrimary}
              railColor="rgba(255, 255, 255, 0.24)"
            />
            <span className="update-banner-bytes">
              {formatBytes(progress.bytesDone)} / {formatBytes(progress.bytesTotal)}
            </span>
          </div>
        ) : null}
        {error ? <div className="update-banner-error">{error}</div> : null}
      </div>
      <div className="update-banner-actions">
        {downloaded ? (
          <Button type="primary" icon={<RocketOutlined />} onClick={onInstall}>
            {t("update.banner.restartToInstall")}
          </Button>
        ) : downloading ? (
          <Button disabled icon={<DownloadOutlined />}>
            {t("update.banner.downloading")}
          </Button>
        ) : (
          <Button type="primary" icon={<DownloadOutlined />} onClick={onUpdate}>
            {t("update.banner.updateNow")}
          </Button>
        )}
        <Button type="text" icon={<CloseOutlined />} aria-label={t("update.banner.dismissAria")} onClick={onDismiss}>
          {t("update.banner.later")}
        </Button>
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
