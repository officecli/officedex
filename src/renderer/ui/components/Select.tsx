import { useState, type ChangeEvent, type ReactNode, type SelectHTMLAttributes } from "react";
import { formValueEvent } from "../formControl";
import { Popover } from "./Popover";

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
  const [open, setOpen] = useState(false);
  const [internalValue, setInternalValue] = useState<T | null>(defaultValue ?? options[0]?.value ?? null);
  const selected = value ?? internalValue;
  const selectedOption = options.find((option) => String(option.value) === String(selected)) ?? options[0];
  const choose = (option: SelectOption<T>) => {
    if (option.disabled) return;
    if (value === undefined) setInternalValue(option.value);
    onChange?.(option.value, option);
    onValueChange?.(option.value, option, {} as ChangeEvent<HTMLSelectElement>);
    setOpen(false);
  };
  return (
    <Popover open={open} onOpenChange={setOpen} trigger="click" content={<div className="ui-menu" role="menu">{options.map((option) => <button key={String(option.value)} type="button" role="menuitemradio" aria-checked={String(option.value) === String(selected)} disabled={option.disabled} onClick={() => choose(option)}>{option.label}</button>)}</div>}>
      <button {...props as SelectHTMLAttributes<HTMLButtonElement>} type="button" aria-label={resolvedAriaLabel} className={["ui-select", className].filter(Boolean).join(" ")} data-size={size}>{selectedOption?.label ?? ""}</button>
    </Popover>
  );
}

export const Select = Object.assign(SelectRoot, { [formValueEvent]: "onChange" as const });
