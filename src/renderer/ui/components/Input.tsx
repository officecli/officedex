import type { ChangeEvent, InputHTMLAttributes } from "react";

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "onChange" | "size"> {
  readonly size?: "small" | "smallPlus" | "medium" | "large";
  readonly status?: "error" | "warning";
  readonly onChange?: (value: string, event: ChangeEvent<HTMLInputElement>) => void;
}

export function Input({ size = "medium", status, onChange, className, ...props }: InputProps) {
  return (
    <input
      {...props}
      className={["ui-input", className].filter(Boolean).join(" ")}
      data-size={size}
      data-status={status}
      onChange={(event) => onChange?.(event.currentTarget.value, event)}
    />
  );
}
