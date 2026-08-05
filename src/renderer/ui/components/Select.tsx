import type { ChangeEvent, ReactNode, SelectHTMLAttributes } from "react";

export type SelectValue = string | number;
export interface SelectOption {
  readonly value: SelectValue;
  readonly label: ReactNode;
  readonly disabled?: boolean;
}

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, "defaultValue" | "onChange" | "size" | "value"> {
  readonly ariaLabel?: string;
  readonly options: readonly SelectOption[];
  readonly value?: SelectValue | null;
  readonly defaultValue?: SelectValue | null;
  readonly size?: "small" | "smallPlus" | "medium" | "large";
  readonly onValueChange?: (value: SelectValue, option: SelectOption, event: ChangeEvent<HTMLSelectElement>) => void;
}

export function Select({ ariaLabel, options, value, defaultValue, size = "medium", onValueChange, className, ...props }: SelectProps) {
  return (
    <select
      {...props}
      aria-label={ariaLabel}
      className={["ui-select", className].filter(Boolean).join(" ")}
      data-size={size}
      value={value ?? undefined}
      defaultValue={defaultValue ?? undefined}
      onChange={(event) => {
        const option = options.find((item) => String(item.value) === event.currentTarget.value);
        if (option) onValueChange?.(option.value, option, event);
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
