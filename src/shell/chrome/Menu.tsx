import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";

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
  /** Which trigger edge the panel lines up with. */
  align?: "start" | "end";
  width?: number;
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
export function Menu({ label, items, children, align = "start", width = 200 }: MenuProps) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
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

  useEffect(() => {
    if (!open) return;
    itemRefs.current[activeIndex]?.focus();
  }, [open, activeIndex]);

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

  return (
    <div className="shell-menu-anchor">
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

      {open ? (
        <div
          ref={panelRef}
          id={id}
          role="menu"
          aria-label={label}
          className="shell-menu"
          data-align={align}
          style={{ width }}
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
      ) : null}
    </div>
  );
}
