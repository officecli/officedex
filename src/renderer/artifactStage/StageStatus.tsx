import { useState, type ReactNode } from "react";
import { Button } from "../ui";
import "./artifactStage.css";

export type ArtifactStageStatus = "pending" | "starting" | "running" | "paused" | "completed" | "failed" | "cancelled";

export interface ArtifactStageStatusProps {
  readonly status: ArtifactStageStatus;
  readonly message?: ReactNode;
  readonly error?: ReactNode;
  readonly onCancel?: () => void | Promise<void>;
  readonly onRetry?: () => void | Promise<void>;
  readonly onPause?: () => void | Promise<void>;
  readonly onResume?: () => void | Promise<void>;
  readonly onContinue?: () => void | Promise<void>;
  readonly className?: string;
}

const statusLabels: Record<ArtifactStageStatus, string> = {
  pending: "Pending",
  starting: "Starting",
  running: "In progress",
  paused: "Paused",
  completed: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
};

/** Shared lifecycle banner for all artifact Stage implementations. */
export function ArtifactStageStatusBanner({ status, message, error, onCancel, onRetry, onPause, onResume, onContinue, className }: ArtifactStageStatusProps) {
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const canCancel = status === "pending" || status === "running";
  const canRetry = status === "failed" || status === "cancelled";
  const canPause = status === "running";
  const canResume = status === "paused";
  const canContinue = status === "completed" || status === "cancelled";
  const runAction = async (action: (() => void | Promise<void>) | undefined) => {
    if (!action || actionBusy) return;
    setActionBusy(true);
    setActionError(null);
    try {
      await action();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setActionBusy(false);
    }
  };

  return (
    <div className={["artifact-stage-status", `artifact-stage-status--${status}`, className].filter(Boolean).join(" ")} data-status={status} role="status" aria-live={status === "running" ? "polite" : "assertive"}>
      <div className="artifact-stage-status__copy">
        <strong>{statusLabels[status]}</strong>
        {message ? <span>{message}</span> : null}
        {error ? <span className="artifact-stage-status__error">{error}</span> : null}
        {actionError ? <span className="artifact-stage-status__error" role="alert">{actionError}</span> : null}
      </div>
      <div className="artifact-stage-status__actions">
        {canCancel && onCancel ? <Button type="text" size="small" disabled={actionBusy} loading={actionBusy} onClick={() => void runAction(onCancel)}>Cancel</Button> : null}
        {canPause && onPause ? <Button type="text" size="small" disabled={actionBusy} loading={actionBusy} onClick={() => void runAction(onPause)}>Pause</Button> : null}
        {canResume && onResume ? <Button type="primary" size="small" disabled={actionBusy} loading={actionBusy} onClick={() => void runAction(onResume)}>Resume</Button> : null}
        {canContinue && onContinue ? <Button type="text" size="small" disabled={actionBusy} loading={actionBusy} onClick={() => void runAction(onContinue)}>Continue</Button> : null}
        {canRetry && onRetry ? <Button type="primary" size="small" disabled={actionBusy} loading={actionBusy} onClick={() => void runAction(onRetry)}>Retry</Button> : null}
      </div>
    </div>
  );
}
