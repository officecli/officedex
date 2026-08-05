import { Children, cloneElement, isValidElement, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactElement, type ReactNode } from "react";
import { createPortal } from "react-dom";

export interface PopoverProps {
  readonly content: ReactNode;
  readonly children: ReactElement;
  readonly open?: boolean;
  readonly placement?: "top" | "right" | "bottom" | "left";
  readonly onOpenChange?: (open: boolean) => void;
  readonly trigger?: "click" | "hover" | readonly ("click" | "hover")[];
  readonly overlayClassName?: string;
  readonly arrow?: boolean | { pointAtCenter?: boolean };
  readonly forceRender?: boolean;
  readonly autoAdjustOverflow?: boolean;
}

function placementStyle(anchor: DOMRect, panel: DOMRect, placement: NonNullable<PopoverProps["placement"]>): CSSProperties {
  const gap = 8;
  const viewportWidth = document.documentElement.clientWidth;
  const viewportHeight = document.documentElement.clientHeight;
  let left = anchor.left;
  let top = anchor.bottom + gap;
  if (placement === "top") top = anchor.top - panel.height - gap;
  if (placement === "right") { left = anchor.right + gap; top = anchor.top; }
  if (placement === "left") { left = anchor.left - panel.width - gap; top = anchor.top; }
  left = Math.max(8, Math.min(left, viewportWidth - panel.width - 8));
  top = Math.max(8, Math.min(top, viewportHeight - panel.height - 8));
  return { left, top };
}

export function Popover({ content, children, open, placement = "bottom", onOpenChange, trigger = ["click"], overlayClassName, forceRender = false }: PopoverProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const [style, setStyle] = useState<CSSProperties>({ visibility: "hidden" });
  const anchorRef = useRef<HTMLElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const visible = open ?? uncontrolledOpen;
  const mounted = visible || forceRender;
  const triggerModes = Array.isArray(trigger) ? trigger : [trigger];

  const setVisible = (next: boolean) => {
    if (open === undefined) setUncontrolledOpen(next);
    onOpenChange?.(next);
  };

  useLayoutEffect(() => {
    if (!visible || !anchorRef.current || !panelRef.current) return;
    const update = () => {
      if (!anchorRef.current || !panelRef.current) return;
      setStyle(placementStyle(anchorRef.current.getBoundingClientRect(), panelRef.current.getBoundingClientRect(), placement));
    };
    update();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    observer?.observe(anchorRef.current);
    observer?.observe(panelRef.current);
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
      observer?.disconnect();
    };
  }, [placement, visible]);

  useEffect(() => {
    if (!visible) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") setVisible(false);
    };
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  });

  const child = Children.only(children);
  if (!isValidElement(child)) return null;
  const childProps = child.props as { onClick?: (event: React.MouseEvent) => void };
  const triggerElement = cloneElement(child, {
    ref: (node: HTMLElement | null) => { anchorRef.current = node; },
    "aria-expanded": visible,
    onClick: (event: React.MouseEvent) => {
      childProps.onClick?.(event);
      if (!event.defaultPrevented && triggerModes.includes("click")) setVisible(!visible);
    },
  } as Record<string, unknown>);

  return (
    <>
      {triggerElement}
      {mounted ? createPortal(
        <div
          className={["ui-popover", overlayClassName].filter(Boolean).join(" ")}
          data-open={visible ? "true" : "false"}
          ref={panelRef}
          role="dialog"
          style={visible ? style : { left: -10000, opacity: 0, pointerEvents: "none", top: -10000 }}
        >{content}</div>,
        document.body,
      ) : null}
    </>
  );
}
