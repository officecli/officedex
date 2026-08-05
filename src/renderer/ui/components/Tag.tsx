import type { HTMLAttributes, ReactNode } from "react";

export interface TagProps extends HTMLAttributes<HTMLSpanElement> {
  readonly color?: string;
  readonly tone?: "neutral" | "brand" | "success" | "warning" | "danger";
  readonly icon?: ReactNode;
  readonly closable?: boolean;
  readonly onClose?: () => void;
}

export function Tag({ color, tone, icon, closable, onClose, children, className, ...props }: TagProps) {
  const resolvedTone = tone ?? ({ green: "success", success: "success", red: "danger", error: "danger", warning: "warning", gold: "warning", processing: "brand", purple: "brand" }[color ?? ""] ?? "neutral");
  const label = typeof children === "string" || typeof children === "number" ? String(children) : "tag";
  return (
    <span {...props} className={["ui-tag", className].filter(Boolean).join(" ")} data-tone={resolvedTone}>
      {icon ? <span className="ui-tag__icon">{icon}</span> : null}
      {children}
      {closable ? <button type="button" aria-label={`Remove ${label}`} onClick={onClose}>×</button> : null}
    </span>
  );
}
