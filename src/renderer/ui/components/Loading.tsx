import type { HTMLAttributes, ReactNode } from "react";

export interface LoadingProps extends Omit<HTMLAttributes<HTMLDivElement>, "aria-label"> {
  readonly ariaLabel?: string;
  readonly size?: "mini" | "small" | "medium" | "large";
  readonly children?: ReactNode;
}

export function Loading({ ariaLabel, size = "medium", children, className, ...props }: LoadingProps) {
  return (
    <div {...props} aria-label={ariaLabel} className={["od-loading", className].filter(Boolean).join(" ")} data-size={size}>
      <span className="od-loading__spinner" aria-hidden="true" />
      {children}
    </div>
  );
}
