import { Popover, type PopoverProps } from "../ui";
import { useCallback, useLayoutEffect, type ReactElement } from "react";

type ViewportAnchoredPopoverProps = PopoverProps & {
  children: ReactElement;
  onAlignerChange?: (aligner: VoidFunction | null) => void;
};

export function ViewportAnchoredPopover({ children, onAlignerChange, open, ...popoverProps }: ViewportAnchoredPopoverProps) {
  const forceAlign = useCallback(() => window.dispatchEvent(new Event("resize")), []);

  useLayoutEffect(() => {
    if (!open) return;
    forceAlign();
    onAlignerChange?.(forceAlign);
    return () => onAlignerChange?.(null);
  }, [forceAlign, onAlignerChange, open]);

  return (
    <Popover open={open} {...popoverProps}>
      {children}
    </Popover>
  );
}
