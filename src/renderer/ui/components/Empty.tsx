import type { HTMLAttributes, ReactNode } from "react";

export interface EmptyProps extends HTMLAttributes<HTMLDivElement> {
  readonly description?: ReactNode;
  readonly image?: ReactNode;
}

export function Empty({ description, image, className, children, ...props }: EmptyProps) {
  return (
    <div {...props} className={["od-empty", className].filter(Boolean).join(" ")}>
      {image ? <div className="od-empty__image">{image}</div> : null}
      <div className="od-empty__description">{description ?? children}</div>
    </div>
  );
}
