import type { ChangeEvent, ReactNode } from "react";

export type GenerationStageStatus = "pending" | "active" | "completed" | "failed";

export interface GenerationStageModel {
  id: string;
  label: string;
  status: GenerationStageStatus;
}

export interface GenerationOptionModel {
  id: string;
  label: string;
  description?: string;
  recommended?: boolean;
  selected?: boolean;
  onSelect?: () => void | Promise<void>;
  disabled?: boolean;
}

export interface GenerationComposerModel {
  value: string;
  placeholder: string;
  ariaLabel: string;
  submitLabel: string;
  disabled?: boolean;
  loading?: boolean;
  onChange: (event: ChangeEvent<HTMLTextAreaElement>) => void;
  onSubmit: () => void | Promise<void>;
  /**
   * Turns the circular submit button into a stop control. Send and stop are the
   * same affordance in two states, so a run is always interrupted from the spot
   * the user last typed in rather than from a separate floating button.
   */
  stop?: { label: string; loading?: boolean; onStop: () => void | Promise<unknown> };
}

export interface GenerationQuestionModel {
  kicker: string;
  question: string;
  progress?: string;
  options: GenerationOptionModel[];
  /** True when the surface accepts a typed answer through the shared footer composer. */
  allowFreeform?: boolean;
  navigation?: { previousLabel: string; nextLabel: string; progress: string; previousDisabled?: boolean; nextDisabled?: boolean; onPrevious: () => void; onNext: () => void };
}

export interface GenerationPlanModel {
  kicker: string;
  title: string;
  content: string;
  actionLabel: string;
  actionDisabled?: boolean;
  actionLoading?: boolean;
  onAction?: () => void | Promise<unknown>;
}

export interface GenerationActionModel {
  label: string;
  icon?: ReactNode;
  variant?: "primary" | "secondary";
  disabled?: boolean;
  loading?: boolean;
  onClick: () => void | Promise<unknown>;
}
