import { createElement, type HTMLAttributes, type ReactNode } from "react";

export interface TitleProps extends HTMLAttributes<HTMLHeadingElement> {
  readonly level?: 1 | 2 | 3 | 4 | 5;
  readonly ellipsis?: boolean;
  readonly children?: ReactNode;
}

function Title({ level = 1, ellipsis, className, ...props }: TitleProps) {
  return createElement(`h${level}`, { ...props, className: ["ui-typography-title", ellipsis ? "ui-typography--ellipsis" : "", className].filter(Boolean).join(" ") });
}

export const Typography = { Title };
