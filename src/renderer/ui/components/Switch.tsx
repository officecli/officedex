import type { ButtonHTMLAttributes, MouseEvent } from "react";

export interface SwitchProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-label" | "onChange" | "type"> {
  readonly ariaLabel?: string;
  readonly checked?: boolean;
  readonly onCheckedChange?: (checked: boolean, event: MouseEvent<HTMLButtonElement>) => void;
  readonly size?: "small" | "medium";
}

export function Switch({ ariaLabel, checked = false, onCheckedChange, size = "medium", className, onClick, ...props }: SwitchProps) {
  return (
    <button
      {...props}
      aria-checked={checked}
      aria-label={ariaLabel}
      className={["ui-switch", className].filter(Boolean).join(" ")}
      data-size={size}
      role="switch"
      type="button"
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) onCheckedChange?.(!checked, event);
      }}
    >
      <span className="ui-switch__thumb" aria-hidden="true" />
    </button>
  );
}
