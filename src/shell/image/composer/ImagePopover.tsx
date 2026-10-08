import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

import "./imagePopover.css";

/**
 * The panel an image tool opens: a model list, the size grid, the camera.
 *
 * Not a `Menu`. A menu is a list of commands that closes on the first pick;
 * the settings panel holds three independent choices and a pair of number
 * fields, and picking a ratio must not throw away the resolution the user is
 * about to pick next. So it is a non-modal dialog anchored to its button, with
 * the same placement rule as `Menu`: below when it fits, above when there is
 * more room there, clamped to the window on both axes.
 */

const EDGE = 10;
const GAP = 8;

export interface ImagePopoverProps {
  anchor: RefObject<HTMLElement | null>;
  title: string;
  width: number;
  onClose: (returnFocus: boolean) => void;
  children: ReactNode;
}

export function ImagePopover({ anchor, title, width, onClose, children }: ImagePopoverProps) {
  const panelRef = useRef<HTMLElement>(null);
  const [place, setPlace] = useState<{ left: number; top: number; maxHeight: number } | null>(null);

  /*
   * Measured after every render, not only on resize: turning the camera on
   * adds a summary chip above the tool strip, which moves the anchor down
   * while the panel is open, and a panel left where the anchor used to be
   * ends up on top of it.
   */
  const measureRef = useRef<() => void>(() => {});
  useLayoutEffect(() => {
    measureRef.current();
  });

  useLayoutEffect(() => {
    const measure = () => {
      const trigger = anchor.current;
      const panel = panelRef.current;
      if (!trigger || !panel) return;
      const rect = trigger.getBoundingClientRect();
      const panelWidth = Math.min(width, window.innerWidth - EDGE * 2);
      const natural = panel.scrollHeight + 2;
      const below = window.innerHeight - rect.bottom - GAP - EDGE;
      const above = rect.top - GAP - EDGE;
      const up = natural > below && above > below;
      const maxHeight = Math.max(140, up ? above : below);
      const height = Math.min(natural, maxHeight);
      const next = {
        left: Math.max(EDGE, Math.min(window.innerWidth - panelWidth - EDGE, rect.left)),
        top: up ? Math.max(EDGE, rect.top - GAP - height) : rect.bottom + GAP,
        maxHeight,
      };
      setPlace((current) =>
        current && current.left === next.left && current.top === next.top && current.maxHeight === next.maxHeight
          ? current
          : next,
      );
    };
    measureRef.current = measure;
    measure();
    window.addEventListener("resize", measure);
    // Capture: the composer can sit inside a scrolling panel.
    document.addEventListener("scroll", measure, true);
    return () => {
      window.removeEventListener("resize", measure);
      document.removeEventListener("scroll", measure, true);
    };
  }, [anchor, width]);

  // Focus moves into the panel so Escape and the arrow keys reach it.
  useEffect(() => {
    panelRef.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (panelRef.current?.contains(target) || anchor.current?.contains(target)) return;
      onClose(false);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [anchor, onClose]);

  const host = anchor.current?.closest<HTMLElement>("#shell") ?? document.body;

  return createPortal(
    <section
      ref={panelRef}
      className="shell-ig-popover"
      role="dialog"
      aria-label={title}
      tabIndex={-1}
      style={{
        width,
        left: place?.left ?? -9999,
        top: place?.top ?? -9999,
        maxHeight: place?.maxHeight,
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          onClose(true);
          return;
        }
        // A row of radio buttons steps with the arrows, as a radio group should.
        const target = event.target as HTMLElement;
        if (target.getAttribute("role") !== "radio") return;
        const step = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 }[event.key];
        if (!step) return;
        const group = target.closest('[role="radiogroup"]');
        if (!group) return;
        event.preventDefault();
        const radios = [...group.querySelectorAll<HTMLElement>('[role="radio"]')];
        const next = radios[(radios.indexOf(target) + step + radios.length) % radios.length];
        next.focus();
        next.click();
      }}
    >
      <header>
        <strong>{title}</strong>
        <button type="button" aria-label={`Close ${title.toLowerCase()}`} onClick={() => onClose(true)}>
          <X size={14} strokeWidth={1.8} aria-hidden="true" />
        </button>
      </header>
      {children}
    </section>,
    host,
  );
}
