import { useT } from "../i18n";
import { CheckCircle2, CircleAlert, LoaderCircle, Pause, Play, RotateCcw, X } from "lucide-react";
import type { DesktopTask } from "../../shared/types";
import "./pptxProductionStage.css";
import { LiveSteeringBar } from "./LiveSteeringBar";
import { imageProgressFromOps } from "./pptxProgress";
import { pptxDeckStillDrawing } from "./pptxDeckState";

export type PptxProductionStageStatus =
  | "starting"
  | "outlining"
  | "drawing"
  | "completed"
  | "failed"
  | "cancelled";

export interface PptxProductionStageProps {
  task: DesktopTask;
  /** Controls-only presentation inside the vertical creation flow. */
  compact?: boolean;
  onCancel?: () => void;
  onRetry?: () => void;
  /** Holds the run at its next page boundary. */
  onPause?: () => void;
  /** Releases a run this UI held; the interactive gate uses onResume instead. */
  onResumeLive?: () => void;
  /** True while the run is held, so the control offers Continue rather than Pause. */
  livePaused?: boolean;
  /** Continues a run paused on a question or plan review. */
  onResume?: () => void;
  onOpenEditor?: () => void;
  onSteer?: (instruction: string) => void | Promise<void>;
}

interface StatusCopy {
  label: string;
  detail: string;
}


function statusForTask(task: DesktopTask): PptxProductionStageStatus {
  const extendedTask = task as DesktopTask & { vibeOutline?: unknown };
  // Shared with ProgressivePptxStage.phaseFor: one run, one reading of "is this
  // deck finished on screen", so the card and the status pill cannot disagree.
  if (task.status === "completed") return pptxDeckStillDrawing(task) ? "drawing" : "completed";
  if (task.status === "failed" || task.status === "cancelled") return task.status;
  if (task.status === "starting") return "starting";
  if (task.vibeSlides?.some(Boolean)) return "drawing";
  if (task.plan || task.vibeTree || extendedTask.vibeOutline) return "outlining";
  return "starting";
}

function payloadNumber(task: DesktopTask, keys: string[]): number | undefined {
  for (const event of task.events) {
    const payload = event.payload;
    if (!payload) continue;
    for (const key of keys) {
      const value = payload[key];
      if (typeof value === "number" && Number.isFinite(value)) return value;
      if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
    }
  }
  return undefined;
}

function slideProgress(task: DesktopTask): { completed: number; total?: number; current?: number } {
  const extendedTask = task as DesktopTask & { vibeOutline?: unknown };
  const slides = task.vibeSlides ?? [];
  const completed = slides.reduce((count, slide) => count + (slide ? 1 : 0), 0);
  const total = payloadNumber(task, ["total_slides", "slide_count", "total"]) ??
    (extendedTask.vibeOutline && typeof extendedTask.vibeOutline === "object" && "slides" in extendedTask.vibeOutline
      ? Array.isArray((extendedTask.vibeOutline as { slides?: unknown }).slides)
        ? ((extendedTask.vibeOutline as { slides: unknown[] }).slides.length || undefined)
        : undefined
      : undefined);
  const current = payloadNumber(task, ["slide", "slide_index", "current_slide"]);
  return { completed, total, current: current === undefined ? undefined : current + (current === 0 ? 1 : 0) };
}

export function PptxProductionStage({ task, compact = false, onCancel, onRetry, onPause, onResumeLive, livePaused = false, onResume, onOpenEditor, onSteer }: PptxProductionStageProps) {
  const t = useT();
const STATUS_COPY: Record<PptxProductionStageStatus, StatusCopy> = {
  starting: { label: t("ui.text.Starting"), detail: t("ui.text.Connectingtotheproductionruntime") },
  outlining: { label: t("ui.text.Buildingoutline"), detail: t("ui.text.Organizingthestoryandslidestructure") },
  drawing: { label: t("ui.text.Drawingslides"), detail: t("ui.text.Thedeckisappearingoneslideatatime") },
  completed: { label: t("ui.text.Readytoedit"), detail: t("ui.text.Yourpresentationisreadyforreview") },
  failed: { label: t("ui.text.Generationfailed"), detail: t("ui.text.Thegeneratedcontentispreservedwherepossible") },
  cancelled: { label: t("ui.text.Generationcancelled"), detail: t("ui.text.Completedslideshavebeenpreserved") },
};

  const status = statusForTask(task);
  const images = imageProgressFromOps(task.vibeOps ?? []);
  const heldCopy = { label: t("ui.text.Generationpaused"), detail: t("ui.text.Resumesatthenextpage") };
  const copy = livePaused
    ? heldCopy
    : images.pending > 0
      ? { ...STATUS_COPY[status], detail: t("ui.text.Pagesarereadywhilecountimagesarestillgenerating", { count: images.pending }) }
      : STATUS_COPY[status];
  const progress = slideProgress(task);
  const active = status === "starting" || status === "outlining" || status === "drawing";
  const paused = task.status === "question" || task.status === "plan_review";
  const error = task.error?.trim();
  // The bar's promise has to match what the host will do with the text: while
  // the run is live it is absorbed at the next page, and once it is over the
  // same text starts a follow-up modification instead.
  const steeringPlaceholder = (active || livePaused) && !paused
    ? t("ui.copy.TellOfficeDexwhattochangefromthenextslide")
    : t("ui.copy.Describethenextchange");

  return (
    <section className={`pptx-production-stage pptx-production-stage--${status} ${compact ? "pptx-production-stage--compact" : ""}`} data-testid="pptx-production-stage" aria-label={t("ui.text.PPTXproductionstage")}>
      {!compact ? <header className="pptx-production-stage__header">
        <div className="pptx-production-stage__heading">
          <span className="pptx-production-stage__eyebrow">{t("ui.text.PPTXproduction")}</span>
          <h2>{copy.label}</h2>
          <p>{copy.detail}</p>
        </div>
        <span className="pptx-production-stage__status" data-testid="pptx-production-status">
          {active ? <LoaderCircle className="pptx-production-stage__spin" size={16} aria-hidden="true" /> : status === "completed" ? <CheckCircle2 size={16} aria-hidden="true" /> : <CircleAlert size={16} aria-hidden="true" />}
          {copy.label}
        </span>
      </header> : null}

      {!compact ? <div className="pptx-production-stage__body">
        <div className="pptx-production-stage__canvas" data-testid="pptx-production-canvas">
          {progress.completed > 0 ? (
            <div className="pptx-production-stage__slides" aria-label={t("ui.text.Generatedslides")}>
              {Array.from({ length: progress.total ?? Math.max(progress.completed, 1) }, (_, index) => {
                const ready = Boolean(task.vibeSlides?.[index]);
                const current = progress.current === index + 1;
                return <div className={`pptx-production-stage__slide ${ready ? "is-ready" : "is-pending"} ${current ? "is-current" : ""}`} key={index} data-testid={`pptx-slide-${index + 1}`}><span>{index + 1}</span>{ready ? <CheckCircle2 size={14} aria-label={t("ui.text.ready")} /> : null}</div>;
              })}
            </div>
          ) : (
            <div className="pptx-production-stage__empty">{status === "starting" ? t("ui.text.Preparingyourpresentation") : t("ui.text.Thefirstslidewillappearhere")}</div>
          )}
        </div>
        <aside className="pptx-production-stage__progress" aria-label={t("ui.text.Slideprogress")}>
          <strong>{progress.completed}{progress.total ? ` / ${progress.total}` : ""}</strong>
          <span>{t("ui.text.slidesready")}</span>
          {progress.current ? <span>{t("ui.text.Drawingslidecount", { count: progress.current })}</span> : null}
          {images.total > 0 ? <span data-testid="pptx-image-progress">{t("ui.text.placedtotalimagesreadypendinggenerating", { placed: images.placed, total: images.total, pending: images.pending })}</span> : null}
        </aside>
      </div>

      : null}
      {/* Compact mode is the live-controls surface inside the creation flow,
          where the host owns the terminal state: it renders the failure panel,
          which states the stage, the retained pages and the resume point. A
          second error line and a second Retry here said less and competed with
          it, so the screen showed two error surfaces and two ways to retry. */}
      {error && !compact ? <div className="pptx-production-stage__error" role="alert">{error}</div> : null}

      <footer className="pptx-production-stage__actions">
        {active && onCancel ? <button type="button" className="pptx-production-stage__button" onClick={onCancel}><X size={15} /> {t("ui.text.Cancel")}</button> : null}
        {status === "drawing" && !livePaused && onPause ? <button type="button" className="pptx-production-stage__button" onClick={onPause}><Pause size={15} /> {t("ui.text.Pause")}</button> : null}
        {livePaused && onResumeLive ? <button type="button" className="pptx-production-stage__button" onClick={onResumeLive}><Play size={15} /> {t("ui.text.Continue")}</button> : null}
        {paused && onResume ? <button type="button" className="pptx-production-stage__button" onClick={onResume}><Play size={15} /> {t("ui.text.Continue")}</button> : null}
        {status === "failed" && onRetry && !compact ? <button type="button" className="pptx-production-stage__button" onClick={onRetry}><RotateCcw size={15} /> {t("ui.text.Retry")}</button> : null}
        {status === "completed" && onOpenEditor ? <button type="button" className="pptx-production-stage__primary" onClick={onOpenEditor}><CheckCircle2 size={15} /> {t("ui.text.Openeditor")}</button> : null}
      </footer>
      {onSteer && (status === "drawing" || paused || livePaused || status === "completed" || (status === "failed" && !compact)) ? (
        <LiveSteeringBar
          onSteer={onSteer}
          onPause={status === "drawing" && !livePaused ? onPause : undefined}
          onResume={paused ? onResume : livePaused ? onResumeLive : undefined}
          placeholder={steeringPlaceholder}
          disabled={false}
        />
      ) : null}
    </section>
  );
}
