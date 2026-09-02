import { useEffect, useMemo, useState, type ChangeEvent } from "react";
import type { DesktopTask, TaskQuestionAnswer } from "../../shared/types";
import { useT } from "../i18n";
import type { GenerationAssistantPanelProps } from "./GenerationAssistantPanel";

/** Payload shape shared by every surface: it matches `DesktopAPI["respond"]`. */
export interface AssistantAnswerInput {
  taskId: string;
  questionId: string;
  optionId?: string;
  answer: string;
  answers?: TaskQuestionAnswer[];
}

export interface AssistantComposerConfig {
  placeholder: string;
  ariaLabel: string;
  submitLabel: string;
  onSubmit: (value: string) => void | Promise<unknown>;
}

/** The only strings that legitimately differ per document type. */
export interface AssistantCopy {
  /** Title shown when the task has no topic. */
  taskTitle: string;
  /** Prefix for `${statusNamespace}.${task.status}` lookups. */
  statusNamespace: string;
  ready?: { title: string; body: string };
  cancelled?: { title: string; body: string };
  failedFallback?: string;
}

export interface AssistantPanelOptions {
  task?: DesktopTask;
  copy: AssistantCopy;
  /** Surface-level error shown alongside task failures. */
  error?: string;
  welcome?: { title: string; body: string };
  /** Free-form follow-up composer. Omit to hide the bottom input. */
  composer?: AssistantComposerConfig;
  onAnswer?: (input: AssistantAnswerInput) => void | Promise<unknown>;
  onApprovePlan?: (task: DesktopTask) => void | Promise<unknown>;
  onCancel?: (taskId: string) => void | Promise<unknown>;
  onRetry?: (task: DesktopTask) => void | Promise<unknown>;
  onContinue?: (task: DesktopTask) => void | Promise<unknown>;
}

type QuestionDraft = { optionId?: string; answer: string; freeform: string };

/** Drafts outlive remounts so switching surfaces does not drop a half-typed answer. */
const questionDrafts = new Map<string, Record<string, QuestionDraft>>();

function questionDraftKey(task: DesktopTask) {
  const questionSetKey = task.question?.questions?.map((item) => item.id || item.question).join("|") || task.question?.id || "question";
  return `${task.id}:${questionSetKey}`;
}

function draftsFromAnswers(answers?: TaskQuestionAnswer[]) {
  const drafts: Record<string, QuestionDraft> = {};
  for (const item of answers ?? []) {
    if (!item.questionId || !item.answer) continue;
    drafts[item.questionId] = { optionId: item.optionId, answer: item.answer, freeform: item.optionId ? "" : item.answer };
  }
  return drafts;
}

/**
 * Builds the `GenerationAssistantPanel` view model from a task. Every document type shares
 * this state machine (question drafts, multi-question navigation, plan approval, composer);
 * only `copy` and the callbacks differ.
 */
export function useAssistantPanelModel({ task, copy, error, welcome, composer, onAnswer, onApprovePlan, onCancel, onRetry, onContinue }: AssistantPanelOptions): GenerationAssistantPanelProps {
  const t = useT();
  const [prompt, setPrompt] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [responding, setResponding] = useState(false);
  const [approving, setApproving] = useState(false);
  const [responseError, setResponseError] = useState<string>();
  const [viewedQuestionIndex, setViewedQuestionIndex] = useState(0);
  const [freeformValue, setFreeformValue] = useState("");
  const [drafts, setDrafts] = useState<Record<string, QuestionDraft>>({});

  const working = task?.status === "starting" || task?.status === "running";
  const needsInput = task?.status === "question";
  const planReview = task?.status === "plan_review";
  const busy = submitting || responding || approving || working;
  const gateActive = needsInput || planReview;
  const failure = responseError || error || task?.error || (task?.status === "failed" ? copy.failedFallback : undefined);

  const questionSet = useMemo(() => {
    if (!task?.question) return [];
    return task.question.questions?.length ? task.question.questions : [task.question];
  }, [task?.question]);
  const activeQuestionIndex = questionSet.length > 0 ? Math.max(0, Math.min(task?.question?.currentIndex ?? 0, questionSet.length - 1)) : 0;
  const currentQuestion = questionSet[viewedQuestionIndex];
  const currentDraft = currentQuestion ? drafts[currentQuestion.id] : undefined;
  const viewingActiveQuestion = viewedQuestionIndex === activeQuestionIndex;

  useEffect(() => {
    if (!task?.question) return;
    const key = questionDraftKey(task);
    const merged = { ...(questionDrafts.get(key) ?? {}), ...draftsFromAnswers(task.question.answers) };
    questionDrafts.set(key, merged);
    setDrafts(merged);
  }, [task?.id, task?.question?.answers, task?.question?.questions]);

  useEffect(() => {
    if (!task?.question || questionSet.length === 0) return;
    setViewedQuestionIndex(Math.max(0, Math.min(task.question.currentIndex ?? 0, questionSet.length - 1)));
  }, [task?.id, task?.question?.id, task?.question?.currentIndex, questionSet.length]);

  useEffect(() => {
    setFreeformValue(currentDraft?.freeform ?? "");
  }, [currentQuestion?.id, currentDraft?.freeform]);

  const saveQuestionDraft = (questionId: string, draft: QuestionDraft) => {
    if (!task) return drafts;
    const next = { ...drafts, [questionId]: draft };
    questionDrafts.set(questionDraftKey(task), next);
    setDrafts(next);
    return next;
  };

  const answerQuestion = async (optionId?: string, freeformAnswer?: string) => {
    if (!task?.question || !currentQuestion || responding || !viewingActiveQuestion || !onAnswer) return;
    const answer = freeformAnswer?.trim() || currentQuestion.options.find((option) => option.id === optionId)?.label.trim() || "";
    if (!answer) return;
    const responseQuestionId = task.question.questions?.length ? task.question.id : currentQuestion.id;
    const nextDrafts = saveQuestionDraft(currentQuestion.id, { optionId, answer, freeform: optionId ? "" : answer });
    const answers = questionSet.flatMap((question, index) => {
      const draft = nextDrafts[question.id];
      if (!draft?.answer) return [];
      return [{ questionGroupId: responseQuestionId, questionId: question.id, ...(draft.optionId ? { optionId: draft.optionId } : {}), answer: draft.answer, questionIndex: index }];
    });
    setResponding(true);
    setResponseError(undefined);
    try {
      await onAnswer({
        taskId: task.id,
        questionId: responseQuestionId,
        ...(optionId ? { optionId, answer } : { answer }),
        ...(task.question.questions?.length ? { answers } : {}),
      });
    } catch (err) {
      setResponseError(t("assistant.responseFailed", { error: err instanceof Error ? err.message : String(err) }));
    } finally {
      setResponding(false);
    }
  };

  const approvePlan = async () => {
    if (!task || !onApprovePlan || approving) return;
    setApproving(true);
    setResponseError(undefined);
    try {
      await onApprovePlan(task);
    } catch (err) {
      setResponseError(err instanceof Error ? err.message : String(err));
    } finally {
      setApproving(false);
    }
  };

  const submitPrompt = async () => {
    const value = prompt.trim();
    if (!value || busy || !composer) return;
    setSubmitting(true);
    try {
      await composer.onSubmit(value);
      setPrompt("");
    } finally {
      setSubmitting(false);
    }
  };

  const statusLabel = task ? t(`${copy.statusNamespace}.${task.status}`) : undefined;
  const terminal = task?.status === "completed" ? copy.ready : task?.status === "cancelled" ? copy.cancelled : undefined;
  const answeringFreeform = Boolean(needsInput && currentQuestion && currentQuestion.allowFreeform !== false && viewingActiveQuestion);

  // One composer serves three jobs: typing a new request, typing a freeform answer
  // during a question gate, and stopping a run. Keeping it single means the footer
  // never grows a second input or a second circular button.
  const composerModel = answeringFreeform
    ? {
      value: freeformValue,
      placeholder: t("assistant.customAnswerPlaceholder"),
      ariaLabel: t("assistant.customAnswer"),
      submitLabel: t("assistant.submitAnswer"),
      disabled: responding,
      loading: responding,
      onChange: (event: ChangeEvent<HTMLTextAreaElement>) => {
        const value = event.target.value;
        setFreeformValue(value);
        saveQuestionDraft(currentQuestion!.id, { answer: value.trim(), freeform: value });
      },
      onSubmit: () => answerQuestion(undefined, freeformValue),
    }
    : composer && !planReview
      ? {
        value: prompt,
        placeholder: composer.placeholder,
        ariaLabel: composer.ariaLabel,
        submitLabel: composer.submitLabel,
        loading: submitting,
        disabled: busy,
        onChange: (event: ChangeEvent<HTMLTextAreaElement>) => setPrompt(event.target.value),
        onSubmit: submitPrompt,
      }
      : undefined;

  // While the task runs, the send button becomes the stop button in place.
  const stoppable = task && onCancel && (working || needsInput);
  const mainComposer = composerModel
    ? { ...composerModel, ...(stoppable ? { stop: { label: t("assistant.stop"), onStop: () => onCancel(task.id) } } : {}) }
    : undefined;

  return {
    taskTitle: task ? task.topic || copy.taskTitle : undefined,
    statusLabel,
    statusIcon: working ? "working" : task?.status === "completed" ? "success" : "attention",
    welcome: !task ? welcome : undefined,
    stages: !gateActive ? task?.stages?.map((stage) => ({ id: stage.id, label: stage.label, status: stage.status === "active" ? "active" as const : stage.status === "completed" ? "completed" as const : stage.status === "failed" ? "failed" as const : "pending" as const })) : undefined,
    // The task card already names what is running, so the progress block only
    // carries the hint. Terminal states get their own summary instead.
    progress: working && task ? { title: "", body: t("assistant.progressHint") }
      : terminal ? { title: terminal.title, body: terminal.body } : undefined,
    plan: planReview ? {
      kicker: t("assistant.planReview"),
      title: t("assistant.planTitle"),
      content: task?.plan?.markdown || t("assistant.planFallback"),
      actionLabel: t("assistant.continue"),
      actionDisabled: !onApprovePlan || busy,
      actionLoading: approving,
      onAction: onApprovePlan ? approvePlan : undefined,
    } : undefined,
    question: needsInput && currentQuestion ? {
      kicker: t("assistant.decisionHint"),
      question: currentQuestion.question.trim(),
      allowFreeform: currentQuestion.allowFreeform !== false,
      options: currentQuestion.options.map((option) => ({
        id: option.id,
        label: option.label.trim(),
        description: option.description,
        recommended: option.recommended,
        selected: currentDraft?.optionId === option.id,
        disabled: responding || !viewingActiveQuestion,
        onSelect: () => answerQuestion(option.id),
      })),
      navigation: questionSet.length > 1 ? {
        previousLabel: t("assistant.previousQuestion"),
        nextLabel: t("assistant.nextQuestion"),
        progress: t("assistant.questionProgress", { current: viewedQuestionIndex + 1, total: questionSet.length }),
        previousDisabled: viewedQuestionIndex === 0 || responding,
        nextDisabled: viewedQuestionIndex >= activeQuestionIndex || responding,
        onPrevious: () => setViewedQuestionIndex((index) => Math.max(0, index - 1)),
        onNext: () => setViewedQuestionIndex((index) => Math.min(activeQuestionIndex, index + 1)),
      } : undefined,
    } : undefined,
    error: failure,
    action: task && (task.status === "failed" || task.status === "cancelled") && onRetry ? { label: t("assistant.retry"), onClick: () => onRetry(task) }
      : task && task.status === "completed" && onContinue ? { label: t("assistant.continue"), onClick: () => onContinue(task) }
      : undefined,
    mainComposer,
  };
}
