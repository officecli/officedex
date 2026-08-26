import { Button } from "../ui";
import { CloseOutlined, RocketOutlined } from "../ui/icons";
import type { AppUpdateRelease } from "../../shared/types";
import type { UpdatePhase } from "../useAppUpdate";
import { useT } from "../i18n";

export interface SidebarUpdateRowProps {
  release: AppUpdateRelease;
  phase: UpdatePhase;
  progress: { bytesDone: number; bytesTotal: number };
  error: string | null;
  onUpdate: () => void;
  onInstall: () => void;
  onDismiss: () => void;
}

// Compact sidebar replacement for the old full-width update banner: an
// optional update is a passing notice, not a takeover. Mandatory updates
// still go through ForceUpdateOverlay.
export function SidebarUpdateRow({ release, phase, progress, error, onUpdate, onInstall, onDismiss }: SidebarUpdateRowProps) {
  const t = useT();
  const downloading = phase === "downloading";
  const downloaded = phase === "downloaded" || phase === "installing";
  const percent = progress.bytesTotal > 0 ? Math.min(100, Math.round((progress.bytesDone / progress.bytesTotal) * 100)) : 0;
  const label = downloaded
    ? t("update.banner.restartToInstall")
    : error
      ? t("update.row.retry")
      : downloading
        ? t("update.banner.downloading")
        : t("update.banner.title", { version: release.version });

  return (
    <div
      className={`sidebar-update${downloaded ? " sidebar-update--ready" : ""}${error ? " sidebar-update--error" : ""}`}
      role="status"
      aria-live="polite"
    >
      <button
        type="button"
        className="sidebar-update__main"
        disabled={downloading}
        title={error ?? t("update.banner.title", { version: release.version })}
        onClick={() => {
          if (downloaded) onInstall();
          else onUpdate();
        }}
      >
        <RocketOutlined aria-hidden />
        <span className="sidebar-update__copy">
          <span className="sidebar-update__label">{label}</span>
          {downloading ? (
            <span className="sidebar-update__bar" aria-hidden="true"><i style={{ width: `${percent}%` }} /></span>
          ) : null}
        </span>
      </button>
      {!downloading && !downloaded ? (
        <Button className="sidebar-update__dismiss" variant="ghost-normal" size="small" ariaLabel={t("update.banner.dismissAria")} icon={<CloseOutlined />} onClick={onDismiss} />
      ) : null}
    </div>
  );
}
