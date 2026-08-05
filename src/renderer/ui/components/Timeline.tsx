import type { HTMLAttributes, ReactNode } from "react";

export interface TimelineItem { readonly color?: string; readonly content?: ReactNode; readonly children?: ReactNode }
export interface TimelineProps extends Omit<HTMLAttributes<HTMLOListElement>, "children"> { readonly items: readonly TimelineItem[] }

export function Timeline({ items, className, ...props }: TimelineProps) {
  return (
    <ol {...props} className={["ui-timeline", className].filter(Boolean).join(" ")}>
      {items.map((item, index) => <li key={index}><span className="ui-timeline__dot" style={{ backgroundColor: item.color }} /><div>{item.content ?? item.children}</div></li>)}
    </ol>
  );
}
