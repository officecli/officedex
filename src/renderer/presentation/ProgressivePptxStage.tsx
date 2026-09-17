import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { ArrowDown, ArrowUp, Bug, Check, Palette, Play, Sparkles } from "lucide-react";
import type { DesktopTask, TaskQuestionAnswer } from "../../shared/types";
import { PptxProductionStage, type PptxProductionStageProps } from "./PptxProductionStage";
import { PresentationEditorFrame, type PresentationEditorFrameProps } from "./PresentationEditorFrame";
import { useT } from "../i18n";
import { imageProgressFromOps } from "./pptxProgress";
import { pptxDeckStillDrawing } from "./pptxDeckState";
import { Button, Input, TextArea } from "../ui";
import { pptxContentPreviews, pptxPageStates, pptxRuntimeActivity } from "./pptxRuntimeActivity";
import { usePptxFlowCopy } from "./pptxFlowCopy";
import { usePptxFlowDemo } from "./usePptxFlowDemo";
import { usePptxBottomFollow } from "./usePptxBottomFollow";
import { PptxFailurePanel } from "./PptxFailurePanel";
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
  onRetryFailed?: (checkpoint: string) => Promise<void>;
  onSkipResearch?: () => Promise<void>;
  onCheckStatus?: () => Promise<void>;
  onRefresh?: () => void | Promise<void>;
  onDeleteTask?: () => void | Promise<void>;
  productionProps?: Omit<PptxProductionStageProps, "task">;
}

type OutlineItem = { id: string; title: string; detail?: string; estimatedSlides?: number; slide?: number };

/**
 * The elapsed/last-activity pair is noise before the run is old enough for the
 * numbers to mean anything: at six seconds both read "0:06" and "just now",
 * which is two more things to read on a screen whose only news is one line.
 */
const TIMING_VISIBLE_MS = 30_000;

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
  if (task.status === "completed") return pptxDeckStillDrawing(task) ? "drawing" : "ready";
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

/**
 * The runtime reports what it is actually doing through `step`; the card used to
 * take its title from the view's own phase instead, so a deck being
 * access-checked was announced as "understanding your direction". These buckets
 * follow the pipeline's real stages so the title and the progress line under it
 * agree with each other.
 */
function stepHeadingKey(step: string | undefined): string | undefined {
  if (!step) return undefined;
  if (step === "plan.research") return "pptx.stage.stepHeading.research";
  if (step.startsWith("plan.outline") || step === "plan.style") return "pptx.stage.stepHeading.structure";
  if (step === "plan.expand" || step === "generate" || step === "generate_llm") return "pptx.stage.stepHeading.write";
  if (step.startsWith("skill.") || step === "assemble" || step === "render") return "pptx.stage.stepHeading.draw";
  if (step === "export" || step === "write_file" || step === "publish" || step === "finalize") return "pptx.stage.stepHeading.export";
  if (step === "license" || step === "plan_prepare") return "pptx.stage.stepHeading.prepare";
  return undefined;
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

function PptxFlowContent({ task, draftReady = false, editor, onBriefChange, onOutlineChange, onContinue, onStartDrawing, onQuestionAnswer, onDeleteTask, onRefresh, onCheckStatus, onSkipResearch, onRetryFailed, productionProps, demoTick }: ProgressivePptxStageProps & { demoTick?: number }) {
  const t = useT();
  const copy = usePptxFlowCopy();
  const phase = phaseFor(task, draftReady);
  const runtime = pptxRuntimeActivity(task);
  const contentPreviews = pptxContentPreviews(task);
  const pageStates = pptxPageStates(task);
  const recoveryPath = [...task.events].reverse().find(event => typeof event.payload?.resume_checkpoint === "string" && event.payload.resume_checkpoint)?.payload?.resume_checkpoint as string | undefined;
  const [now, setNow] = useState(Date.now);
  const mountedAt = useRef(Date.now());
  const isDemo = demoTick !== undefined;
  const waiting = task.status === "question" || task.status === "plan_review";
  const processing = !waiting && (task.status === "starting" || task.status === "running");
  useEffect(() => {
    if (!processing || isDemo) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [processing, isDemo]);
  const quietMs = Math.max(0, now - (runtime.timestamp ?? runtime.started ?? mountedAt.current));
  const backendAlive = runtime.heartbeatAt !== undefined && now - runtime.heartbeatAt < 15_000;
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
  const refreshRef = useRef(onCheckStatus ?? onRefresh);
  refreshRef.current = onCheckStatus ?? onRefresh;
  const activityRef = useRef(runtime);
  activityRef.current = runtime;
  // A task that still carries its own client id has not been promoted yet: the
  // bridge has never heard of that id, so a status lookup can only fail. Asking
  // anyway painted "unable to confirm background status" over the first seconds
  // of every run — the one moment the user has least reason to doubt the app.
  const awaitingServerId = Boolean(task.clientTaskId && task.id === task.clientTaskId);
  useEffect(() => {
    if (!processing || isDemo || awaitingServerId || (!onCheckStatus && !onRefresh)) return;
    let pending = false;
    const timer = window.setInterval(async () => {
      const activity = activityRef.current;
      const lastSeen = Math.max(activity.heartbeatAt ?? 0, activity.timestamp ?? 0, activity.started ?? mountedAt.current);
      if ((!onCheckStatus && Date.now() - lastSeen < 30_000) || pending || inFlight.current) return;
      pending = true;
      try {
        await refreshRef.current?.();
      } catch {
        // A missed probe is not news: the next tick asks again.
      }
      finally { pending = false; }
    }, onCheckStatus ? 3000 : 30_000);
    return () => window.clearInterval(timer);
  }, [processing, isDemo, awaitingServerId, task.id, Boolean(onRefresh), Boolean(onCheckStatus)]);
  const [answer, setAnswer] = useState("");
  const [selected, setSelected] = useState<string>();
  const [dragged, setDragged] = useState<number | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const actionsRef = useRef<HTMLDivElement>(null);
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
  // A stopped run is over: nothing more will arrive, so the stage drops the
  // follow-latest affordance and hands the screen to the failure panel instead
  // of leaving controls that only made sense while work was in flight.
  const terminal = phase === "failed" || phase === "cancelled";
  const showOutline = phase === "outline" || outlineDraft.length > 0;
  const showDirection = Boolean(direction) || (isDemo && demoTick >= 8);
  const activeStep = !processing ? undefined : phase === "brief" ? "brief" : isDemo && demoTick >= 8 && demoTick < 11 ? "style" : showGeneration ? "drawing" : "outline";
  const images = imageProgressFromOps(task.vibeOps ?? []);
  const total = task.vibeOutline?.slides?.length;
  const progress = total && readySlides.length <= total ? readySlides.length / total : undefined;
  const stepHeading = stepHeadingKey(runtime.step);
  const heading = phase === "ready" ? t("pptx.stage.ready") : phase === "failed" ? t("pptx.stage.failed") : phase === "cancelled" ? t("pptx.stage.cancelled") : runtime.image ? copy("imageWorking") : stepHeading ? t(stepHeading) : phase === "brief" ? t("pptx.stage.processingBrief") : phase === "outline" ? t("pptx.stage.processingOutline") : runtime.phase === "drawing" ? copy("runtimeWorking") : copy("generate");

  const signature = `${phase}:${task.status}:${outlineDraft.map(item => `${item.id}:${item.title}`).join("|")}:${readySlides.length}:${direction ?? ""}:${demoTick ?? ""}:${runtime.timestamp ?? ""}:${runtime.message ?? ""}:${task.vibeOps?.length ?? 0}`;
  const { following, setFollow, scrollLatest } = usePptxBottomFollow(contentRef, signature);

  /**
   * The action bar is sticky at the bottom of the scroller, so anything that has
   * to clear it needs its real height. Guessing that number is what put the
   * follow pill in the middle of the reading column.
   */
  const [actionsHeight, setActionsHeight] = useState(0);
  useEffect(() => {
    const element = actionsRef.current;
    if (!element) return;
    const measure = () => setActionsHeight(Math.round(element.getBoundingClientRect().height));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [showGeneration, isDemo]);

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
  // Every action the stopped-run panel offers goes through the same guard, so a
  // double click cannot start two runs and a rejected action surfaces in the
  // stage instead of vanishing.
  const runTerminalAction = (run: () => void | Promise<void>) => {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError(undefined);
    void Promise.resolve(run()).catch(reason => setError(reason instanceof Error ? reason.message : String(reason))).finally(() => { inFlight.current = false; setBusy(false); });
  };
  // The three-stage roadmap is a position, not a paragraph: one dot per stage
  // with only the current one named, instead of three labels and two carets
  // competing with the status line right next to them.
  const railLabels = [copy("outlineNext"), copy("designNext"), copy("readyNext")];
  // The rail only exists while the deck is being produced: the completed state
  // replaces this whole block, so the last stage is never the current one here.
  const railIndex = showGeneration ? 1 : 0;
  const waitingPreview = <div className="pptx-flow-waiting-preview" aria-label={copy("previewPending")}>
    <div className="pptx-flow-preview-art" aria-hidden="true"><div className="pptx-flow-preview-sheet"><span /><i /><i /><div><b /><b /><b /></div></div><div className="pptx-flow-preview-orbit" /></div>
    <strong>{copy("previewPending")}</strong>
    <div className="pptx-flow-rail" data-testid="pptx-flow-rail" data-stage={railIndex}>{railLabels.map((label, index) => <span key={label} className={index < railIndex ? "is-done" : index === railIndex ? "is-current" : ""}><i aria-hidden="true" />{index === railIndex ? label : ""}</span>)}</div>
  </div>;
  // The primary line is ours and always localized; the runtime's own sentence —
  // engine text, English regardless of locale — sits underneath it as detail.
  // Rendering the sentence on top made the loudest line on a Chinese screen
  // English, and duplicated the step heading whenever no sentence had arrived.
  const work = (label: string) => <div className={`pptx-flow-workspace ${delayed ? "is-delayed" : ""} ${readySlides.length === 0 && !editor ? "has-preview" : ""}`}>
    <div className="pptx-flow-workspace__status">
      <div className="pptx-flow-working" role="status" aria-live="polite"><Sparkles size={17} aria-hidden="true" /><div><strong>{delayed ? copy("delayed") : label}</strong>{delayed ? <span>{backendAlive ? copy("stillProcessing") : copy("delayedHint")}</span> : runtime.message ? <span className="pptx-flow-runtime-detail">{runtime.message}</span> : null}<div className="pptx-flow-skeleton" aria-hidden="true"><i /><i /></div></div>{!delayed ? <span className="pptx-flow-dots" aria-hidden="true"><i /><i /><i /></span> : null}</div>
      {!isDemo && elapsedMs >= TIMING_VISIBLE_MS ? <div className="pptx-flow-timing"><span>{copy("elapsed")} <b>{formatDuration(elapsedMs)}</b></span><span>{copy("lastUpdate")} <b>{quietMs < 1000 ? copy("justNow") : quietMs < 60_000 ? `${Math.floor(quietMs / 1000)}${copy("secondsAgo")}` : `${Math.floor(quietMs / 60_000)}${copy("minutesAgo")}`}</b></span></div> : null}
      {processing && runtime.step === "plan.research" && onSkipResearch ? <Button disabled={busy} onClick={() => { if (inFlight.current) return; inFlight.current = true; setBusy(true); void onSkipResearch().catch(reason => setError(String(reason))).finally(() => { inFlight.current = false; setBusy(false); }); }}>{copy("skipResearch")}</Button> : null}
    </div>
    {readySlides.length === 0 && !editor ? waitingPreview : null}
  </div>;
  const stepHeader = (number: number, title: string, status: string, done: boolean) => <header className="pptx-flow-step__header"><span className={`pptx-flow-node ${done ? "is-done" : ""}`} aria-hidden="true">{done ? <Check size={13} /> : number}</span><h2>{title}</h2><span className="pptx-flow-status">{status}</span></header>;

  return <section className="progressive-pptx-stage" data-testid="progressive-pptx-stage" data-phase={phase} data-demo={isDemo || undefined} data-demo-style={demoStyle} data-delayed={delayed || undefined} data-generation={showGeneration ? "true" : undefined} style={{ "--pptx-actions-h": `${actionsHeight}px` } as CSSProperties}>
    <div className="progressive-pptx-stage__content-scroll" ref={contentRef}>
      <div className="progressive-pptx-stage__disclosure" data-testid="progressive-disclosure">
        <div className="pptx-flow-request"><span>{copy("request")}</span><TextArea aria-label={t("pptx.stage.briefAria")} value={brief} readOnly={!canEdit || !onBriefChange} onChange={event => onBriefChange?.(event.target.value)} rows={2} onFocus={() => setFollow(false)} /></div>
        <div className="pptx-flow-lower">
        {phase === "brief" ? <section className={`pptx-flow-step ${activeStep === "brief" ? "is-active" : ""}`} aria-busy={activeStep === "brief"}>
          {stepHeader(1, processing ? heading : t("pptx.stage.brief"), processing ? "" : copy("waiting"), false)}
          {question && onQuestionAnswer ? <div className="progressive-pptx-stage__question" data-testid="progressive-question"><p>{question.question}</p>
            {question.options.length > 1 ? <div className="progressive-pptx-stage__question-options">{question.options.map(option => <Button key={option.id} className={selected === option.id ? "is-selected" : ""} aria-pressed={selected === option.id} disabled={busy} onClick={() => { setSelected(option.id); setAnswer(""); }}><strong>{option.label}</strong>{option.description ? <small>{option.description}</small> : null}</Button>)}</div> : null}
            {question.allowFreeform ? <Input aria-label={t("documentWorkspace.customAnswer")} placeholder={t("documentWorkspace.customAnswerPlaceholder")} value={answer} disabled={busy} onChange={event => setAnswer(event.target.value)} onFocus={() => setFollow(false)} onPressEnter={event => { if (!event.nativeEvent.isComposing) void runAction(); }} /> : null}
          </div> : null}
          {processing ? work(t("pptx.stage.processingBriefDesc")) : actions}
          {processing && productionProps?.onCancel ? <Button className="pptx-flow-cancel" onClick={productionProps.onCancel}>{t("pptx.stage.cancel")}</Button> : null}
        </section> : null}
        {showOutline ? <section className={`pptx-flow-step ${activeStep === "outline" ? "is-active" : ""}`} aria-busy={activeStep === "outline"} data-testid="pptx-flow-outline">
          {stepHeader(1, copy("outline"), activeStep === "outline" ? t("pptx.stage.processingOutline") : outlineDraft.length ? copy("outlineReady") : t("pptx.stage.outlineWaiting"), outlineDraft.length > 0 && (phase !== "outline" || waiting))}
          {outlineDraft.length ? <ol className="pptx-flow-outline" aria-label={t("pptx.stage.outlineAria")}>{outlineDraft.map((item, index) => <li key={item.id} className={activeStep === "outline" && index === outlineDraft.length - 1 ? "is-writing" : ""} draggable={canEditOutline} onDragStart={() => setDragged(index)} onDragEnd={() => setDragged(null)} onDragOver={event => { if (canEditOutline) event.preventDefault(); }} onDrop={() => { if (dragged !== null) move(dragged, index); setDragged(null); }}>
            <span className="pptx-flow-index">{String(index + 1).padStart(2, "0")}</span><div><Input aria-label={t("pptx.stage.sectionTitleAria", { section: index + 1 })} value={item.title} readOnly={!canEditOutline} onFocus={() => setFollow(false)} onChange={event => updateOutline(outlineDraft.map((old, i) => i === index ? { ...old, title: event.target.value } : old))} />{item.detail ? <small>{item.detail}</small> : null}{/* Always rendered, so a page's status word arriving does not make the row taller and shove everything below it up the screen. */}<small className="pptx-flow-outline__state" data-state={pageStates.get(item.slide ?? index + 1) ?? "none"}>{pageStates.has(item.slide ?? index + 1) ? copy(pageStates.get(item.slide ?? index + 1)!) : ""}</small></div>
            {canEditOutline ? <div className="pptx-flow-reorder"><Button size="small" ariaLabel={copy("moveUp")} disabled={index === 0} onClick={() => move(index, index - 1)} icon={<ArrowUp size={12} />} /><Button size="small" ariaLabel={copy("moveDown")} disabled={index === outlineDraft.length - 1} onClick={() => move(index, index + 1)} icon={<ArrowDown size={12} />} /></div> : null}
          </li>)}</ol> : <p>{t("pptx.stage.outlineWaiting")}</p>}
          {activeStep === "outline" ? work(t("pptx.stage.processingOutlineDesc")) : null}
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
          {terminal ? (
            <PptxFailurePanel
              task={task}
              busy={busy}
              resumeCheckpoint={task.failure?.resume_checkpoint ?? recoveryPath}
              onResume={onRetryFailed ? (checkpoint) => runTerminalAction(() => onRetryFailed(checkpoint)) : undefined}
              onOpenPartial={productionProps?.onOpenEditor ? () => runTerminalAction(() => productionProps.onOpenEditor!()) : undefined}
              onRestart={productionProps?.onRetry ? () => runTerminalAction(() => productionProps.onRetry!()) : undefined}
            />
          ) : null}
          {contentPreviews.length ? <div data-testid="pptx-content-previews"><p>{copy("contentReady")} {contentPreviews.length}{total ? ` / ${total}` : ""}</p><div className="pptx-flow-pages">{contentPreviews.filter(page => !slides[page.slide - 1]).map(page => <article className="pptx-flow-page" key={page.slide} data-testid={`pptx-content-page-${page.slide}`}><div className="pptx-flow-page__canvas"><small>{t("pptx.stage.slideNumber", { slide: page.slide })}</small><h3>{page.headline}</h3><p>{page.takeaway}</p><details><summary>{copy("viewContent")}</summary>{page.details.map((text, index) => <p key={index}>{text}</p>)}</details></div><footer>{copy("contentPreview")}</footer></article>)}</div></div> : null}
          <div className="pptx-flow-pages">{readySlides.map(({ slide, index }) => {
            const texts = slide.elements.flatMap(element => { const record = element && typeof element === "object" ? element as Record<string, unknown> : {}; const text = previewText(record.content ?? record.text); return text ? [text] : []; });
            return <article className={`pptx-flow-page ${isDemo ? "is-demo" : ""}`} key={`${index}-${slide.id}`} data-testid={`pptx-flow-page-${index + 1}`}><div className="pptx-flow-page__canvas"><small>{isDemo ? "OfficeDex" : t("pptx.stage.slideNumber", { slide: index + 1 })}</small><h3>{texts[0] || outlineDraft[index]?.title || copy("contentPending")}</h3>{texts.slice(1, 5).map((text, i) => <p key={i}>{text}</p>)}</div><footer><span>{String(index + 1).padStart(2, "0")}</span><span>{isDemo ? copy("demo") : copy("contentPreview")}</span></footer></article>;
          })}</div>
          {activeStep === "drawing" && phase !== "draft" ? work(images.pending > 0 ? t("ui.text.Pagesarereadywhilecountimagesarestillgenerating", { count: images.pending }) : copy("preparing")) : null}
          {editor ? <div className="progressive-pptx-stage__editor" data-testid="progressive-editor"><PresentationEditorFrame {...editor} /></div> : null}
          {isDemo && phase === "ready" ? <p className="pptx-flow-complete"><Check size={16} />{copy("demoDone")}</p> : null}
          {import.meta.env.DEV && task.vibeOps?.length ? <details className="pptx-flow-details"><summary>{copy("details")}</summary><ol data-testid="op-stream">{task.vibeOps.slice(-10).map((op, index) => <li key={`${op.seq}-${index}`}>{op.op}{op.slide ? ` · ${t("pptx.stage.slideNumber", { slide: op.slide })}` : ""} {op.seq ? `#${op.seq}` : ""}</li>)}</ol></details> : null}
        </section> : null}
        {error ? <div role="alert" className="progressive-pptx-stage__error">{error}</div> : null}
        <div className="pptx-flow-latest" />
        </div>
      </div>
      {/* The action bar lives outside the step, one level below the disclosure.
          Sticky is bounded by the containing block, so inside the generation step
          it could only pin while that one screen was in view — reading an earlier
          step made the main actions disappear. Out here its containing block is
          the whole scroller, which is what "always at the bottom" requires. */}
      {!isDemo && showGeneration ? (
        <div className="pptx-flow-actions" data-testid="pptx-flow-actions" ref={actionsRef}>
          <PptxProductionStage task={task} {...productionProps} compact />
        </div>
      ) : null}
    </div>
    {!terminal && (showGeneration || !following) ? <Button className="pptx-flow-follow" size="small" aria-pressed={following} onClick={() => { setFollow(!following); if (!following) scrollLatest(); }} icon={<ArrowDown size={14} />}>{copy(following ? "following" : "follow")}</Button> : null}
  </section>;
}
