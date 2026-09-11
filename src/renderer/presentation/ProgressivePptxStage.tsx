import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Bug, Check, Palette, Play, Sparkles } from "lucide-react";
import type { DesktopTask, TaskQuestionAnswer } from "../../shared/types";
import { PptxProductionStage, type PptxProductionStageProps } from "./PptxProductionStage";
import { PresentationEditorFrame, type PresentationEditorFrameProps } from "./PresentationEditorFrame";
import { useT } from "../i18n";
import { imageProgressFromOps } from "./pptxProgress";
import { Button, Input, TextArea } from "../ui";
import { pptxRuntimeActivity } from "./pptxRuntimeActivity";
import { usePptxFlowCopy } from "./pptxFlowCopy";
import { usePptxFlowDemo } from "./usePptxFlowDemo";
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
  onRefresh?: () => void | Promise<void>;
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
  if (task.status === "failed" || task.status === "cancelled") return task.status;
  const images = imageProgressFromOps(task.vibeOps ?? []);
  if (task.status === "completed") return images.pending > 0 && !task.vibeOps?.some(op => op.op === "deck.end") ? "drawing" : "ready";
  if (task.vibeSlides?.some(Boolean) || task.vibeOps?.length) return "drawing";
  const runtime = pptxRuntimeActivity(task);
  if (runtime.phase) return runtime.phase;
  if (draftReady) return "draft";
  if (task.plan || task.vibeTree || task.vibeOutline) return "outline";
  return "brief";
}

function visualDirection(task: DesktopTask): string | undefined {
  const outline = task.vibeOutline;
  const summary = [outline?.visualDirection, outline?.visual_direction, outline?.style, outline?.theme]
    .find((value): value is string => typeof value === "string" && Boolean(value.trim()));
  if (summary) return summary;
  return [...new Set((outline?.slides ?? []).flatMap(slide => [slide.form, slide.composition])
    .filter((value): value is string => typeof value === "string" && Boolean(value.trim())))].slice(0, 4).join(" · ") || undefined;
}

function previewText(value: unknown): string {
  if (typeof value !== "string") return "";
  // Runtime text may contain rich-text markup. Render only text, never HTML.
  return new DOMParser().parseFromString(value, "text/html").body.textContent?.trim() ?? "";
}

export function ProgressivePptxStage(props: ProgressivePptxStageProps) {
  const copy = usePptxFlowCopy();
  const demo = usePptxFlowDemo(props.task.id);
  return <div className="pptx-flow-host">
    {import.meta.env.DEV ? <div className="pptx-flow-debug">
      {demo.task ? <span>{copy("demo")}</span> : null}
      <Button size="small" onClick={demo.start} icon={<Bug size={14} />}>{copy("debug")}</Button>
      {demo.task ? <Button size="small" onClick={demo.stop}>{copy("exitDebug")}</Button> : null}
    </div> : null}
    {/* Keep the real editor/controller alive while inspecting an isolated demo. */}
    <div hidden={Boolean(demo.task)}><PptxFlowContent key={props.task.clientTaskId || props.task.id} {...props} /></div>
    {demo.task ? <PptxFlowContent key={demo.task.id} task={demo.task} draftReady={(demo.tick ?? 0) >= 11} demoTick={demo.tick ?? 0} /> : null}
  </div>;
}

function PptxFlowContent({ task, draftReady = false, editor, onBriefChange, onOutlineChange, onContinue, onStartDrawing, onQuestionAnswer, onDeleteTask, onRefresh, productionProps, demoTick }: ProgressivePptxStageProps & { demoTick?: number }) {
  const t = useT();
  const copy = usePptxFlowCopy();
  const phase = phaseFor(task, draftReady);
  const runtime = pptxRuntimeActivity(task);
  const [now, setNow] = useState(Date.now);
  const mountedAt = useRef(Date.now());
  const [checked, setChecked] = useState(false);
  const isDemo = demoTick !== undefined;
  const waiting = task.status === "question" || task.status === "plan_review";
  const processing = !waiting && (task.status === "starting" || task.status === "running" || phase === "drawing");
  useEffect(() => {
    if (!processing || isDemo) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [processing, isDemo]);
  const quietMs = Math.max(0, now - (runtime.timestamp ?? runtime.started ?? mountedAt.current));
  const delayed = processing && !isDemo && quietMs >= 120_000;
  const formatDuration = (ms: number) => `${Math.floor(Math.max(0, ms) / 60_000)}:${String(Math.floor(Math.max(0, ms) / 1000) % 60).padStart(2, "0")}`;
  const elapsedMs = runtime.started !== undefined ? now - runtime.started : runtime.elapsed > 0 ? runtime.elapsed + quietMs : now - mountedAt.current;
  const items = useMemo(() => outlineItems(task), [task.id, task.plan?.revision, task.plan?.markdown, task.vibeTree, task.vibeOutline]);
  const [outlineDraft, setOutlineDraft] = useState(items);
  // Some hosts omit the outline from later snapshots. Keep the story visible.
  useEffect(() => { if (items.length) setOutlineDraft(items); }, [items]);
  const [direction, setDirection] = useState<string>();
  const runtimeDirection = visualDirection(task);
  useEffect(() => { if (runtimeDirection) setDirection(runtimeDirection); }, [runtimeDirection]);
  const [demoStyle, setDemoStyle] = useState("natural");
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const [error, setError] = useState<string>();
  const [answer, setAnswer] = useState("");
  const [selected, setSelected] = useState<string>();
  const [dragged, setDragged] = useState<number | null>(null);
  const [following, setFollowing] = useState(true);
  const followRef = useRef(true);
  const contentRef = useRef<HTMLDivElement>(null);
  const latestRef = useRef<HTMLDivElement>(null);
  const question = task.status === "question" && phase === "brief" ? task.question : undefined;
  const defaultOption = question?.options.find(option => option.recommended) ?? question?.options[0];
  useEffect(() => { setAnswer(""); setSelected(defaultOption?.id); }, [question?.id, defaultOption?.id]);
  const brief = field(task, "prompt") ?? task.topic ?? t("pptx.stage.briefMissing");
  useLayoutEffect(() => {
    const textarea = contentRef.current?.querySelector<HTMLTextAreaElement>(".pptx-flow-request textarea");
    if (!textarea) return;
    const resize = () => { textarea.style.height = "auto"; textarea.style.height = `${textarea.scrollHeight}px`; };
    resize();
    let width = textarea.clientWidth;
    const observer = new ResizeObserver(() => {
      if (textarea.clientWidth !== width) { width = textarea.clientWidth; resize(); }
    });
    observer.observe(textarea);
    return () => observer.disconnect();
  }, [brief]);
  const canEdit = waiting && (phase === "brief" || phase === "outline") && !busy;
  const canEditOutline = phase === "outline" && waiting && !busy;
  const slides = task.vibeSlides ?? [];
  const readySlides = slides.flatMap((slide, index) => slide ? [{ slide, index }] : []);
  const showGeneration = draftReady || ["drawing", "ready", "failed", "cancelled"].includes(phase);
  const showOutline = phase === "outline" || outlineDraft.length > 0;
  const showDirection = Boolean(direction) || (isDemo && demoTick >= 8);
  const activeStep = !processing ? undefined : phase === "brief" ? "brief" : isDemo && demoTick >= 8 && demoTick < 11 ? "style" : showGeneration ? "drawing" : "outline";
  const images = imageProgressFromOps(task.vibeOps ?? []);
  const total = task.vibeOutline?.slides?.length;
  const progress = total && readySlides.length <= total ? readySlides.length / total : undefined;
  const heading = phase === "brief" ? t("pptx.stage.processingBrief") : phase === "outline" ? t("pptx.stage.processingOutline") : phase === "ready" ? t("pptx.stage.ready") : phase === "failed" ? t("pptx.stage.failed") : phase === "cancelled" ? t("pptx.stage.cancelled") : runtime.image ? copy("imageWorking") : runtime.phase === "drawing" ? copy("runtimeWorking") : copy("generate");

  const setFollow = (value: boolean) => { followRef.current = value; setFollowing(value); };
  const scrollLatest = () => {
    const content = contentRef.current;
    if (!content || content.closest("[hidden], [data-home-entry-transition]")) return;
    const behavior = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
    // The document workspace owns scrolling. There is no nested stage scroller.
    latestRef.current?.scrollIntoView?.({ block: "nearest", behavior });
  };
  const signature = `${phase}:${task.status}:${outlineDraft.map(item => `${item.id}:${item.title}`).join("|")}:${readySlides.length}:${direction ?? ""}:${demoTick ?? ""}`;
  useEffect(() => {
    if (!followRef.current) return;
    const frame = requestAnimationFrame(scrollLatest);
    return () => cancelAnimationFrame(frame);
  }, [signature]);
  useEffect(() => {
    const content = contentRef.current;
    if (!content) return;
    const wheel = (event: WheelEvent) => { if (event.deltaY < 0) setFollow(false); };
    const touch = () => setFollow(false);
    const key = (event: KeyboardEvent) => { if (["ArrowUp", "PageUp", "Home"].includes(event.key)) setFollow(false); };
    const scroller = content.closest(".document-workspace")?.parentElement ?? content;
    scroller.addEventListener("wheel", wheel as EventListener, { passive: true });
    scroller.addEventListener("touchstart", touch, { passive: true });
    scroller.addEventListener("keydown", key as EventListener);
    return () => {
      scroller.removeEventListener("wheel", wheel as EventListener);
      scroller.removeEventListener("touchstart", touch);
      scroller.removeEventListener("keydown", key as EventListener);
    };
  }, []);

  const updateOutline = (next: OutlineItem[]) => { setOutlineDraft(next); onOutlineChange?.(JSON.stringify(next)); };
  const move = (from: number, to: number) => {
    if (!canEditOutline || from === to || to < 0 || to >= outlineDraft.length) return;
    const next = [...outlineDraft];
    const [item] = next.splice(from, 1); next.splice(to, 0, item); updateOutline(next);
  };
  const primary = phase === "outline" ? onStartDrawing ?? onContinue : onContinue ?? onStartDrawing;
  const runAction = async () => {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError(undefined);
    try {
      if (question && onQuestionAnswer) {
        const option = question.options.find(item => item.id === selected) ?? defaultOption;
        const custom = answer.trim();
        await onQuestionAnswer({ questionId: question.id || "question", answer: custom || option?.label || "continue", ...(!custom && option ? { optionId: option.id } : {}), ...(question.currentIndex === undefined ? {} : { questionIndex: question.currentIndex }) });
      } else await primary?.(outlineDraft);
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { inFlight.current = false; setBusy(false); }
  };
  const actions = !isDemo && waiting && !showGeneration ? <div className="progressive-pptx-stage__action-footer" data-testid="progressive-stage-actions">
    {onDeleteTask ? <Button className="is-danger" disabled={busy} onClick={() => void onDeleteTask()}>{t("pptx.stage.delete")}</Button> : null}
    <div className="progressive-pptx-stage__main-actions">
      {productionProps?.onCancel ? <Button className="is-secondary" disabled={busy} onClick={productionProps.onCancel}>{t("pptx.stage.cancel")}</Button> : null}
      {(primary || (question && onQuestionAnswer)) && (phase !== "outline" || outlineDraft.length > 0) ? <Button className="is-primary" disabled={busy} onClick={() => void runAction()} icon={<Play size={14} />}>{busy ? t("pptx.stage.processing") : t(phase === "outline" ? "pptx.stage.confirmOutline" : "pptx.stage.confirmBrief")}</Button> : null}
    </div>
  </div> : null;
  const refreshStatus = async () => {
    if (!onRefresh || inFlight.current) return;
    inFlight.current = true; setBusy(true); setError(undefined); setChecked(false);
    try { await onRefresh(); setChecked(true); } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { inFlight.current = false; setBusy(false); }
  };
  const waitingPreview = <div className="pptx-flow-waiting-preview" aria-label={copy("previewPending")}>
    <div className="pptx-flow-preview-art" aria-hidden="true"><div className="pptx-flow-preview-sheet"><span /><i /><i /><div><b /><b /><b /></div></div><div className="pptx-flow-preview-orbit" /></div>
    <strong>{copy("previewPending")}</strong><p>{copy("previewHint")}</p>
    <div className="pptx-flow-next"><span>{copy("outlineNext")}</span><span>{copy("designNext")}</span><span>{copy("readyNext")}</span></div>
  </div>;
  const work = (label: string) => <div className={`pptx-flow-workspace ${delayed ? "is-delayed" : ""} ${readySlides.length === 0 && !editor ? "has-preview" : ""}`}>
    <div className="pptx-flow-workspace__status">
      <div className="pptx-flow-working" role="status" aria-live="polite"><Sparkles size={17} aria-hidden="true" /><div><strong>{delayed ? copy("delayed") : runtime.message || label}</strong><span>{delayed ? copy("delayedHint") : t("pptx.stage.autoUpdateHint")}</span><div className="pptx-flow-skeleton" aria-hidden="true"><i /><i /></div></div>{!delayed ? <span className="pptx-flow-dots" aria-hidden="true"><i /><i /><i /></span> : null}</div>
      {!isDemo ? <div className="pptx-flow-timing"><span>{copy("elapsed")} <b>{formatDuration(elapsedMs)}</b></span><span>{copy("lastUpdate")} <b>{quietMs < 1000 ? copy("justNow") : quietMs < 60_000 ? `${Math.floor(quietMs / 1000)}${copy("secondsAgo")}` : `${Math.floor(quietMs / 60_000)}${copy("minutesAgo")}`}</b></span></div> : null}
      {runtime.message ? <small className="pptx-flow-runtime-label">{copy("activity")}</small> : null}
      {onRefresh ? <div className="pptx-flow-refresh"><Button disabled={busy} onClick={() => void refreshStatus()}>{copy("refresh")}</Button>{checked ? <span role="status">{copy("refreshed")}</span> : null}</div> : null}
    </div>
    {readySlides.length === 0 && !editor ? waitingPreview : null}
  </div>;
  const stepHeader = (number: number, title: string, status: string, done: boolean) => <header className="pptx-flow-step__header"><span className={`pptx-flow-node ${done ? "is-done" : ""}`} aria-hidden="true">{done ? <Check size={13} /> : number}</span><h2>{title}</h2><span className="pptx-flow-status">{status}</span></header>;

  return <section className="progressive-pptx-stage" data-testid="progressive-pptx-stage" data-phase={phase} data-demo={isDemo || undefined} data-demo-style={demoStyle} data-delayed={delayed || undefined}>
    <div className="progressive-pptx-stage__content-scroll" ref={contentRef}>
      <div className="progressive-pptx-stage__disclosure" data-testid="progressive-disclosure">
        <div className="pptx-flow-request"><span>{copy("request")}</span><TextArea aria-label={t("pptx.stage.briefAria")} value={brief} readOnly={!canEdit || !onBriefChange} onChange={event => onBriefChange?.(event.target.value)} rows={2} onFocus={() => setFollow(false)} /></div>
        <div className="pptx-flow-lower">
        {phase === "brief" ? <section className={`pptx-flow-step ${activeStep === "brief" ? "is-active" : ""}`} aria-busy={activeStep === "brief"}>
          {stepHeader(1, processing ? heading : t("pptx.stage.brief"), processing ? t("pptx.stage.briefProcessing") : copy("waiting"), false)}
          {question && onQuestionAnswer ? <div className="progressive-pptx-stage__question" data-testid="progressive-question"><p>{question.question}</p>
            {question.options.length > 1 ? <div className="progressive-pptx-stage__question-options">{question.options.map(option => <Button key={option.id} className={selected === option.id ? "is-selected" : ""} aria-pressed={selected === option.id} disabled={busy} onClick={() => { setSelected(option.id); setAnswer(""); }}><strong>{option.label}</strong>{option.description ? <small>{option.description}</small> : null}</Button>)}</div> : null}
            {question.allowFreeform ? <Input aria-label={t("documentWorkspace.customAnswer")} placeholder={t("documentWorkspace.customAnswerPlaceholder")} value={answer} disabled={busy} onChange={event => setAnswer(event.target.value)} onFocus={() => setFollow(false)} onPressEnter={event => { if (!event.nativeEvent.isComposing) void runAction(); }} /> : null}
          </div> : null}
          {processing ? work(heading) : actions}
          {processing && productionProps?.onCancel ? <Button className="pptx-flow-cancel" onClick={productionProps.onCancel}>{t("pptx.stage.cancel")}</Button> : null}
        </section> : null}
        {showOutline ? <section className={`pptx-flow-step ${activeStep === "outline" ? "is-active" : ""}`} aria-busy={activeStep === "outline"} data-testid="pptx-flow-outline">
          {stepHeader(1, copy("outline"), activeStep === "outline" ? t("pptx.stage.processingOutline") : outlineDraft.length ? copy("outlineReady") : t("pptx.stage.outlineWaiting"), outlineDraft.length > 0 && (phase !== "outline" || waiting))}
          {outlineDraft.length ? <ol className="pptx-flow-outline" aria-label={t("pptx.stage.outlineAria")}>{outlineDraft.map((item, index) => <li key={item.id} className={activeStep === "outline" && index === outlineDraft.length - 1 ? "is-writing" : ""} draggable={canEditOutline} onDragStart={() => setDragged(index)} onDragEnd={() => setDragged(null)} onDragOver={event => { if (canEditOutline) event.preventDefault(); }} onDrop={() => { if (dragged !== null) move(dragged, index); setDragged(null); }}>
            <span className="pptx-flow-index">{String(index + 1).padStart(2, "0")}</span><div><Input aria-label={t("pptx.stage.sectionTitleAria", { section: index + 1 })} value={item.title} readOnly={!canEditOutline} onFocus={() => setFollow(false)} onChange={event => updateOutline(outlineDraft.map((old, i) => i === index ? { ...old, title: event.target.value } : old))} />{item.detail ? <small>{item.detail}</small> : null}</div>
            {canEditOutline ? <div className="pptx-flow-reorder"><Button size="small" ariaLabel={copy("moveUp")} disabled={index === 0} onClick={() => move(index, index - 1)} icon={<ArrowUp size={12} />} /><Button size="small" ariaLabel={copy("moveDown")} disabled={index === outlineDraft.length - 1} onClick={() => move(index, index + 1)} icon={<ArrowDown size={12} />} /></div> : null}
          </li>)}</ol> : <p>{t("pptx.stage.outlineWaiting")}</p>}
          {activeStep === "outline" ? work(t("pptx.stage.processingOutline")) : null}
          {phase === "outline" ? actions : null}
          {activeStep === "outline" && productionProps?.onCancel ? <Button className="pptx-flow-cancel" onClick={productionProps.onCancel}>{t("pptx.stage.cancel")}</Button> : null}
        </section> : null}
        {showDirection ? <section className={`pptx-flow-step ${activeStep === "style" ? "is-active" : ""}`} aria-busy={activeStep === "style"} data-testid="pptx-flow-style">
          {stepHeader(2, copy("direction"), activeStep === "style" ? copy("styleDemo") : direction ? copy("directionReady") : "", Boolean(direction) && activeStep !== "style")}
          {isDemo ? <div className="pptx-flow-styles">{(["minimal", "dark", "natural"] as const).map(style => <Button className={`pptx-flow-style ${demoStyle === style ? "is-selected" : ""}`} key={style} aria-pressed={demoStyle === style} onClick={() => setDemoStyle(style)}><div className={`pptx-flow-style__sample is-${style}`}><strong>{copy("demoTitle")}</strong><small>OfficeDex</small></div><span>{copy(style)}</span></Button>)}</div> : <div className="pptx-flow-direction"><Palette size={19} aria-hidden="true" /><p>{direction || copy("directionPending")}</p></div>}
          <p className="pptx-flow-hint">{copy("directionAuto")}</p>
        </section> : null}
        {showGeneration ? <section className={`pptx-flow-step ${activeStep === "drawing" ? "is-active" : ""}`} aria-busy={activeStep === "drawing"} data-testid="pptx-flow-generation">
          {stepHeader(3, heading, readySlides.length ? `${readySlides.length}${total ? ` / ${total}` : ""} ${t("ui.text.slidesready")}` : "", phase === "ready")}
          {progress !== undefined ? <div className="pptx-flow-progress" role="progressbar" aria-label={t("ui.text.Slideprogress")} aria-valuemin={0} aria-valuemax={total} aria-valuenow={readySlides.length}><span style={{ width: `${progress * 100}%` }} /></div> : null}
          {phase === "draft" ? <div data-testid="draft-ready">{work(t("pptx.stage.draftOpening"))}</div> : null}
          <div className="pptx-flow-pages">{readySlides.map(({ slide, index }) => {
            const texts = slide.elements.flatMap(element => { const record = element && typeof element === "object" ? element as Record<string, unknown> : {}; const text = previewText(record.content ?? record.text); return text ? [text] : []; });
            return <article className={`pptx-flow-page ${isDemo ? "is-demo" : ""}`} key={`${index}-${slide.id}`} data-testid={`pptx-flow-page-${index + 1}`}><div className="pptx-flow-page__canvas"><small>{isDemo ? "OfficeDex" : t("pptx.stage.slideNumber", { slide: index + 1 })}</small><h3>{texts[0] || outlineDraft[index]?.title || copy("contentPending")}</h3>{texts.slice(1, 5).map((text, i) => <p key={i}>{text}</p>)}</div><footer><span>{String(index + 1).padStart(2, "0")}</span><span>{isDemo ? copy("demo") : copy("contentPreview")}</span></footer></article>;
          })}</div>
          {activeStep === "drawing" && phase !== "draft" ? work(images.pending > 0 ? t("ui.text.Pagesarereadywhilecountimagesarestillgenerating", { count: images.pending }) : copy("preparing")) : null}
          {editor ? <div className="progressive-pptx-stage__editor" data-testid="progressive-editor"><PresentationEditorFrame {...editor} /></div> : null}
          {!isDemo ? <PptxProductionStage task={task} {...productionProps} compact /> : phase === "ready" ? <p className="pptx-flow-complete"><Check size={16} />{copy("demoDone")}</p> : null}
          {import.meta.env.DEV && task.vibeOps?.length ? <details className="pptx-flow-details"><summary>{copy("details")}</summary><ol data-testid="op-stream">{task.vibeOps.slice(-10).map((op, index) => <li key={`${op.seq}-${index}`}>{op.op}{op.slide ? ` · ${t("pptx.stage.slideNumber", { slide: op.slide })}` : ""} {op.seq ? `#${op.seq}` : ""}</li>)}</ol></details> : null}
        </section> : null}
        {error ? <div role="alert" className="progressive-pptx-stage__error">{error}</div> : null}
        <div ref={latestRef} className="pptx-flow-latest" />
        </div>
      </div>
    </div>
    {showGeneration && (readySlides.length > 0 || editor) ? <Button className="pptx-flow-follow" size="small" aria-pressed={following} onClick={() => { setFollow(!following); if (!following) scrollLatest(); }} icon={<ArrowDown size={14} />}>{copy(following ? "following" : "follow")}</Button> : null}
  </section>;
}
