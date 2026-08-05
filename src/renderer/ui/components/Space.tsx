import type { CSSProperties, HTMLAttributes, ReactNode } from "react";

type SpaceSize = number | "small" | "middle" | "large";
export interface SpaceProps extends HTMLAttributes<HTMLDivElement> {
  readonly direction?: "horizontal" | "vertical";
  readonly size?: SpaceSize | [SpaceSize, SpaceSize];
  readonly align?: CSSProperties["alignItems"];
  readonly wrap?: boolean;
  readonly children?: ReactNode;
}

function sizeValue(size: SpaceSize): number {
  if (typeof size === "number") return size;
  return size === "small" ? 8 : size === "large" ? 24 : 16;
}

function SpaceRoot({ direction = "horizontal", size = 8, align, wrap, className, style, ...props }: SpaceProps) {
  const [columnGap, rowGap] = Array.isArray(size) ? size.map(sizeValue) : [sizeValue(size), sizeValue(size)];
  return <div {...props} className={["ui-space", className].filter(Boolean).join(" ")} data-direction={direction} style={{ columnGap, rowGap, alignItems: align, flexWrap: wrap ? "wrap" : undefined, ...style }} />;
}

function Compact({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div {...props} className={["ui-space-compact", className].filter(Boolean).join(" ")} />;
}

export const Space = Object.assign(SpaceRoot, { Compact });
