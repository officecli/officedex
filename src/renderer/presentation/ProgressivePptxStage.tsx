import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, Check, Circle, LoaderCircle, Pencil, Play, Presentation, SquarePen } from "lucide-react";
import type { DesktopTask, TaskQuestionAnswer } from "../../shared/types";
import { PptxProductionStage, type PptxProductionStageProps } from "./PptxProductionStage";
import { PresentationEditorFrame, type PresentationEditorFrameProps } from "./PresentationEditorFrame";
import { useT } from "../i18n";
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
  onContinue?: (outline?: Array<{ id: string; title: string; detail?: string; estimatedSlides?: number; slide?: number }>) => void | Promise<void>;
  onStartDrawing?: (outline?: Array<{ id: string; title: string; detail?: string; estimatedSlides?: number; slide?: number }>) => void | Promise<void>;
  onQuestionAnswer?: (answer: TaskQuestionAnswer) => void | Promise<void>;
  onDeleteTask?: () => void | Promise<void>;
  productionProps?: Omit<PptxProductionStageProps, "task">;
}

type OutlineItem = { id: string; title: string; detail?: string; estimatedSlides?: number; slide?: number };

function asOutlineItem(value: unknown, index: number): OutlineItem | null {
  if (typeof value === "string" && value.trim()) return { id: `outline-${index + 1}`, title: value.trim() };
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  const title = [item.title, item.headline, item.heading, item.name, item.groupTitle, item.sectionTitle]
    .find((candidate): candidate is string => typeof candidate === "string" && candidate.trim().length > 0);
  if (!title) return null;
  const detail = [item.purpose, item.takeawayHint, item.summary, item.detail, item.description, item.intent]
    .find((candidate): candidate is string => typeof candidate === "string" && candidate.trim().length > 0);
  const estimatedSlides = typeof item.estimatedSlides === "number" && Number.isFinite(item.estimatedSlides)
    ? Math.max(0, Math.round(item.estimatedSlides))
    : undefined;
  const explicitSlide = [item.slide, item.slideNumber, item.slide_number]
    .find((candidate): candidate is number => typeof candidate === "number" && Number.isInteger(candidate) && candidate > 0);
  const id = typeof item.id === "string" && item.id.trim() ? item.id : `outline-${index + 1}`;
  const idSlide = explicitSlide === undefined && /(?:^|[-_])(?:slide|s|outline)[-_]?(\d+)$/i.test(id)
    ? Number(id.match(/(\d+)$/)?.[1])
    : undefined;
  return { id, title: title.trim(), detail: detail?.trim(), estimatedSlides, slide: explicitSlide ?? idSlide ?? index + 1 };
}

function groupedSlideItems(slides: unknown[]): OutlineItem[] {
  const groups: OutlineItem[] = [];
  const byKey = new Map<string, OutlineItem>();
  slides.forEach((slide, index) => {
    const item = asOutlineItem(slide, index);
    if (!item) return;
    const record = slide && typeof slide === "object" ? slide as Record<string, unknown> : {};
    const key = [record.sectionId, record.groupId, record.groupTitle, record.sectionTitle]
      .find((candidate): candidate is string => typeof candidate === "string" && candidate.trim().length > 0)?.trim();
    if (!key) { groups.push(item); return; }
    const existing = byKey.get(key);
    if (existing) { existing.estimatedSlides = (existing.estimatedSlides ?? 0) + 1; return; }
    const group = { ...item, id: key, title: typeof record.groupTitle === "string" ? record.groupTitle : item.title, estimatedSlides: 1 };
    byKey.set(key, group);
    groups.push(group);
  });
  if (groups.length <= 12) return groups;
  const chunkSize = Math.ceil(groups.length / 8);
  return Array.from({ length: Math.ceil(groups.length / chunkSize) }, (_, index) => {
    const chunk = groups.slice(index * chunkSize, (index + 1) * chunkSize);
    return {
      id: `generated-section-${index + 1}`,
      title: chunk[0]?.title || `Section ${index + 1}`,
      detail: `${chunk.map((item) => item.title).join(" · ")}`,
      estimatedSlides: chunk.reduce((total, item) => total + (item.estimatedSlides ?? 1), 0),
    };
  });
}

function markdownOutline(markdown: string): OutlineItem[] {
  const lines = markdown.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const headings = lines.filter((line) => /^(?:#{1,3}\s+|[-*+]\s+|\d+[.)]\s+)/.test(line));
  const source = headings.length > 0 ? headings : lines;
  return source
    .map((line) => line.replace(/^(?:#{1,6}\s+|[-*+]\s+|\d+[.)]\s+)/, "").trim())
    .filter((line) => line.length > 0 && !/^outline:?$/i.test(line))
    .slice(0, 12)
    .map((title, index) => ({ id: `markdown-${index + 1}`, title }));
}

function field(task: DesktopTask, key: string): string | undefined {
  const input = task.userInput as (DesktopTask["userInput"] & Record<string, unknown>) | undefined;
  const value = input?.[key] ?? (task as DesktopTask & Record<string, unknown>)[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function outlineItems(task: DesktopTask): OutlineItem[] {
  const raw = (task as DesktopTask & { vibeOutline?: unknown }).vibeOutline;
  // The staged Vibe tree is the canonical narrative source: branch/chapter
  // nodes are the user's reviewable story sections, while vibe_outline is a
  // lower-level per-slide disclosure used by older progressive runs.
  const nodes = task.vibeTree?.tree.nodes ?? [];
  const sections = nodes.filter((node) => node.kind === "branch" || node.kind === "slide_group" || node.kind === "chapter").map(asOutlineItem).filter((item): item is OutlineItem => Boolean(item));
  if (sections.length > 0) return sections;
  if (raw && typeof raw === "object") {
    const record = raw as Record<string, unknown>;
    for (const key of ["sections", "chapters", "groups"]) {
      if (Array.isArray(record[key])) {
        const sections = record[key].map(asOutlineItem).filter((item): item is OutlineItem => Boolean(item));
        if (sections.length > 0) return sections;
      }
    }
    if (Array.isArray(record.slides)) {
      const grouped = groupedSlideItems(record.slides);
      if (grouped.length > 0) return grouped;
    }
    const item = asOutlineItem(raw, 0);
    if (item) return [item];
  }
  const slides = nodes.filter((node) => node.kind === "slide" || node.kind === "outline");
  if (slides.length > 0) return groupedSlideItems(slides);
  // Older/hosted runtimes often send only task.plan.markdown. Keep the stage
  // useful in that shape instead of showing an empty outline gate.
  const markdown = task.plan?.markdown?.trim();
  if (!markdown) return [];
  const parsed = markdownOutline(markdown);
  return parsed.length > 0 ? parsed : [{ id: "markdown-1", title: markdown.replace(/\s+/g, " ").slice(0, 160) }];
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

const phaseLabelKeys: Record<ProgressivePptxPhase, string> = { brief: "pptx.stage.brief", outline: "pptx.stage.outline", draft: "pptx.stage.draft", drawing: "pptx.stage.drawing", ready: "pptx.stage.ready", failed: "pptx.stage.failed", cancelled: "pptx.stage.cancelled" };
const productionSteps: Array<{ id: ProgressivePptxPhase; labelKey: string; detailKey: string }> = [
  { id: "brief", labelKey: "pptx.stage.stepLabel.brief", detailKey: "pptx.stage.step.brief" },
  { id: "outline", labelKey: "pptx.stage.stepLabel.outline", detailKey: "pptx.stage.step.outline" },
  { id: "draft", labelKey: "pptx.stage.stepLabel.draft", detailKey: "pptx.stage.step.draft" },
  { id: "drawing", labelKey: "pptx.stage.stepLabel.drawing", detailKey: "pptx.stage.step.drawing" },
  { id: "ready", labelKey: "pptx.stage.stepLabel.ready", detailKey: "pptx.stage.step.ready" },
];

export function ProgressivePptxStage({ task, draftReady = false, editor, onBriefChange, onOutlineChange, onContinue, onStartDrawing, onQuestionAnswer, onDeleteTask, productionProps }: ProgressivePptxStageProps) {
  const t = useT();
  const [actionBusy, setActionBusy] = useState(false);
  const actionInFlightRef = useRef(false);
  const [actionError, setActionError] = useState<string>();
  const [customAnswer, setCustomAnswer] = useState("");
  const [selectedOptionId, setSelectedOptionId] = useState<string>();
  const [hasMoreBelow, setHasMoreBelow] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const phase = phaseFor(task, draftReady);
  const items = useMemo(() => outlineItems(task), [task.id, task.plan?.revision, task.plan?.markdown, task.vibeTree, task.vibeOutline]);
  const [outlineDraft, setOutlineDraft] = useState<OutlineItem[]>(items);
  const [draggedOutlineIndex, setDraggedOutlineIndex] = useState<number | null>(null);
  useEffect(() => setOutlineDraft(items), [items]);
  const olderOutlineItems = outlineDraft.length > 1 ? outlineDraft.slice(0, -1) : [];
  const latestOutlineItem = outlineDraft.length > 0 ? outlineDraft[outlineDraft.length - 1] : undefined;
  const ops = opStream(task);
  const brief = field(task, "prompt") ?? task.topic ?? t("pptx.stage.briefMissing");
  const question = task.status === "question" && phase === "brief" ? task.question : undefined;
  const defaultOption = question?.options.find((option) => option.recommended) ?? question?.options[0];
  const waitingForUser = task.status === "question" || task.status === "plan_review";
  const processing = task.status === "starting" || task.status === "running";
  const editableBrief = waitingForUser && (phase === "brief" || phase === "outline") && Boolean(onBriefChange);
  const showEditor = draftReady || phase === "drawing" || phase === "ready";
  const heading = phase === "brief" && processing ? t("pptx.stage.processingBrief") : phase === "outline" && processing ? t("pptx.stage.processingOutline") : t(phaseLabelKeys[phase]);
  const description = phase === "brief" && processing ? t("pptx.stage.processingBriefDesc") : phase === "outline" && processing ? t("pptx.stage.processingOutlineDesc") : t("pptx.stage.processingOutlineDesc");
  useEffect(() => {
    setCustomAnswer("");
    setSelectedOptionId(defaultOption?.id);
  }, [task.id, question?.id, defaultOption?.id]);
  const submitQuestion = question && onQuestionAnswer ? () => {
    const selectedOption = question.options.find((option) => option.id === selectedOptionId) ?? defaultOption;
    const freeform = customAnswer.trim();
    return onQuestionAnswer({
      questionId: question.id || "question",
      answer: freeform || selectedOption?.label || "continue",
      ...(freeform || !selectedOption ? {} : { optionId: selectedOption.id }),
      ...(question.currentIndex === undefined ? {} : { questionIndex: question.currentIndex }),
    });
  } : undefined;
  const primaryAction = phase === "outline" ? (onStartDrawing ?? onContinue) : (submitQuestion ?? onContinue ?? onStartDrawing);
  const primaryLabel = phase === "outline" ? t("pptx.stage.confirmOutline") : t("pptx.stage.confirmBrief");
  const processingLabel = phase === "outline" ? t("pptx.stage.processingOutline") : t("pptx.stage.processingBrief");
  const runAction = async (action?: (outline?: OutlineItem[]) => void | Promise<void>) => {
    if (!action || actionInFlightRef.current) return;
    actionInFlightRef.current = true;
    setActionError(undefined);
    setActionBusy(true);
    try {
      await action(outlineDraft);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      actionInFlightRef.current = false;
      setActionBusy(false);
    }
  };
  const updateOutlineItem = (index: number, title: string) => {
    const next = outlineDraft.map((item, itemIndex) => itemIndex === index ? { ...item, title } : item);
    setOutlineDraft(next);
    onOutlineChange?.(JSON.stringify(next));
  };
  const moveOutlineItem = (from: number, to: number) => {
    if (from === to || from < 0 || to < 0 || from >= outlineDraft.length || to >= outlineDraft.length) return;
    const next = [...outlineDraft];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setOutlineDraft(next);
    onOutlineChange?.(JSON.stringify(next));
  };
  useEffect(() => {
    const content = contentRef.current;
    if (!content) return;
    const updateScrollCue = () => setHasMoreBelow(content.scrollHeight - content.scrollTop - content.clientHeight > 24);
    updateScrollCue();
    content.addEventListener("scroll", updateScrollCue, { passive: true });
    const observer = new ResizeObserver(updateScrollCue);
    observer.observe(content);
    return () => {
      content.removeEventListener("scroll", updateScrollCue);
      observer.disconnect();
    };
  }, [phase, items.length, ops.length, draftReady]);
  return <section className="progressive-pptx-stage" data-testid="progressive-pptx-stage" data-phase={phase}>
    <header className="progressive-pptx-stage__header">
      <div><span className="progressive-pptx-stage__eyebrow"><Presentation size={14} /> {t("pptx.stage.eyebrow")}</span><h2>{heading}</h2><p>{description}</p></div>
    </header>
    <div className="progressive-pptx-stage__body">
      <nav className="progressive-pptx-stage__steps" aria-label={t("pptx.stage.stepsAria")}>
        {productionSteps.map((step, index) => {
          const phaseIndex = productionSteps.findIndex((item) => item.id === phase);
          const state = index < phaseIndex ? "is-done" : index === phaseIndex ? "is-current" : "";
          return <div className={`progressive-pptx-stage__step ${state}`} key={step.id}><span className="progressive-pptx-stage__step-dot">{index < phaseIndex ? <Check size={13} /> : index + 1}</span><span className="progressive-pptx-stage__step-copy"><strong>{t(step.labelKey)}</strong><small>{t(step.detailKey)}</small>{state === "is-current" ? <em>{t("pptx.stage.current")}</em> : null}</span></div>;
        })}
      </nav>
      <div className="progressive-pptx-stage__content">
      {hasMoreBelow ? <button type="button" className="progressive-pptx-stage__scroll-cue" aria-label={t("pptx.stage.scrollLatest")} title={t("pptx.stage.scrollLatest")} onClick={() => contentRef.current?.scrollTo({ top: contentRef.current.scrollHeight, behavior: "smooth" })}><ArrowDown size={18} /><span>{t("pptx.stage.viewLatest")}</span></button> : null}
      <div className="progressive-pptx-stage__content-scroll" ref={contentRef}>
    {(phase === "brief" || phase === "outline") ? <div className="progressive-pptx-stage__disclosure" data-testid="progressive-disclosure">
      <div className="progressive-pptx-stage__card"><div className="progressive-pptx-stage__card-title"><SquarePen size={16} /> {t("pptx.stage.stepLabel.brief")} <span>{processing ? t("pptx.stage.briefProcessing") : editableBrief ? t("pptx.stage.briefEditable") : t("pptx.stage.briefOverview")}</span></div><textarea aria-label={t("pptx.stage.briefAria")} value={brief} disabled={!editableBrief} onChange={(event) => onBriefChange?.(event.target.value)} /></div>
      {question && onQuestionAnswer && (question.options.length > 1 || question.allowFreeform) ? <div className="progressive-pptx-stage__question" data-testid="progressive-question">
        {question.options.length > 1 ? <div className="progressive-pptx-stage__question-options" aria-label={question.question}>{question.options.map((option) => <button type="button" key={option.id} className={selectedOptionId === option.id ? "is-selected" : ""} aria-pressed={selectedOptionId === option.id} disabled={actionBusy} onClick={() => { setSelectedOptionId(option.id); setCustomAnswer(""); }}><strong>{option.label}</strong>{option.description ? <small>{option.description}</small> : null}</button>)}</div> : null}
        {question.allowFreeform ? <input aria-label={t("documentWorkspace.customAnswer")} value={customAnswer} placeholder={t("documentWorkspace.customAnswerPlaceholder")} disabled={actionBusy} onChange={(event) => setCustomAnswer(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !actionBusy) void runAction(primaryAction); }} /> : null}
      </div> : null}
      {phase === "outline" || items.length > 0 ? <div className="progressive-pptx-stage__card progressive-pptx-stage__outline-card"><div className="progressive-pptx-stage__card-title"><Pencil size={16} /> {t("pptx.stage.stepLabel.outline")} <span>{outlineDraft.length ? t("pptx.stage.outlineEditable") : t("pptx.stage.outlineWaiting")}</span></div>{outlineDraft.length ? <><ol aria-label={t("pptx.stage.outlineAria")} className="progressive-pptx-stage__outline-scroll">{olderOutlineItems.map((item, index) => <li key={item.id} draggable onDragStart={() => setDraggedOutlineIndex(index)} onDragOver={(event) => event.preventDefault()} onDrop={() => { if (draggedOutlineIndex !== null) moveOutlineItem(draggedOutlineIndex, index); setDraggedOutlineIndex(null); }}><input aria-label={t("pptx.stage.sectionTitleAria", { section: index + 1 })} value={item.title} onChange={(event) => updateOutlineItem(index, event.target.value)} /><small>{item.detail}{item.estimatedSlides ? ` · ${item.estimatedSlides} ${t("pptx.stage.estimatedSlides")}` : ""}</small></li>)}</ol>{latestOutlineItem ? <div className="progressive-pptx-stage__latest-outline" draggable onDragStart={() => setDraggedOutlineIndex(outlineDraft.length - 1)}><span>{t("pptx.stage.latest")}</span><input aria-label={t("pptx.stage.sectionTitleAria", { section: outlineDraft.length })} value={latestOutlineItem.title} onChange={(event) => updateOutlineItem(outlineDraft.length - 1, event.target.value)} /><small>{latestOutlineItem.detail}{latestOutlineItem.estimatedSlides ? ` · ${latestOutlineItem.estimatedSlides} ${t("pptx.stage.estimatedSlides")}` : ""}</small></div> : null}</> : <p className="progressive-pptx-stage__muted">{t("pptx.stage.outlineWaiting")}</p>}</div> : null}
      {waitingForUser ? <div className="progressive-pptx-stage__action-footer" data-testid="progressive-stage-actions">
        <div className="progressive-pptx-stage__danger-actions">
          {onDeleteTask ? <button type="button" className="is-danger" disabled={actionBusy} onClick={() => void onDeleteTask()}>{t("pptx.stage.delete")}</button> : null}
        </div>
        <div className="progressive-pptx-stage__main-actions">
          {productionProps?.onCancel ? <button type="button" className="is-secondary" disabled={actionBusy} onClick={productionProps.onCancel}>{t("pptx.stage.cancel")}</button> : null}
          {primaryAction && (phase !== "outline" || items.length > 0) ? <button type="button" className="is-primary" disabled={actionBusy} onClick={() => void runAction(primaryAction)}><Play size={15} />{actionBusy ? t("pptx.stage.processing") : primaryLabel}</button> : null}
        </div>
      </div> : null}
      {processing ? <div className="progressive-pptx-stage__processing" role="status" aria-live="polite"><LoaderCircle className="progressive-pptx-stage__spin" size={18} /><div><strong>{processingLabel}</strong><span>{t("pptx.stage.autoUpdateHint")}</span></div>{productionProps?.onCancel ? <button type="button" onClick={productionProps.onCancel}>{t("pptx.stage.cancel")}</button> : null}</div> : null}
      {actionError ? <div className="progressive-pptx-stage__error" role="alert">{actionError}</div> : null}
    </div> : null}

    {phase === "draft" ? <div className="progressive-pptx-stage__draft" data-testid="draft-ready"><LoaderCircle className="progressive-pptx-stage__spin" size={19} /><strong>{t("pptx.stage.draftOpening")}</strong><span>{t("pptx.stage.draftOpeningDesc")}</span></div> : null}
    {showEditor && editor ? <div className="progressive-pptx-stage__editor" data-testid="progressive-editor"><PresentationEditorFrame {...editor} /></div> : null}
    {ops.length > 0 ? <div className="progressive-pptx-stage__ops" data-testid="op-stream" aria-label={t("pptx.stage.opStreamAria")}><strong>{t("pptx.stage.liveDrawing")}</strong><ol>{ops.map((entry, index) => <li key={`${entry.seq ?? "op"}-${index}`}><Check size={13} aria-hidden="true" /><span>{entry.op}</span>{entry.slide ? <small>{t("pptx.stage.slideNumber", { slide: entry.slide })}</small> : null}{entry.seq ? <em>#{entry.seq}</em> : null}</li>)}</ol></div> : null}
      {(phase === "drawing" || phase === "ready" || phase === "failed" || phase === "cancelled") ? <PptxProductionStage task={task} {...productionProps} /> : null}
      </div>
      </div>
    </div>
  </section>;
}
