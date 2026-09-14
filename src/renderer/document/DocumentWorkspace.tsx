import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { Artifact, DesktopTask, TaskQuestionAnswer } from "../../shared/types";
import { getCapability } from "../../shared/types";
import { useT } from "../i18n";
import { QuickReplyQuestion } from "../components/QuickReplyQuestion";
import { ArrowUpOutlined } from "../ui/icons";
import "./documentWorkspace.css";
import { taskTitle } from "../taskTitle";
import { playHomeEntryTransition, type HomeEntryTransition } from "../homeEntryTransition";

export type DocumentWorkspaceArtifactAction = "open" | "copy" | "locate";

export interface DocumentWorkspaceProps {
  readonly entryTransition?: HomeEntryTransition;
  readonly task: DesktopTask;
  readonly artifact?: Artifact | null;
  /** Optional preview/editor supplied by a document-type adapter. */
  readonly preview?: ReactNode;
  /** PPT adapters can mount ProgressivePptxStage through this slot. */
  readonly pptxStage?: ReactNode;
  readonly onAnswer?: (answer: TaskQuestionAnswer) => void | Promise<void>;
  readonly onApprovePlan?: () => void | Promise<void>;
  readonly onCancel?: () => void | Promise<void>;
  readonly onRetry?: () => void | Promise<void>;
  readonly onContinue?: () => void | Promise<void>;
  readonly onArtifactAction?: (action: DocumentWorkspaceArtifactAction, artifact: Artifact) => void | Promise<void>;
  readonly onContinueEditing?: (instruction: string) => void | Promise<void>;
  readonly className?: string;
}

type Translator = (key: string, vars?: Record<string, string | number>) => string;

function documentTitle(task: DesktopTask, artifact: Artifact | null | undefined, t: Translator): string {
  // "Untitled presentation" beats "Untitled document" for a deck: the generic
  // label made the header read as the wrong kind of file.
  const type = (artifact?.documentType || task.documentType || "").toLowerCase();
  const key = type === "report" ? "docx" : type === "gif" ? "img" : type;
  return taskTitle(task, t(UNTITLED_KEYS[key] ?? "documentWorkspace.untitled"), artifact?.fileName);
}

const UNTITLED_KEYS: Record<string, string> = {
  pptx: "documentWorkspace.untitled.pptx",
  xlsx: "documentWorkspace.untitled.xlsx",
  docx: "documentWorkspace.untitled.docx",
  img: "documentWorkspace.untitled.img",
};

// i18n key per document type; anything unknown reads as a document (docx),
// which is what the chain of ternaries this replaces fell through to.
const TYPE_LABEL_KEYS: Record<string, string> = {
  pptx: "documentWorkspace.type.pptx",
  xlsx: "documentWorkspace.type.xlsx",
  img: "documentWorkspace.type.img",
  image: "documentWorkspace.type.img",
  docx: "documentWorkspace.type.docx",
};

function typeLabel(type: string | undefined, t: Translator): string {
  const value = type?.toLowerCase() ?? "";
  if (value === "gif") return getCapability("gif").label;
  return t(TYPE_LABEL_KEYS[value] ?? TYPE_LABEL_KEYS.docx);
}

export function DocumentWorkspace({ task, artifact = task.artifact, preview, pptxStage, onAnswer, onApprovePlan, onCancel, onRetry, onContinue, onArtifactAction, onContinueEditing, className, entryTransition }: DocumentWorkspaceProps) {
  const t = useT();
  const hostRef = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    let stop: (() => void) | undefined;
    const host = hostRef.current;
    if (host && entryTransition && !entryTransition.consumed) host.dataset.homeEntryTransition = "pending";
    const frame = requestAnimationFrame(() => {
      if (hostRef.current) stop = playHomeEntryTransition(hostRef.current, entryTransition);
    });
    return () => { cancelAnimationFrame(frame); stop?.(); if (host) delete host.dataset.homeEntryTransition; };
  }, [entryTransition]);
  const [freeform, setFreeform] = useState("");
  const [busy, setBusy] = useState(false);
  const [selectedOptionId, setSelectedOptionId] = useState<string>();
  const question = task.question;
  useEffect(() => { setSelectedOptionId(undefined); setFreeform(""); }, [question?.id, question?.currentIndex]);
  const run = async (action: (() => void | Promise<void>) | undefined) => {
    if (!action || busy) return;
    setBusy(true);
    try { await action(); } finally { setBusy(false); }
  };
  const answer = (answerValue: string, optionId?: string) => run(() => onAnswer?.({ questionId: question?.id || "question", answer: answerValue, optionId, questionIndex: question?.currentIndex }));
  const submitFreeform = () => { if (freeform.trim()) { setSelectedOptionId(undefined); void answer(freeform.trim()); } };
  const selectOption = (optionId: string) => {
    const option = question?.options.find((item) => item.id === optionId);
    if (!option) return;
    setSelectedOptionId(optionId);
    void answer(option.label, optionId);
  };
  const showPptx = task.documentType?.toLowerCase() === "pptx" && pptxStage;
  const visibleArtifact = artifact || task.artifact;
  const statusCopy = t(`documentWorkspace.status.${task.status}`);

  return <main ref={hostRef} className={["document-workspace", showPptx ? "document-workspace--pptx" : "", className].filter(Boolean).join(" ")} aria-label={t("ui.copy.Documentworkspace")}>
    <header className="document-workspace__header">
      <div><span className="document-workspace__type">{typeLabel(task.documentType, t)}</span><h1>{documentTitle(task, visibleArtifact, t)}</h1></div>
      <span className={`document-workspace__status document-workspace__status--${task.status}`} role="status">{statusCopy}</span>
    </header>
    <section className="document-workspace__body">
      {showPptx ? <div className="document-workspace__stage">{pptxStage}</div> : preview ? <div className="document-workspace__preview">{preview}</div> : visibleArtifact ? <div className="document-workspace__artifact-preview" aria-label={t("documentWorkspace.artifactPreview")}><div className="document-workspace__artifact-icon">{typeLabel(task.documentType, t).slice(0, 1)}</div><strong>{visibleArtifact.fileName}</strong></div> : <div className="document-workspace__empty">{t("documentWorkspace.empty")}</div>}
      {!showPptx ? <div className="document-workspace__status-panel">
        {(task.status === "starting" || task.status === "running") ? <><h2>{statusCopy}</h2><p>{t("documentWorkspace.progressHint")}</p><button type="button" onClick={() => void run(onCancel)} disabled={!onCancel || busy}>{t("documentWorkspace.cancel")}</button></> : null}
        {task.status === "question" && question ? <div className="document-workspace__question">
          <QuickReplyQuestion key={`${question.id}:${question.currentIndex ?? 0}`} question={question.question} options={question.options} selectedOptionId={selectedOptionId} freeformDraft={freeform} allowFreeform={question.allowFreeform} responding={busy} onSelect={selectOption} />
          {question.allowFreeform ? <div className="document-workspace__freeform"><input aria-label={t("documentWorkspace.customAnswer")} value={freeform} placeholder={t("documentWorkspace.customAnswerPlaceholder")} disabled={busy} onChange={(event) => setFreeform(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") submitFreeform(); }} /><button type="button" onClick={submitFreeform} disabled={!freeform.trim() || busy}>{t("documentWorkspace.submit")}</button></div> : null}
        </div> : null}
        {task.status === "plan_review" ? <div className="document-workspace__plan"><span className="document-workspace__eyebrow">{t("documentWorkspace.planReview")}</span><h2>{t("documentWorkspace.planTitle")}</h2><pre>{task.plan?.markdown || t("documentWorkspace.planFallback")}</pre><button type="button" onClick={() => void run(onApprovePlan)} disabled={!onApprovePlan || busy}>{t("documentWorkspace.continue")}</button></div> : null}
        {task.status === "failed" ? <div><h2>{t("documentWorkspace.failedTitle")}</h2><p role="alert">{task.error || t("documentWorkspace.failedFallback")}</p><button type="button" onClick={() => void run(onRetry)} disabled={!onRetry || busy}>{t("documentWorkspace.retry")}</button></div> : null}
        {task.status === "cancelled" ? <div><h2>{t("documentWorkspace.cancelledTitle")}</h2><p>{t("documentWorkspace.cancelledBody")}</p><button type="button" onClick={() => void run(onRetry)} disabled={!onRetry || busy}>{t("documentWorkspace.retry")}</button>{onContinue ? <button type="button" onClick={() => void run(onContinue)} disabled={busy}>{t("documentWorkspace.continue")}</button> : null}</div> : null}
        {task.status === "completed" ? <div><h2>{t("documentWorkspace.readyTitle")}</h2><p>{t("documentWorkspace.readyBody")}</p>{onContinue ? <button type="button" onClick={() => void run(onContinue)} disabled={busy}>{t("documentWorkspace.continue")}</button> : null}</div> : null}
      </div> : null}
    </section>
    {!showPptx && visibleArtifact && onArtifactAction ? <nav className="document-workspace__artifact-actions" aria-label={t("documentWorkspace.artifactActions")}>{(["open", "copy", "locate"] as const).map((action) => <button type="button" key={action} onClick={() => void run(() => onArtifactAction(action, visibleArtifact))} disabled={busy}>{t(`documentWorkspace.action.${action}`)}</button>)}</nav> : null}
    {onContinueEditing ? <form className="document-workspace__edit" onSubmit={(event) => { event.preventDefault(); const input = new FormData(event.currentTarget).get("instruction"); if (typeof input === "string" && input.trim()) { void run(() => onContinueEditing(input.trim())); event.currentTarget.reset(); } }}><input name="instruction" aria-label={t("documentWorkspace.continueEditing")} placeholder={t("documentWorkspace.editPlaceholder")} /><button className="od-button--icon-submit" type="submit" aria-label={t("documentWorkspace.apply")} title={t("documentWorkspace.apply")} disabled={busy}><ArrowUpOutlined aria-hidden="true" /></button></form> : null}
  </main>;
}

export default DocumentWorkspace;
