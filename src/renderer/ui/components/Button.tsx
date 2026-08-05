import type { ButtonHTMLAttributes, ReactNode } from "react";

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-label"> {
  readonly ariaLabel?: string;
  readonly variant?: "primary" | "secondary" | "danger" | "outline" | "ghost-normal" | "ghost-guidance" | "ghost-danger";
  readonly size?: "small" | "smallPlus" | "medium" | "large";
  readonly icon?: ReactNode;
  readonly loading?: boolean;
}

export function Button({ ariaLabel, variant = "secondary", size = "medium", icon, loading, children, disabled, className, ...props }: ButtonProps) {
  const classes = ["ui-button", className].filter(Boolean).join(" ");
  return (
    <button
      {...props}
      aria-label={ariaLabel}
      className={classes}
      data-size={size}
      data-variant={variant}
      disabled={disabled || loading}
    >
      {loading ? <span className="ui-button__spinner" aria-hidden="true" /> : icon ? <span className="ui-button__icon">{icon}</span> : null}
      {children ? <span className="ui-button__label">{children}</span> : null}
    </button>
  );
}
