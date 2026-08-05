import type { HTMLAttributes, ReactNode } from "react";

export interface ResultProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  readonly status?: "success" | "error" | "info" | "warning" | "404" | "403" | "500";
  readonly title?: ReactNode;
  readonly subTitle?: ReactNode;
  readonly icon?: ReactNode;
  readonly extra?: ReactNode;
}

export function Result({ status = "info", title, subTitle, icon, extra, className, ...props }: ResultProps) {
  return (
    <div {...props} className={["ui-result", className].filter(Boolean).join(" ")} data-status={status}>
      {icon ? <div className="ui-result__icon">{icon}</div> : null}
      {title ? <h2>{title}</h2> : null}
      {subTitle ? <p>{subTitle}</p> : null}
      {extra ? <div className="ui-result__extra">{extra}</div> : null}
    </div>
  );
}
