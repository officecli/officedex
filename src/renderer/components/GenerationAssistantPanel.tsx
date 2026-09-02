import { AlertCircle, ArrowUp, CheckCircle2, ChevronLeft, ChevronRight, LoaderCircle, Square } from "lucide-react";
import { Button, TextArea } from "../ui";
import { useT } from "../i18n";
import type { GenerationActionModel, GenerationComposerModel, GenerationOptionModel, GenerationPlanModel, GenerationQuestionModel, GenerationStageModel } from "./generationAssistant.types";
import "./generationAssistant.css";

export interface GenerationAssistantPanelProps {
  taskTitle?: string;
  statusLabel?: string;
  statusIcon?: "working" | "attention" | "success";
  welcome?: { title: string; body: string };
  stages?: GenerationStageModel[];
  question?: GenerationQuestionModel;
  plan?: GenerationPlanModel;
  progress?: { title: string; body?: string };
  error?: string;
  /** The single footer composer. It doubles as the freeform answer field during a question gate. */
  mainComposer?: GenerationComposerModel;
  action?: GenerationActionModel;
  showHeader?: boolean;
  className?: string;
}

function StatusIcon({ kind = "attention" }: { kind?: GenerationAssistantPanelProps["statusIcon"] }) {
  if (kind === "working") return <LoaderCircle className="is-spinning" aria-hidden="true" />;
  if (kind === "success") return <CheckCircle2 aria-hidden="true" />;
  return <AlertCircle aria-hidden="true" />;
}

/**
 * The composer owns one circular button with two states: send while the user is
 * composing, stop while the task is running. Both live in the same place so the
 * control never jumps and a run is always cancelled where the user is looking.
 *
 * The button falls back to stop whenever there is nothing to send — either the
 * field is locked because the run is in flight, or it is empty. Typing during a
 * question gate turns it back into send so a freeform answer stays submittable.
 */
function Composer({ model }: { model: GenerationComposerModel }) {
  const stopping = Boolean(model.stop) && (Boolean(model.disabled) || !model.value.trim());
  return <form
    className="generation-assistant-panel__composer"
    onSubmit={(event) => {
      event.preventDefault();
      if (stopping) return void model.stop?.onStop();
      void model.onSubmit();
    }}
  >
    <TextArea
      aria-label={model.ariaLabel}
      value={model.value}
      rows={3}
      placeholder={model.placeholder}
      disabled={model.disabled}
      onChange={model.onChange}
      onSubmit={() => { if (!stopping) void model.onSubmit(); }}
    />
    <Button
      className="ui-button--circular-submit generation-assistant-panel__send"
      data-mode={stopping ? "stop" : "send"}
      ariaLabel={stopping ? model.stop!.label : model.submitLabel}
      variant="primary"
      icon={stopping ? <Square aria-hidden="true" fill="currentColor" strokeWidth={0} /> : <ArrowUp aria-hidden="true" />}
      loading={stopping ? model.stop!.loading : model.loading}
      disabled={stopping ? false : model.disabled || model.loading || !model.value.trim()}
      htmlType="submit"
    />
  </form>;
}

function Option({ option, index }: { option: GenerationOptionModel; index: number }) {
  const t = useT();
  return <Button block size="smallPlus" ariaLabel={option.label} variant={option.selected ? "primary" : "secondary"} disabled={option.disabled} onClick={() => void option.onSelect?.()}>
    <span className="generation-assistant-panel__option-number">{index + 1}</span>
    <span className="generation-assistant-panel__option-label">{option.label}</span>
    {option.recommended ? <span className="generation-assistant-panel__recommended">{t("assistant.recommended")}</span> : null}
    {option.description ? <small className="generation-assistant-panel__option-description">{option.description}</small> : null}
  </Button>;
}

function Question({ model }: { model: GenerationQuestionModel }) {
  const t = useT();
  return <section className="generation-assistant-panel__question" aria-label={t("assistant.questionTitle")}>
    {model.navigation ? <div className="generation-assistant-panel__question-nav"><Button size="small" variant="ghost-normal" ariaLabel={model.navigation.previousLabel} icon={<ChevronLeft />} disabled={model.navigation.previousDisabled} onClick={model.navigation.onPrevious} /><span>{model.navigation.progress}</span><Button size="small" variant="ghost-normal" ariaLabel={model.navigation.nextLabel} icon={<ChevronRight />} disabled={model.navigation.nextDisabled} onClick={model.navigation.onNext} /></div> : null}
    <div className="generation-assistant-panel__question-heading"><span className="generation-assistant-panel__kicker">{model.kicker}</span><strong className="generation-assistant-panel__question-title">{model.question}</strong></div>
    <div className="generation-assistant-panel__question-options">{model.options.map((option, index) => <Option key={option.id} option={option} index={index} />)}</div>
  </section>;
}

export function GenerationAssistantPanel({ taskTitle, statusLabel, statusIcon, welcome, stages, question, plan, progress, error, mainComposer, action, showHeader = true, className }: GenerationAssistantPanelProps) {
  const t = useT();
  return <aside className={["generation-assistant-panel", showHeader ? "" : "generation-assistant-panel--no-header", className].filter(Boolean).join(" ")} aria-label={t("assistant.title")}>
    {showHeader ? <header className="generation-assistant-panel__header"><span aria-hidden="true">✣</span><strong>{t("assistant.title")}</strong></header> : null}
    <div className="generation-assistant-panel__timeline" aria-live="polite">
      {welcome ? <div className="generation-assistant-panel__welcome"><strong>{welcome.title}</strong><p>{welcome.body}</p></div> : null}
      {taskTitle ? <div className="generation-assistant-panel__task"><StatusIcon kind={statusIcon} /><div><strong>{taskTitle}</strong>{statusLabel ? <span role="status">{statusLabel}</span> : null}</div></div> : null}
      {progress ? <section className="generation-assistant-panel__progress">{progress.title ? <h2>{progress.title}</h2> : null}{progress.body ? <p>{progress.body}</p> : null}</section> : null}
      {stages?.length ? <ol className="generation-assistant-panel__stages">{stages.map((stage) => <li key={stage.id} data-status={stage.status}>{stage.label}</li>)}</ol> : null}
      {plan ? <section className="generation-assistant-panel__plan" aria-label={plan.kicker}><span className="generation-assistant-panel__kicker">{plan.kicker}</span><strong>{plan.title}</strong><pre>{plan.content}</pre>{plan.onAction ? <Button size="small" variant="primary" loading={plan.actionLoading} disabled={plan.actionDisabled} onClick={() => void plan.onAction?.()}>{plan.actionLabel}</Button> : null}</section> : null}
      {question ? <Question model={question} /> : null}
      {error ? <div className="generation-assistant-panel__error" role="alert">{error}</div> : null}
      {action ? <Button size="small" variant={action.variant ?? "primary"} icon={action.icon} loading={action.loading} disabled={action.disabled} onClick={() => void action.onClick()}>{action.label}</Button> : null}
    </div>
    {mainComposer ? <div className="generation-assistant-panel__footer"><Composer model={mainComposer} /></div> : null}
  </aside>;
}
