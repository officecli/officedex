import { useState } from "react";
import { Check, Circle, LoaderCircle, Pencil, Play, Presentation, SquarePen } from "lucide-react";
import type { DesktopTask } from "../../shared/types";
import { PptxProductionStage, type PptxProductionStageProps } from "./PptxProductionStage";
import { PresentationEditorFrame, type PresentationEditorFrameProps } from "./PresentationEditorFrame";
import "./progressivePptxStage.css";

export type ProgressivePptxPhase = "brief" | "outline" | "draft" | "drawing" | "ready" | "failed" | "cancelled";

export interface ProgressivePptxStageProps {
  task: DesktopTask;
  /** Indicates that the blank, editable draft has been created by the host. */
  draftReady?: boolean;
  /** Optional editor props. Supplying these mounts the real embedded editor at draft-ready. */
  editor?: Omit<PresentationEditorFrameProps, "previewToken" | "fileName"> & { previewToken: string; fileName: string };
  onBriefChange?: (value: string) => void;
  onOutlineChange?: (value: string) => void;
  onContinue?: () => void | Promise<void>;
  onStartDrawing?: () => void | Promise<void>;
  productionProps?: Omit<PptxProductionStageProps, "task">;
}

type OutlineItem = { title: string; detail?: string };

function field(task: DesktopTask, key: string): string | undefined {
  const input = task.userInput as (DesktopTask["userInput"] & Record<string, unknown>) | undefined;
  const value = input?.[key] ?? (task as DesktopTask & Record<string, unknown>)[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function outlineItems(task: DesktopTask): OutlineItem[] {
  const raw = (task as DesktopTask & { vibeOutline?: unknown }).vibeOutline;
  const source = raw ?? task.vibeTree?.tree.nodes.filter((node) => node.kind === "slide" || node.kind === "outline");
  if (Array.isArray(source)) return source.map((item, index) => typeof item === "string" ? { title: item } : { title: String((item as Record<string, unknown>).title ?? `Slide ${index + 1}`), detail: typeof (item as Record<string, unknown>).summary === "string" ? (item as Record<string, unknown>).summary as string : undefined });
  if (source && typeof source === "object") {
    const slides = (source as Record<string, unknown>).slides;
    if (Array.isArray(slides)) return slides.map((item, index) => typeof item === "string" ? { title: item } : { title: String((item as Record<string, unknown>).title ?? `Slide ${index + 1}`), detail: typeof (item as Record<string, unknown>).summary === "string" ? (item as Record<string, unknown>).summary as string : undefined });
  }
  return [];
}

function phaseFor(task: DesktopTask, draftReady: boolean): ProgressivePptxPhase {
  if (task.status === "failed") return "failed";
  if (task.status === "cancelled") return "cancelled";
  if (task.status === "completed") return "ready";
  if (task.vibeSlides?.some(Boolean) || (task as DesktopTask & { vibeOps?: unknown[] }).vibeOps?.length) return "drawing";
  if (draftReady) return "draft";
  if (task.plan || task.vibeTree || (task as DesktopTask & { vibeOutline?: unknown }).vibeOutline) return "outline";
  return "brief";
}

function opStream(task: DesktopTask): Array<{ seq?: number; op: string; slide?: number }> {
  const ops = (task as DesktopTask & { vibeOps?: unknown }).vibeOps;
  if (!Array.isArray(ops)) return [];
  return ops.slice(-10).map((value) => {
    const entry = value && typeof value === "object" ? value as Record<string, unknown> : {};
    return { seq: typeof entry.seq === "number" ? entry.seq : undefined, op: typeof entry.op === "string" ? entry.op : "operation", slide: typeof entry.slide === "number" ? entry.slide : undefined };
  });
}

const phaseLabels: Record<ProgressivePptxPhase, string> = {
  brief: "确认制作方向", outline: "调整演示大纲", draft: "准备可编辑画布", drawing: "逐页绘制中", ready: "演示文稿已就绪", failed: "生成遇到问题", cancelled: "生成已取消",
};

export function ProgressivePptxStage({ task, draftReady = false, editor, onBriefChange, onOutlineChange, onContinue, onStartDrawing, productionProps }: ProgressivePptxStageProps) {
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState<string>();
  const phase = phaseFor(task, draftReady);
  const items = outlineItems(task);
  const ops = opStream(task);
  const brief = field(task, "prompt") ?? task.topic ?? "未提供制作目标";
  const editableBrief = phase === "brief" || phase === "outline";
  const showEditor = draftReady || phase === "drawing" || phase === "ready";
  const runAction = async (action?: () => void | Promise<void>) => {
    if (!action || actionBusy) return;
    setActionError(undefined);
    setActionBusy(true);
    try {
      await action();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setActionBusy(false);
    }
  };
  return <section className="progressive-pptx-stage" data-testid="progressive-pptx-stage" data-phase={phase}>
    <header className="progressive-pptx-stage__header">
      <div><span className="progressive-pptx-stage__eyebrow"><Presentation size={14} /> PPTX 制作</span><h2>{phaseLabels[phase]}</h2><p>先确认方向，再逐步把每一页绘制成可编辑演示文稿。</p></div>
      <div className="progressive-pptx-stage__steps" aria-label="Production steps">
        {(["brief", "outline", "draft", "drawing", "ready"] as ProgressivePptxPhase[]).map((step, index) => <span className={step === phase ? "is-current" : (["brief", "outline", "draft", "drawing", "ready"].indexOf(phase) > index ? "is-done" : "")} key={step}>{["brief", "outline", "draft", "drawing", "ready"].indexOf(phase) > index ? <Check size={13} /> : <Circle size={13} />}{index + 1}</span>)}
      </div>
    </header>

    {(phase === "brief" || phase === "outline") ? <div className="progressive-pptx-stage__disclosure" data-testid="progressive-disclosure">
      <div className="progressive-pptx-stage__card"><div className="progressive-pptx-stage__card-title"><SquarePen size={16} /> Brief <span>现在就可以介入</span></div><textarea aria-label="Presentation brief" value={brief} disabled={!editableBrief || !onBriefChange} onChange={(event) => onBriefChange?.(event.target.value)} /></div>
      {phase === "outline" || items.length > 0 ? <div className="progressive-pptx-stage__card"><div className="progressive-pptx-stage__card-title"><Pencil size={16} /> Outline <span>可调整页面顺序和目的</span></div>{items.length ? <ol aria-label="Presentation outline">{items.map((item, index) => <li key={`${item.title}-${index}`}><input aria-label={`Slide ${index + 1} title`} defaultValue={item.title} disabled={!onOutlineChange} onChange={(event) => onOutlineChange?.(event.target.value)} /><small>{item.detail}</small></li>)}</ol> : <p className="progressive-pptx-stage__muted">大纲生成后会显示在这里。</p>}</div> : null}
      <div className="progressive-pptx-stage__disclosure-actions">{onContinue ? <button type="button" disabled={actionBusy} onClick={() => void runAction(onContinue)}><Play size={15} />{actionBusy ? "处理中…" : "继续确认"}</button> : null}{onStartDrawing ? <button type="button" className="is-primary" disabled={actionBusy} onClick={() => void runAction(onStartDrawing)}><Play size={15} />{actionBusy ? "处理中…" : "开始绘制"}</button> : null}</div>
      {actionError ? <div className="progressive-pptx-stage__error" role="alert">{actionError}</div> : null}
    </div> : null}

    {phase === "draft" ? <div className="progressive-pptx-stage__draft" data-testid="draft-ready"><LoaderCircle className="progressive-pptx-stage__spin" size={19} /><strong>正在打开可编辑演示文稿</strong><span>画布准备好后，页面会按 op 逐步出现。</span></div> : null}
    {showEditor && editor ? <div className="progressive-pptx-stage__editor" data-testid="progressive-editor"><PresentationEditorFrame {...editor} /></div> : null}
    {ops.length > 0 ? <div className="progressive-pptx-stage__ops" data-testid="op-stream" aria-label="PPTX operation stream"><strong>实时绘制</strong><ol>{ops.map((entry, index) => <li key={`${entry.seq ?? "op"}-${index}`}><Check size={13} aria-hidden="true" /><span>{entry.op}</span>{entry.slide ? <small>第 {entry.slide} 页</small> : null}{entry.seq ? <em>#{entry.seq}</em> : null}</li>)}</ol></div> : null}
    {(phase === "drawing" || phase === "ready" || phase === "failed" || phase === "cancelled") ? <PptxProductionStage task={task} {...productionProps} /> : null}
  </section>;
}
