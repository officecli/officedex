import type { HTMLAttributes, ReactNode } from "react";

export interface EmptyProps extends HTMLAttributes<HTMLDivElement> {
  readonly description?: ReactNode;
  readonly image?: ReactNode;
}

export function Empty({ description, image, className, children, ...props }: EmptyProps) {
  return (
    <div {...props} className={["ui-empty", className].filter(Boolean).join(" ")}>
      {image ? <div className="ui-empty__image">{image}</div> : null}
      <div className="ui-empty__description">{description ?? children}</div>
    </div>
  );
}
