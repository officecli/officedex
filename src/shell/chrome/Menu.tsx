import {
  forwardRef,
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

import "./menu.css";

export interface MenuItemSpec {
  id: string;
  label: string;
  icon?: ReactNode;
  description?: string;
  /** Present on a choice; makes the row a radio so its state is announced. */
  checked?: boolean;
  disabled?: boolean;
  onSelect: () => void;
}

/**
 * For openers that are not the trigger — a right-click on the row the menu
 * belongs to, or F2 on it. The panel still anchors to the trigger rather than
 * to the pointer: a menu that appears under the cursor has to be positioned
 * against the viewport by hand, and this way the same menu appears in the same
 * place however it was asked for.
 */
export interface MenuHandle {
  open: () => void;
  close: () => void;
}

export interface MenuProps {
  label: string;
  items: MenuItemSpec[];
  /** Rendered as the trigger. The props must be spread onto a focusable element. */
  children: (props: {
    ref: (node: HTMLButtonElement | null) => void;
    onClick: () => void;
    onKeyDown: (event: React.KeyboardEvent) => void;
    "aria-haspopup": "menu";
    "aria-expanded": boolean;
    "aria-controls": string;
  }) => ReactNode;
  /**
   * The trigger edge the panel *prefers* to line up with.
   *
   * It is a preference, not a constraint. It used to be the whole placement
   * story — `data-align="start"` meant `left: 0`, `end` meant `right: 0`, and
   * whether a menu landed on screen depended on the call site guessing right.
   * `FileTabs.tsx` omitted it, got the `start` default, and opened 146px off the
   * right edge of the window. Now the preferred edge is tried first and the
   * other one is used when it does not fit, so omitting it costs nothing.
   */
  align?: "start" | "end";
  width?: number;
}

/** Clearance kept between the panel and the window edge, on all four sides. */
const VIEWPORT_EDGE = 8;
/** Trigger-to-panel gap. Was `top: calc(100% + 6px)` in CSS. */
const ANCHOR_GAP = 6;
/** The panel never grows past this, however much room there is. */
const MAX_HEIGHT = 340;

interface Placement {
  left: number;
  top: number;
  width: number;
  maxHeight: number;
  side: "above" | "below";
}

/**
 * The part of `node` that is actually on screen, after every ancestor that
 * clips has had its say.
 *
 * Used for one decision only: whether the thing the panel is anchored to is
 * still visible. A menu pinned to a row that has been scrolled out of the
 * sidebar would otherwise float over unrelated content.
 */
function visibleBox(node: HTMLElement) {
  const rect = node.getBoundingClientRect();
  let left = rect.left;
  let top = rect.top;
  let right = rect.right;
  let bottom = rect.bottom;
  for (let parent = node.parentElement; parent; parent = parent.parentElement) {
    const style = getComputedStyle(parent);
    if (
      style.overflow === "visible" &&
      style.overflowX === "visible" &&
      style.overflowY === "visible"
    ) {
      continue;
    }
    const bounds = parent.getBoundingClientRect();
    left = Math.max(left, bounds.left);
    top = Math.max(top, bounds.top);
    right = Math.min(right, bounds.right);
    bottom = Math.min(bottom, bounds.bottom);
  }
  return { left, top, right, bottom };
}

/**
 * Four-edge collision against the viewport.
 *
 * Vertically: open downwards, flip up when downwards cannot hold the panel and
 * upwards has more room. Horizontally: try the preferred edge, then the other
 * edge, then clamp. `max-height` is `min(340, room)` rather than a flat 340 —
 * the old constant is what put the Home scope menu 1px past the bottom of a
 * 720px window (S2-006 / S3-015).
 */
function computePlacement(
  anchor: DOMRect,
  panel: HTMLElement,
  width: number,
  align: "start" | "end",
): Placement {
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const panelWidth = Math.min(width, Math.max(0, viewportWidth - VIEWPORT_EDGE * 2));

  // scrollHeight is content + padding; the 1px border on each edge is not in it.
  const natural = panel.scrollHeight + 2;
  const roomBelow = viewportHeight - anchor.bottom - ANCHOR_GAP - VIEWPORT_EDGE;
  const roomAbove = anchor.top - ANCHOR_GAP - VIEWPORT_EDGE;
  const side: "above" | "below" =
    natural <= roomBelow || roomBelow >= roomAbove ? "below" : "above";
  const maxHeight = Math.max(0, Math.min(MAX_HEIGHT, side === "below" ? roomBelow : roomAbove));
  const height = Math.min(natural, maxHeight);

  let top = side === "below" ? anchor.bottom + ANCHOR_GAP : anchor.top - ANCHOR_GAP - height;
  top = Math.max(VIEWPORT_EDGE, Math.min(top, viewportHeight - VIEWPORT_EDGE - height));

  const preferred = align === "end" ? anchor.right - panelWidth : anchor.left;
  const alternate = align === "end" ? anchor.left : anchor.right - panelWidth;
  const fits = (x: number) => x >= VIEWPORT_EDGE && x + panelWidth <= viewportWidth - VIEWPORT_EDGE;
  let left = fits(preferred) ? preferred : fits(alternate) ? alternate : preferred;
  left = Math.max(VIEWPORT_EDGE, Math.min(left, viewportWidth - VIEWPORT_EDGE - panelWidth));

  return { left, top, width: panelWidth, maxHeight, side };
}

/**
 * The shell's one menu primitive.
 *
 * `@vo-ui`'s Dropdown is reused elsewhere, but its Popover only closes on
 * Escape: there is no roving focus, so arrow keys do nothing. Menus are a
 * load-bearing control in this IA — the mode switch, folder choice, model
 * choice and per-file actions are all menus — so the keyboard behaviour is
 * implemented once here rather than patched at four call sites.
 */
export const Menu = forwardRef<MenuHandle, MenuProps>(function Menu(
  { label, items, children, align = "start", width = 200 },
  ref,
) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [placement, setPlacement] = useState<Placement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const anchorRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const enabled = items.filter((item) => !item.disabled);

  const close = useCallback((focusTrigger: boolean) => {
    setOpen(false);
    if (focusTrigger) triggerRef.current?.focus();
  }, []);

  const openAt = useCallback(
    (edge: "checked" | "first" | "last") => {
      const index =
        edge === "last"
          ? items.length - 1
          : edge === "first"
            ? items.findIndex((item) => !item.disabled)
            : Math.max(
                0,
                items.findIndex((item) => item.checked),
              );
      setActiveIndex(index < 0 ? 0 : index);
      setOpen(true);
    },
    [items],
  );

  useImperativeHandle(
    ref,
    () => ({
      open: () => openAt("first"),
      close: () => close(false),
    }),
    [openAt, close],
  );

  useEffect(() => {
    if (!open) return;
    itemRefs.current[activeIndex]?.focus();
  }, [open, activeIndex]);

  /**
   * Measure, place, and keep placed.
   *
   * Runs in a layout effect so the corrected position is committed before the
   * browser paints: the panel is never seen at the (0, 0) it first renders at.
   *
   * On scroll the panel is *repositioned*, not closed. It used to follow its
   * anchor for free — it was an absolutely positioned child of it — and closing
   * on scroll would be a new behaviour, not a restored one: the folder menu is
   * opened by right-clicking a row, and a user who then nudges the sidebar to
   * see the rest of it would lose the menu they just asked for. Following stops
   * where following stops making sense — once the anchor itself has been
   * scrolled out of its container, the menu closes rather than hover over
   * whatever is now in that spot (S2-007).
   */
  useLayoutEffect(() => {
    if (!open) {
      setPlacement(null);
      return;
    }

    const reposition = () => {
      const panel = panelRef.current;
      const anchor = anchorRef.current;
      if (!panel || !anchor) return;

      const box = visibleBox(anchor);
      if (box.right < box.left - 0.5 || box.bottom < box.top - 0.5) {
        close(false);
        return;
      }

      /*
       * The wrapper is the anchor, never the trigger.
       *
       * That is exactly what the old CSS measured against — `top: calc(100% +
       * 6px)` and `left: 0` / `right: 0` resolved against this box — so the
       * placement code is a port of the anchoring rather than a change to it.
       *
       * It also has to be the wrapper: the row action triggers
       * (`.shell-tree-folder-add`, `.shell-tree-file-more`) are `display: none`
       * until their row is hovered, and the menu outlives the hover. Anchoring
       * to the trigger made an open panel jump 28px sideways and 44px up the
       * moment the pointer left its row — or, on the collapsed rail where the
       * trigger is permanently hidden and the menu is opened by right-click,
       * gave a zero rect at the origin.
       */
      setPlacement(computePlacement(anchor.getBoundingClientRect(), panel, width, align));
    };

    reposition();
    window.addEventListener("resize", reposition);
    // Capture: the scrollers that move a trigger are the sidebar body and the
    // task panel, and scroll does not bubble.
    window.addEventListener("scroll", reposition, true);
    return () => {
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [open, align, width, items.length, close]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (panelRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [open]);

  const move = (delta: number) => {
    if (enabled.length === 0) return;
    let next = activeIndex;
    for (let step = 0; step < items.length; step += 1) {
      next = (next + delta + items.length) % items.length;
      if (!items[next].disabled) break;
    }
    setActiveIndex(next);
  };

  /**
   * Where the panel is rendered.
   *
   * `#shell` rather than `document.body`: both the `--shell-*` tokens and the
   * `--od-*` bridge are declared on `#shell` (tokens.css), and the type stack
   * comes from `.shell`, which is the same element. A panel on `document.body`
   * inherits none of it. `#shell` is `position: absolute; inset: 0`, so a
   * `position: fixed` child of it is out of flow — it adds nothing to the
   * shell's flex column — and none of the five `overflow: hidden` ancestors
   * that used to cut these panels is between the two any more.
   *
   * `closest` rather than `getElementById` so a second shell in a test is not
   * captured by the first. `document.body` is the fallback for a Menu mounted
   * outside a shell at all.
   */
  const portalHost =
    anchorRef.current?.closest<HTMLElement>("#shell") ??
    (typeof document === "undefined" ? null : document.body);

  const panel = (
    <div
      ref={panelRef}
      id={id}
      role="menu"
      aria-label={label}
      className="shell-menu"
      data-align={align}
      data-side={placement?.side ?? "below"}
      style={{
        width: placement?.width ?? width,
        left: placement?.left ?? 0,
        top: placement?.top ?? 0,
        maxHeight: placement?.maxHeight,
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          close(true);
          return;
        }
        if (event.key === "Tab") {
          close(false);
          return;
        }
        if (event.key === "ArrowDown") {
          event.preventDefault();
          move(1);
        } else if (event.key === "ArrowUp") {
          event.preventDefault();
          move(-1);
        } else if (event.key === "Home") {
          event.preventDefault();
          setActiveIndex(items.findIndex((item) => !item.disabled));
        } else if (event.key === "End") {
          event.preventDefault();
          setActiveIndex(items.length - 1);
        }
      }}
    >
      {items.map((item, index) => (
        <button
          key={item.id}
          type="button"
          ref={(node) => {
            itemRefs.current[index] = node;
          }}
          role={item.checked === undefined ? "menuitem" : "menuitemradio"}
          aria-checked={item.checked}
          aria-disabled={item.disabled || undefined}
          disabled={item.disabled}
          tabIndex={index === activeIndex ? 0 : -1}
          className="shell-menu-item"
          onClick={() => {
            close(true);
            item.onSelect();
          }}
        >
          {item.icon ? <span className="shell-menu-icon">{item.icon}</span> : null}
          <span className="shell-menu-label">
            {item.label}
            {item.description ? <small>{item.description}</small> : null}
          </span>
          {item.checked ? <span className="shell-menu-check" aria-hidden="true" /> : null}
        </button>
      ))}
    </div>
  );

  return (
    <div className="shell-menu-anchor" ref={anchorRef}>
      {children({
        ref: (node) => {
          triggerRef.current = node;
        },
        onClick: () => (open ? close(true) : openAt("checked")),
        onKeyDown: (event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            openAt(event.key === "ArrowDown" ? "first" : "last");
          }
        },
        "aria-haspopup": "menu",
        "aria-expanded": open,
        "aria-controls": id,
      })}

      {/* The portal keeps React's event tree intact — a click on an item still
          bubbles to whatever wraps this Menu — while leaving the DOM subtree
          that was clipping it. */}
      {open && portalHost ? createPortal(panel, portalHost) : null}
    </div>
  );
});
