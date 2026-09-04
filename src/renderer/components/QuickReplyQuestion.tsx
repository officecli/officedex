import { useEffect, useState, type KeyboardEvent } from "react";
import { ChevronLeft, ChevronRight, LoaderCircle } from "lucide-react";
import { Button } from "../ui";
import { useT } from "../i18n";
import "./quickReplyQuestion.css";
import { MAX_NUMBERED_OPTIONS } from "../constants/limits";

export interface QuickReplyOption {
  id: string;
  label: string;
  description?: string;
  recommended?: boolean;
}

export interface QuickReplyNavigation {
  progress: string;
  previousLabel: string;
  nextLabel: string;
  previousDisabled?: boolean;
  nextDisabled?: boolean;
  onPrevious: () => void;
  onNext: () => void;
}

export interface QuickReplyQuestionProps {
  question: string;
  options: QuickReplyOption[];
  /** The option the user picked (or a persisted draft). Highlighted unless a freeform draft is being typed. */
  selectedOptionId?: string;
  /** Text currently typed into the host's composer. A non-empty draft drops the chip highlight. */
  freeformDraft?: string;
  /** Whether the host offers a typed answer; only changes the idle hint under the chips. */
  allowFreeform?: boolean;
  /** True while the answer is in flight: chips lock and the chosen one shows a spinner. */
  responding?: boolean;
  /** True when this question is history and cannot be answered again. */
  readOnly?: boolean;
  navigation?: QuickReplyNavigation;
  onSelect: (optionId: string) => void;
  className?: string;
}

/** Chips carry a number key only while the set is short enough to memorise at a glance. */

/**
 * Quick-reply rendering of a clarification question: the question reads as an
 * assistant message, each option is a chip that answers on click, and one shared
 * note line under the chips explains whichever option is hovered or focused.
 * Freeform answers are the host's job (its composer); this component only reflects
 * the draft so the chips stop claiming the selection while the user types.
 */
export function QuickReplyQuestion({ question, options, selectedOptionId, freeformDraft, allowFreeform, responding, readOnly, navigation, onSelect, className }: QuickReplyQuestionProps) {
  const t = useT();
  const [previewId, setPreviewId] = useState<string>();
  useEffect(() => setPreviewId(undefined), [question]);

  const typing = Boolean(freeformDraft?.trim());
  const interactive = !readOnly && !responding;
  const highlightedId = typing ? undefined : selectedOptionId;
  const numbered = interactive && options.length > 0 && options.length <= MAX_NUMBERED_OPTIONS;
  const hasDescriptions = options.some((option) => option.description);
  const previewOption = options.find((option) => option.id === (previewId ?? highlightedId));

  const noteKind = typing ? "custom" : previewOption?.description ? "description" : readOnly ? "answered" : "hint";
  const note = noteKind === "custom" ? t("quickReply.customHint")
    : noteKind === "description" ? previewOption!.description
    : noteKind === "answered" ? t("quickReply.answered")
    : allowFreeform ? t("quickReply.idleHint") : t("quickReply.idleHintNoFreeform");
  const showNote = typing || hasDescriptions || allowFreeform || readOnly;

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!numbered) return;
    const index = Number.parseInt(event.key, 10);
    if (!Number.isInteger(index) || index < 1 || index > options.length) return;
    event.preventDefault();
    onSelect(options[index - 1].id);
  };

  return (
    <section
      className={["quick-reply", className].filter(Boolean).join(" ")}
      aria-label={t("quickReply.sectionAria")}
      data-state={readOnly ? "answered" : responding ? "responding" : "open"}
    >
      {navigation ? (
        <div className="quick-reply__nav">
          <Button size="small" variant="ghost-normal" ariaLabel={navigation.previousLabel} icon={<ChevronLeft />} disabled={navigation.previousDisabled} onClick={navigation.onPrevious} />
          <span>{navigation.progress}</span>
          <Button size="small" variant="ghost-normal" ariaLabel={navigation.nextLabel} icon={<ChevronRight />} disabled={navigation.nextDisabled} onClick={navigation.onNext} />
        </div>
      ) : null}
      <div className="quick-reply__bubble">
        <span className="quick-reply__who">{t("quickReply.kicker")}</span>
        <p className="quick-reply__question">{question}</p>
      </div>
      {options.length > 0 ? (
        <div className="quick-reply__chips" role="group" aria-label={t("quickReply.optionsAria")} onKeyDown={handleKeyDown}>
          {options.map((option, index) => {
            const selected = highlightedId === option.id;
            const recommendedLabel = t("quickReply.recommended");
            return (
              <button
                type="button"
                key={option.id}
                className="quick-reply__chip"
                aria-label={option.recommended ? `${option.label} · ${recommendedLabel}` : option.label}
                aria-pressed={selected}
                disabled={!interactive}
                onClick={() => onSelect(option.id)}
                onMouseEnter={() => setPreviewId(option.id)}
                onMouseLeave={() => setPreviewId(undefined)}
                onFocus={() => setPreviewId(option.id)}
                onBlur={() => setPreviewId(undefined)}
              >
                {numbered ? <span className="quick-reply__key" aria-hidden="true">{index + 1}</span> : null}
                <span className="quick-reply__label">{option.label}</span>
                {option.recommended ? <span className="quick-reply__recommended" aria-hidden="true">{recommendedLabel}</span> : null}
                {responding && selected ? <LoaderCircle className="quick-reply__spinner" aria-hidden="true" /> : null}
              </button>
            );
          })}
        </div>
      ) : null}
      {showNote ? <p className="quick-reply__note" data-kind={noteKind} aria-live="polite">{note}</p> : null}
    </section>
  );
}
