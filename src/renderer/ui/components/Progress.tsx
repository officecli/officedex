import type { HTMLAttributes } from "react";

export interface ProgressProps extends Omit<HTMLAttributes<HTMLDivElement>, "children"> {
  readonly percent: number;
  readonly status?: "normal" | "active" | "success" | "error" | "exception";
  readonly showInfo?: boolean;
  readonly size?: "small" | "default";
  readonly strokeColor?: string;
  readonly railColor?: string;
}

export function Progress({ percent, status = "normal", showInfo = true, size = "default", strokeColor, railColor, className, style, ...props }: ProgressProps) {
  const value = Math.max(0, Math.min(100, Number.isFinite(percent) ? percent : 0));
  return (
    <div {...props} className={["ui-progress", className].filter(Boolean).join(" ")} data-size={size} data-status={status} style={style}>
      <div className="ui-progress__track" style={{ backgroundColor: railColor }}>
        <div className="ui-progress__bar" style={{ backgroundColor: strokeColor, width: `${value}%` }} />
      </div>
      {showInfo ? <span className="ui-progress__info">{Math.round(value)}%</span> : null}
      <span className="ui-sr-only" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={value} />
    </div>
  );
}
