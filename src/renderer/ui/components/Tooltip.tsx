import { Children, cloneElement, isValidElement, useState, type ReactElement, type ReactNode } from "react";

export interface TooltipProps {
  readonly title?: ReactNode;
  readonly children: ReactElement;
  readonly placement?: "top" | "right" | "bottom" | "left";
  readonly open?: boolean;
  readonly onOpenChange?: (open: boolean) => void;
  readonly destroyOnHidden?: boolean;
}

export function Tooltip({ title, children, placement = "top", open, onOpenChange }: TooltipProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const visible = open ?? uncontrolledOpen;
  const setOpen = (next: boolean) => {
    if (open === undefined) setUncontrolledOpen(next);
    onOpenChange?.(next);
  };
  const child = Children.only(children);
  if (!isValidElement(child) || !title) return child;
  const props = child.props as Record<string, unknown>;
  return (
    <span className="ui-tooltip-anchor" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)} onFocus={() => setOpen(true)} onBlur={() => setOpen(false)}>
      {cloneElement(child, props)}
      {visible ? <span className="ui-tooltip" data-placement={placement} role="tooltip">{title}</span> : null}
    </span>
  );
}
