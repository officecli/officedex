import { forwardRef, useLayoutEffect, useRef, type KeyboardEvent, type MutableRefObject, type Ref, type TextareaHTMLAttributes } from "react";
import { formValueEvent } from "../formControl";

export interface TextAreaProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "onSubmit"> {
  readonly autoSize?: boolean | { minRows?: number; maxRows?: number };
  readonly showCount?: boolean;
  readonly onSubmit?: (value: string) => void;
}

function mergeRefs<T>(...refs: Array<Ref<T> | undefined>) {
  return (node: T | null) => {
    for (const ref of refs) {
      if (typeof ref === "function") ref(node);
      else if (ref) (ref as MutableRefObject<T | null>).current = node;
    }
  };
}

const TextAreaRoot = forwardRef<HTMLTextAreaElement, TextAreaProps>(function TextAreaRoot({ autoSize, showCount, onChange, onSubmit, onCompositionStart, onCompositionEnd, onKeyDown, className, value, defaultValue, maxLength, ...props }, forwarded) {
  const inner = useRef<HTMLTextAreaElement | null>(null);
  const composing = useRef(false);

  useLayoutEffect(() => {
    const element = inner.current;
    if (!element || !autoSize) return;
    element.style.height = "auto";
    element.style.height = `${element.scrollHeight}px`;
  }, [autoSize, value]);

  const textarea = (
    <textarea
      {...props}
      ref={mergeRefs(inner, forwarded)}
      className={["od-textarea", className].filter(Boolean).join(" ")}
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
        const imeComposing = composing.current || event.nativeEvent.isComposing || event.keyCode === 229 || event.which === 229;
        if (!event.defaultPrevented && event.key === "Enter" && !event.shiftKey && !imeComposing) {
          event.preventDefault();
          onSubmit?.(event.currentTarget.value);
        }
      }}
    />
  );

  if (!showCount) return textarea;
  const count = String(value ?? defaultValue ?? "").length;
  return (
    <span className="od-textarea-shell">
      {textarea}
      <span className="od-textarea__count" aria-hidden="true">{count}{maxLength ? ` / ${maxLength}` : ""}</span>
    </span>
  );
});

export const TextArea = Object.assign(TextAreaRoot, { [formValueEvent]: "onChange" as const });
