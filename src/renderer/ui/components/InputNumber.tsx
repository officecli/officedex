import type { InputHTMLAttributes } from "react";
import { formValueEvent } from "../formControl";

export interface InputNumberProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "onChange" | "type" | "value"> {
  readonly value?: number | null;
  readonly precision?: number;
  readonly onChange?: (value: number | null) => void;
}

function InputNumberRoot({ value, precision, onChange, className, ...props }: InputNumberProps) {
  return (
    <input
      {...props}
      className={["ui-input", "ui-input-number", className].filter(Boolean).join(" ")}
      step={precision === 0 ? 1 : props.step}
      type="number"
      value={value ?? ""}
      onChange={(event) => {
        const next = event.currentTarget.value;
        onChange?.(next === "" ? null : Number(next));
      }}
    />
  );
}

export const InputNumber = Object.assign(InputNumberRoot, { [formValueEvent]: "onChange" as const });
