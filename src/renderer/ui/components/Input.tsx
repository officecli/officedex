import type { InputHTMLAttributes, KeyboardEventHandler, ReactNode } from "react";
import { formValueEvent } from "../formControl";

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "prefix" | "size"> {
  readonly size?: "small" | "smallPlus" | "medium" | "large";
  readonly status?: "error" | "warning";
  readonly prefix?: ReactNode;
  readonly suffix?: ReactNode;
  readonly onPressEnter?: KeyboardEventHandler<HTMLInputElement>;
}

function InputRoot({ size = "medium", status, prefix, suffix, onPressEnter, onKeyDown, className, ...props }: InputProps) {
  const input = (
    <input
      {...props}
      className={["ui-input", className].filter(Boolean).join(" ")}
      data-size={size}
      data-status={status}
      onKeyDown={(event) => {
        onKeyDown?.(event);
        if (!event.defaultPrevented && event.key === "Enter") onPressEnter?.(event);
      }}
    />
  );
  if (!prefix && !suffix) return input;
  return (
    <span className="ui-input-shell">
      {prefix ? <span className="ui-input-shell__prefix">{prefix}</span> : null}
      {input}
      {suffix ? <span className="ui-input-shell__suffix">{suffix}</span> : null}
    </span>
  );
}

export const Input = Object.assign(InputRoot, { [formValueEvent]: "onChange" as const });
