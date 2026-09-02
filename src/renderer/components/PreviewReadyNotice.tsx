import { useEffect, useState } from "react";
import type { Artifact, PreviewGrant } from "../../shared/types";
import { officecli } from "../bridge";
import { useT } from "../i18n";
import { Button, toast } from "../ui";
import { CheckCircleOutlined, FolderOpenOutlined } from "../ui/icons";

interface PreviewReadyNoticeProps {
  artifact: Artifact;
  grant: PreviewGrant;
}

const AUTO_COLLAPSE_MS = 4_000;

export function PreviewReadyNotice({ artifact, grant }: PreviewReadyNoticeProps) {
  const t = useT();
  const [expanded, setExpanded] = useState(true);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    setExpanded(true);
    setPaused(false);
  }, [artifact.filePath, grant.fileName]);

  useEffect(() => {
    if (!expanded || paused) return;
    const timer = window.setTimeout(() => setExpanded(false), AUTO_COLLAPSE_MS);
    return () => window.clearTimeout(timer);
  }, [expanded, paused]);

  const revealInFolder = async () => {
    try {
      await officecli.showItemInFolder(artifact.filePath);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      toast.error(t("preview.showInFolderFailed", { error: detail }));
    }
  };

  return (
    <div
      className={`preview-ready-notice preview-ready-notice--${grant.documentType}${expanded ? " is-expanded" : " is-collapsed"}`}
      role="status"
      aria-live="polite"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setPaused(false);
      }}
    >
      <button
        type="button"
        className="preview-ready-notice__toggle"
        aria-expanded={expanded}
        aria-label={expanded ? t("preview.ready.collapse") : t("preview.ready.expand", { file: grant.fileName })}
        onClick={() => setExpanded((current) => !current)}
      >
        <CheckCircleOutlined aria-hidden />
        {expanded ? (
          <span className="preview-ready-notice__copy">
            <strong>{t("preview.ready")}</strong>
            <span title={grant.fileName}>{grant.fileName}</span>
          </span>
        ) : null}
      </button>
      {expanded ? (
        <Button
          className="preview-ready-notice__action"
          size="small"
          variant="ghost-guidance"
          icon={<FolderOpenOutlined aria-hidden />}
          onClick={() => void revealInFolder()}
        >
          {t("preview.showInFolder")}
        </Button>
      ) : null}
    </div>
  );
}
