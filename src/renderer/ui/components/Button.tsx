import type { ButtonHTMLAttributes, ReactNode } from "react";

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-label" | "type"> {
  readonly ariaLabel?: string;
  readonly type?: "default" | "primary" | "text" | "link";
  readonly htmlType?: ButtonHTMLAttributes<HTMLButtonElement>["type"];
  readonly variant?: "primary" | "secondary" | "danger" | "outline" | "ghost-normal" | "ghost-guidance" | "ghost-danger";
  readonly size?: "small" | "smallPlus" | "medium" | "middle" | "large";
  readonly icon?: ReactNode;
  readonly loading?: boolean;
  readonly danger?: boolean;
}

export function Button({ ariaLabel, type, htmlType, variant, size = "medium", icon, loading, danger, children, disabled, className, ...props }: ButtonProps) {
  const classes = ["ui-button", className].filter(Boolean).join(" ");
  const resolvedVariant = variant ?? (danger ? "danger" : type === "primary" ? "primary" : type === "text" || type === "link" ? "ghost-normal" : "secondary");
  return (
    <button
      {...props}
      aria-label={ariaLabel}
      className={classes}
      data-size={size === "middle" ? "medium" : size}
      data-variant={resolvedVariant}
      disabled={disabled || loading}
      type={htmlType ?? "button"}
    >
      {loading ? <span className="ui-button__spinner" aria-hidden="true" /> : icon ? <span className="ui-button__icon">{icon}</span> : null}
      {children ? <span className="ui-button__label">{children}</span> : null}
    </button>
  );
}
