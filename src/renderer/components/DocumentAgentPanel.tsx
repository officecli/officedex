import type { DesktopTask, TaskQuestionAnswer } from "../../shared/types";
import { useT } from "../i18n";
import { GenerationAssistantPanel } from "./GenerationAssistantPanel";
import { useAssistantPanelModel } from "./assistantPanelModel";

export interface DocumentAgentPanelProps {
  task: DesktopTask;
  onAnswer?: (answer: TaskQuestionAnswer) => void | Promise<void>;
  onApprovePlan?: () => void | Promise<void>;
  onCancel?: () => void | Promise<void>;
  onRetry?: () => void | Promise<void>;
  onContinue?: () => void | Promise<void>;
  /** Free-form follow-up instruction; renders the composer at the bottom of the panel. */
  onContinueEditing?: (instruction: string) => void | Promise<void>;
}

export function DocumentAgentPanel({ task, onAnswer, onApprovePlan, onCancel, onRetry, onContinue, onContinueEditing }: DocumentAgentPanelProps) {
  const t = useT();
  const model = useAssistantPanelModel({
    task,
    copy: {
      taskTitle: t("documentWorkspace.untitled"),
      statusNamespace: "documentWorkspace.status",
      ready: { title: t("documentWorkspace.readyTitle"), body: t("documentWorkspace.readyBody") },
      cancelled: { title: t("documentWorkspace.cancelledTitle"), body: t("documentWorkspace.cancelledBody") },
      failedFallback: t("documentWorkspace.failedFallback"),
    },
    composer: onContinueEditing ? {
      placeholder: t("documentWorkspace.editPlaceholder"),
      ariaLabel: t("documentWorkspace.continueEditing"),
      submitLabel: t("documentWorkspace.apply"),
      onSubmit: (value) => onContinueEditing(value),
    } : undefined,
    onAnswer: onAnswer ? (input) => onAnswer({
      questionId: input.questionId,
      answer: input.answer,
      ...(input.optionId ? { optionId: input.optionId } : {}),
      ...(task.question?.currentIndex !== undefined ? { questionIndex: task.question.currentIndex } : {}),
    }) : undefined,
    onApprovePlan: onApprovePlan ? () => onApprovePlan() : undefined,
    onCancel: onCancel ? () => onCancel() : undefined,
    onRetry: onRetry ? () => onRetry() : undefined,
    onContinue: onContinue ? () => onContinue() : undefined,
  });
  return <GenerationAssistantPanel {...model} />;
}
