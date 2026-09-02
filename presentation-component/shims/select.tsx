import type { ReactNode } from "react";

export type SelectValue = string | number;
export interface SelectOption {
  readonly value?: SelectValue;
  readonly label?: ReactNode;
  readonly id?: SelectValue;
  readonly content?: ReactNode;
  readonly disabled?: boolean;
}
export interface SelectProps {
  readonly ariaLabel?: string;
  readonly value?: SelectValue;
  readonly selected?: SelectValue;
  readonly placeholder?: string;
  readonly options?: readonly SelectOption[];
  readonly disabled?: boolean;
  readonly className?: string;
  readonly onValueChange?: (value: SelectValue) => void;
  readonly onChange?: (value: SelectValue) => void;
}

function displayLabel(option: SelectOption): string {
  const label = option.label ?? option.content ?? option.value ?? option.id ?? "";
  return typeof label === "string" || typeof label === "number"
    ? String(label)
    : String(option.value ?? option.id ?? "");
}

export function Select(props: SelectProps) {
  const value = props.value ?? props.selected ?? "";
  return (
    <select
      aria-label={props.ariaLabel}
      className={props.className}
      disabled={props.disabled}
      value={String(value)}
      onChange={(event) => {
        const option = props.options?.find(
          (candidate) =>
            String(candidate.value ?? candidate.id ?? "") === event.target.value,
        );
        const nextValue = option?.value ?? option?.id ?? event.target.value;
        props.onValueChange?.(nextValue);
        props.onChange?.(nextValue);
      }}
    >
      {props.placeholder && value === "" ? (
        <option value="" disabled>
          {props.placeholder}
        </option>
      ) : null}
      {(props.options ?? []).map((option, index) => {
        const optionValue = option.value ?? option.id ?? index;
        return (
          <option
            key={String(optionValue)}
            value={String(optionValue)}
            disabled={option.disabled}
          >
            {displayLabel(option)}
          </option>
        );
      })}
    </select>
  );
}

