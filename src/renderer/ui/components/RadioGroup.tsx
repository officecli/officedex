import { createContext, useContext, type ButtonHTMLAttributes, type HTMLAttributes, type ReactNode } from "react";

interface RadioGroupContextValue {
  value?: string | null;
  disabled?: boolean;
  onValueChange?: (value: string) => void;
}

const RadioGroupContext = createContext<RadioGroupContextValue>({});

export interface RadioGroupProps extends Omit<HTMLAttributes<HTMLDivElement>, "defaultValue" | "onChange"> {
  readonly value?: string | null;
  readonly onValueChange?: (value: string) => void;
  readonly ariaLabel?: string;
  readonly disabled?: boolean;
  readonly children?: ReactNode;
}

export interface RadioGroupItemProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "value"> {
  readonly value: string;
}

function RadioGroupRoot({ value, onValueChange, ariaLabel, disabled, children, className, ...props }: RadioGroupProps) {
  return (
    <RadioGroupContext.Provider value={{ value, disabled, onValueChange }}>
      <div {...props} aria-label={ariaLabel} className={["ui-radio-group", className].filter(Boolean).join(" ")} role="radiogroup">
        {children}
      </div>
    </RadioGroupContext.Provider>
  );
}

function RadioGroupItem({ value, children, disabled, className, onClick, ...props }: RadioGroupItemProps) {
  const group = useContext(RadioGroupContext);
  const checked = group.value === value;
  return (
    <button
      {...props}
      aria-checked={checked}
      className={["ui-radio-group__item", className].filter(Boolean).join(" ")}
      data-selected={checked ? "true" : "false"}
      disabled={disabled || group.disabled}
      role="radio"
      type="button"
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) group.onValueChange?.(value);
      }}
    >
      {children}
    </button>
  );
}

export const RadioGroup = Object.assign(RadioGroupRoot, { Item: RadioGroupItem });
