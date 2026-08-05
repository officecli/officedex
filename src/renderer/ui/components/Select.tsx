import type { ChangeEvent, ReactNode, SelectHTMLAttributes } from "react";
import { formValueEvent } from "../formControl";

export type SelectValue = string | number;
export interface SelectOption<T extends SelectValue = SelectValue> {
  readonly value: T;
  readonly label: ReactNode;
  readonly disabled?: boolean;
}

export interface SelectProps<T extends SelectValue = SelectValue> extends Omit<SelectHTMLAttributes<HTMLSelectElement>, "defaultValue" | "onChange" | "size" | "value"> {
  readonly ariaLabel?: string;
  readonly options: readonly SelectOption<T>[];
  readonly value?: T | null;
  readonly defaultValue?: T | null;
  readonly size?: "small" | "smallPlus" | "medium" | "large";
  readonly onValueChange?: (value: T, option: SelectOption<T>, event: ChangeEvent<HTMLSelectElement>) => void;
  readonly onChange?: (value: T, option: SelectOption<T>) => void;
}

function SelectRoot<T extends SelectValue>({ ariaLabel, options, value, defaultValue, size = "medium", onValueChange, onChange, className, ...props }: SelectProps<T>) {
  const resolvedAriaLabel = ariaLabel ?? (props as Record<string, unknown>)["aria-label"] as string | undefined;
  return (
    <select
      {...props}
      aria-label={resolvedAriaLabel}
      className={["ui-select", className].filter(Boolean).join(" ")}
      data-size={size}
      value={value ?? undefined}
      defaultValue={defaultValue ?? undefined}
      onChange={(event) => {
        const option = options.find((item) => String(item.value) === event.currentTarget.value);
        if (option) {
          onChange?.(option.value, option);
          onValueChange?.(option.value, option, event);
        }
      }}
    >
      {options.map((option) => (
        <option key={String(option.value)} value={option.value} disabled={option.disabled}>
          {typeof option.label === "string" || typeof option.label === "number" ? option.label : String(option.value)}
        </option>
      ))}
    </select>
  );
}

export const Select = Object.assign(SelectRoot, { [formValueEvent]: "onChange" as const });
