import { useLayoutEffect, useRef, type KeyboardEvent, type TextareaHTMLAttributes } from "react";
import { formValueEvent } from "../formControl";

export interface TextAreaProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "onSubmit"> {
  readonly autoSize?: boolean | { minRows?: number; maxRows?: number };
  readonly showCount?: boolean;
  readonly onSubmit?: (value: string) => void;
}

function TextAreaRoot({ autoSize, showCount, onChange, onSubmit, onCompositionStart, onCompositionEnd, onKeyDown, className, value, defaultValue, maxLength, ...props }: TextAreaProps) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const composing = useRef(false);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element || !autoSize) return;
    element.style.height = "auto";
    element.style.height = `${element.scrollHeight}px`;
  }, [autoSize, value]);

  const textarea = (
    <textarea
      {...props}
      ref={ref}
      className={["ui-textarea", className].filter(Boolean).join(" ")}
      defaultValue={defaultValue}
      maxLength={maxLength}
      rows={typeof autoSize === "object" ? autoSize.minRows : props.rows}
      value={value}
      onChange={onChange}
      onCompositionStart={(event) => {
        composing.current = true;
        onCompositionStart?.(event);
      }}
      onCompositionEnd={(event) => {
        composing.current = false;
        onCompositionEnd?.(event);
      }}
      onKeyDown={(event: KeyboardEvent<HTMLTextAreaElement>) => {
        onKeyDown?.(event);
        if (!event.defaultPrevented && event.key === "Enter" && !event.shiftKey && !composing.current && !event.nativeEvent.isComposing) {
          event.preventDefault();
          onSubmit?.(event.currentTarget.value);
        }
      }}
    />
  );

  if (!showCount) return textarea;
  const count = String(value ?? defaultValue ?? "").length;
  return (
    <span className="ui-textarea-shell">
      {textarea}
      <span className="ui-textarea__count" aria-hidden="true">{count}{maxLength ? ` / ${maxLength}` : ""}</span>
    </span>
  );
}

export const TextArea = Object.assign(TextAreaRoot, { [formValueEvent]: "onChange" as const });
