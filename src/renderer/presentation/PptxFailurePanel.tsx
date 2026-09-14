import { useState } from "react";
import { Check, CircleAlert, Copy, Play, RotateCcw } from "lucide-react";
import type { DesktopTask } from "../../shared/types";
import { useT } from "../i18n";
import { Button } from "../ui";
import { pptxPartialWork } from "./pptxRuntimeActivity";
import "./pptxFailurePanel.css";

export interface PptxFailurePanelProps {
  task: DesktopTask;
  /** True while an action started from this panel is still in flight. */
  busy?: boolean;
  /**
   * The checkpoint to resume from. The host resolves it so the structured
   * failure stays authoritative while a checkpoint that only ever appeared on
   * the event stream still counts.
   */
  resumeCheckpoint?: string;
  /** Resumes the run from the checkpoint the backend reported. */
  onResume?: (checkpoint: string) => void | Promise<void>;
  /** Opens the pages the stopped run already drew and saved. */
  onOpenPartial?: () => void;
  /** Starts the whole generation over. */
  onRestart?: () => void;
}

/**
 * The one surface a stopped PPTX run gets.
 *
 * Every fact it shows is structured data: the stage that failed
 * (`task.failure.stage`), the checkpoint to resume from, and the page counts
 * from `task.partial` plus the failure's retained work. Nothing is parsed out
 * of the error sentence, and the error sentence itself is kept only for the
 * technical-details disclosure — it used to be the whole interface, printed
 * verbatim with no title and no action.
 *
 * The primary action follows the rule the failure state needs: when work
 * survived, "keep working with what exists" comes before "throw it away".
 * Restarting is never the primary while a partial deck is openable, and it says
 * how much it discards.
 */
export function PptxFailurePanel({ task, busy = false, resumeCheckpoint, onResume, onOpenPartial, onRestart }: PptxFailurePanelProps) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const failure = task.failure;
  const partial = pptxPartialWork(task);
  const drawn = partial.drawnPages ?? 0;
  const ready = partial.readyPages ?? 0;
  // What the user can actually open is what reached their document. Falling
  // back to content readiness keeps the count honest for runs that stopped
  // before the first page was drawn.
  const kept = drawn > 0 ? drawn : ready;
  const total = partial.totalPages;
  const failedPages = partial.failedPages ?? [];
  const checkpoint = resumeCheckpoint ?? failure?.resume_checkpoint;
  const retryable = failure?.retryable ?? true;

  const canResume = Boolean(checkpoint && onResume && retryable);
  const canOpen = kept > 0 && Boolean(onOpenPartial);
  const canRestart = retryable && Boolean(onRestart);
  // Only claim a page count when one is actually known: the backend reports the
  // failed pages, and a deck size minus what was kept is arithmetic on facts.
  // Inventing "1" to fill the sentence would be the message-text guessing this
  // panel exists to remove.
  const unfinished = total !== undefined && kept < total ? total - kept : failedPages.length;

  const stageKey = failure?.stage ? `pptx.failure.title.${failure.stage}` : "pptx.failure.title.content";
  const diagnostics = [
    `stage: ${failure?.stage ?? "unknown"}`,
    `reason: ${failure?.reason ?? "unknown"}`,
    checkpoint ? `resume: ${checkpoint}` : undefined,
    total === undefined ? undefined : `pages: ${kept}/${total} kept`,
    task.error ? `error: ${task.error}` : undefined,
  ].filter(Boolean).join("\n");

  const action = (run: () => void | Promise<void>) => {
    if (busy) return;
    void run();
  };

  // One primary, and a secondary that is a genuinely different road. When the
  // only thing on offer is a restart there is no second action to add, and
  // repeating it would put two identical buttons on the screen — which is the
  // shape of the problem this panel replaces.
  const primaryKind: "resume" | "open" | "restart" | null = canResume ? "resume" : canOpen ? "open" : canRestart ? "restart" : null;
  const secondaryKind: "open" | "restart" | null = primaryKind === "resume"
    ? (canOpen ? "open" : canRestart ? "restart" : null)
    : primaryKind === "open" && canRestart ? "restart" : null;

  const primary = primaryKind === "resume" ? (
    <Button key="resume" className="is-primary" disabled={busy} icon={<Play size={14} />} onClick={() => action(() => onResume!(checkpoint!))}>
      {unfinished > 0 ? t("pptx.failure.resume", { count: unfinished }) : t("pptx.failure.resumeUnknown")}
    </Button>
  ) : primaryKind === "open" ? (
    <Button key="open" className="is-primary" disabled={busy} onClick={() => action(() => onOpenPartial!())}>
      {t("pptx.failure.openPartial", { count: kept })}
    </Button>
  ) : primaryKind === "restart" ? (
    // A restart discards work whether it is the primary or the secondary, so
    // the cost is stated wherever it appears. Leaving it off the primary would
    // make the one button most likely to be clicked the only one that does not
    // say what it throws away.
    <Button key="restart" className="is-primary" disabled={busy} icon={<RotateCcw size={14} />} onClick={() => action(() => onRestart!())}>
      {t("pptx.failure.restart")}{kept > 0 ? ` · ${t("pptx.failure.restartWarning", { count: kept })}` : ""}
    </Button>
  ) : null;

  const secondary = secondaryKind === "open" ? (
    <Button key="open-secondary" disabled={busy} onClick={() => action(() => onOpenPartial!())}>
      {t("pptx.failure.openPartial", { count: kept })}
    </Button>
  ) : secondaryKind === "restart" ? (
    <Button key="restart-secondary" className="is-danger" disabled={busy} onClick={() => action(() => onRestart!())}>
      {t("pptx.failure.restart")}{kept > 0 ? ` · ${t("pptx.failure.restartWarning", { count: kept })}` : ""}
    </Button>
  ) : null;

  return (
    <section
      className="pptx-failure"
      data-stage={failure?.stage}
      data-reason={failure?.reason}
      data-resume={canResume ? "checkpoint" : "none"}
      role="alert"
      aria-live="assertive"
    >
      <header className="pptx-failure__head">
        <CircleAlert size={18} aria-hidden="true" />
        <h3>{t(stageKey)}</h3>
        {kept > 0 ? <span className="pptx-failure__kept">{total === undefined ? t("pptx.failure.retainedNoTotal", { drawn: kept }) : t("pptx.failure.retained", { drawn: kept, total })}</span> : null}
      </header>
      <p className="pptx-failure__body">{t("pptx.failure.body")}</p>
      {failedPages.length ? <p className="pptx-failure__pages">{t("pptx.failure.failedPages", { pages: failedPages.join(", ") })}</p> : null}
      {canOpen ? <p className="pptx-failure__hint">{t("pptx.failure.openPartialHint")}</p> : null}
      <div className="pptx-failure__actions">{primary}{secondary}</div>
      <details className="pptx-failure__details">
        <summary>{t("pptx.failure.details")}</summary>
        <pre data-testid="pptx-failure-diagnostics">{diagnostics}</pre>
        <Button
          size="small"
          icon={copied ? <Check size={13} /> : <Copy size={13} />}
          onClick={() => {
            void navigator.clipboard?.writeText(diagnostics).catch(() => undefined);
            setCopied(true);
          }}
        >
          {copied ? t("pptx.failure.copied") : t("pptx.failure.copyDiagnostics")}
        </Button>
      </details>
    </section>
  );
}
