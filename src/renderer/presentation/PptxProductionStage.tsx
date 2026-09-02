import { CheckCircle2, CircleAlert, LoaderCircle, Pause, Play, RotateCcw, X } from "lucide-react";
import type { DesktopTask } from "../../shared/types";
import "./pptxProductionStage.css";
import { LiveSteeringBar } from "./LiveSteeringBar";
import { imageProgressFromOps } from "./pptxProgress";

export type PptxProductionStageStatus =
  | "starting"
  | "outlining"
  | "drawing"
  | "completed"
  | "failed"
  | "cancelled";

export interface PptxProductionStageProps {
  task: DesktopTask;
  onCancel?: () => void;
  onRetry?: () => void;
  onPause?: () => void;
  onResume?: () => void;
  onOpenEditor?: () => void;
  onSteer?: (instruction: string) => void | Promise<void>;
  onContinueFromNode?: () => void | Promise<void>;
}

interface StatusCopy {
  label: string;
  detail: string;
}

const STATUS_COPY: Record<PptxProductionStageStatus, StatusCopy> = {
  starting: { label: "Starting", detail: "Connecting to the production runtime…" },
  outlining: { label: "Building outline", detail: "Organizing the story and slide structure…" },
  drawing: { label: "Drawing slides", detail: "The deck is appearing one slide at a time…" },
  completed: { label: "Ready to edit", detail: "Your presentation is ready for review." },
  failed: { label: "Generation failed", detail: "The generated content is preserved where possible." },
  cancelled: { label: "Generation cancelled", detail: "Completed slides have been preserved." },
};

function statusForTask(task: DesktopTask): PptxProductionStageStatus {
  const extendedTask = task as DesktopTask & { vibeOutline?: unknown };
  const images = imageProgressFromOps(task.vibeOps ?? []);
  if (task.status === "completed" && images.pending > 0) return "drawing";
  if (task.status === "completed" || task.status === "failed" || task.status === "cancelled") return task.status;
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

export function PptxProductionStage({ task, onCancel, onRetry, onPause, onResume, onOpenEditor, onSteer, onContinueFromNode }: PptxProductionStageProps) {
  const status = statusForTask(task);
  const images = imageProgressFromOps(task.vibeOps ?? []);
  const copy = images.pending > 0
    ? { ...STATUS_COPY[status], detail: `Pages are ready while ${images.pending} image${images.pending === 1 ? " is" : "s are"} still generating…` }
    : STATUS_COPY[status];
  const progress = slideProgress(task);
  const active = status === "starting" || status === "outlining" || status === "drawing";
  const paused = task.status === "question" || task.status === "plan_review";
  const error = task.error?.trim();

  return (
    <section className={`pptx-production-stage pptx-production-stage--${status}`} data-testid="pptx-production-stage" aria-label="PPTX production stage">
      <header className="pptx-production-stage__header">
        <div className="pptx-production-stage__heading">
          <span className="pptx-production-stage__eyebrow">PPTX production</span>
          <h2>{copy.label}</h2>
          <p>{copy.detail}</p>
        </div>
        <span className="pptx-production-stage__status" data-testid="pptx-production-status">
          {active ? <LoaderCircle className="pptx-production-stage__spin" size={16} aria-hidden="true" /> : status === "completed" ? <CheckCircle2 size={16} aria-hidden="true" /> : <CircleAlert size={16} aria-hidden="true" />}
          {copy.label}
        </span>
      </header>

      <div className="pptx-production-stage__body">
        <div className="pptx-production-stage__canvas" data-testid="pptx-production-canvas">
          {progress.completed > 0 ? (
            <div className="pptx-production-stage__slides" aria-label="Generated slides">
              {Array.from({ length: progress.total ?? Math.max(progress.completed, 1) }, (_, index) => {
                const ready = Boolean(task.vibeSlides?.[index]);
                const current = progress.current === index + 1;
                return <div className={`pptx-production-stage__slide ${ready ? "is-ready" : "is-pending"} ${current ? "is-current" : ""}`} key={index} data-testid={`pptx-slide-${index + 1}`}><span>{index + 1}</span>{ready ? <CheckCircle2 size={14} aria-label="ready" /> : null}</div>;
              })}
            </div>
          ) : (
            <div className="pptx-production-stage__empty">{status === "starting" ? "Preparing your presentation…" : "The first slide will appear here."}</div>
          )}
        </div>
        <aside className="pptx-production-stage__progress" aria-label="Slide progress">
          <strong>{progress.completed}{progress.total ? ` / ${progress.total}` : ""}</strong>
          <span>slides ready</span>
          {progress.current ? <span>Drawing slide {progress.current}</span> : null}
          {images.total > 0 ? <span data-testid="pptx-image-progress">{images.placed} / {images.total} images ready{images.pending > 0 ? ` · ${images.pending} generating` : ""}</span> : null}
        </aside>
      </div>

      {error ? <div className="pptx-production-stage__error" role="alert">{error}</div> : null}

      <footer className="pptx-production-stage__actions">
        {active && onCancel ? <button type="button" className="pptx-production-stage__button" onClick={onCancel}><X size={15} /> Cancel</button> : null}
        {status === "drawing" && onPause ? <button type="button" className="pptx-production-stage__button" onClick={onPause}><Pause size={15} /> Pause</button> : null}
        {paused && onResume ? <button type="button" className="pptx-production-stage__button" onClick={onResume}><Play size={15} /> Continue</button> : null}
        {status === "failed" && onRetry ? <button type="button" className="pptx-production-stage__button" onClick={onRetry}><RotateCcw size={15} /> Retry</button> : null}
        {status === "completed" && onOpenEditor ? <button type="button" className="pptx-production-stage__primary" onClick={onOpenEditor}><CheckCircle2 size={15} /> Open editor</button> : null}
      </footer>
      {onSteer && (status === "drawing" || paused || status === "failed" || status === "completed") ? (
        <LiveSteeringBar
          onSteer={onSteer}
          onPause={status === "drawing" ? onPause : undefined}
          onResume={paused ? onResume : undefined}
          onRetry={status === "failed" ? onRetry : undefined}
          onContinueFromNode={status === "completed" ? onContinueFromNode : undefined}
          disabled={false}
        />
      ) : null}
    </section>
  );
}
