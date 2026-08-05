import type { ButtonHTMLAttributes, MouseEvent } from "react";
import { formValueEvent } from "../formControl";

export interface SwitchProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-label" | "onChange" | "type"> {
  readonly ariaLabel?: string;
  readonly checked?: boolean;
  readonly onCheckedChange?: (checked: boolean, event: MouseEvent<HTMLButtonElement>) => void;
  readonly onChange?: (checked: boolean, event: MouseEvent<HTMLButtonElement>) => void;
  readonly size?: "small" | "medium";
}

function SwitchRoot({ ariaLabel, checked = false, onCheckedChange, onChange, size = "medium", className, onClick, ...props }: SwitchProps) {
  const resolvedAriaLabel = ariaLabel ?? (props as Record<string, unknown>)["aria-label"] as string | undefined;
  return (
    <button
      {...props}
      aria-checked={checked}
      aria-label={resolvedAriaLabel}
      className={["ui-switch", className].filter(Boolean).join(" ")}
      data-size={size}
      role="switch"
      type="button"
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) {
          onChange?.(!checked, event);
          onCheckedChange?.(!checked, event);
        }
      }}
    >
      <span className="ui-switch__thumb" aria-hidden="true" />
    </button>
  );
}

export const Switch = Object.assign(SwitchRoot, { [formValueEvent]: "onChange" as const });
