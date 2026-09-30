/**
 * The workspace's temporary layers: menus, dialogs and the notice.
 *
 * OD-UI-1.2 §05 orders them content → sticky tools → Dex and floating panels →
 * menus and tips → modal, and §08 says a dialog is never stacked on another.
 * So there is one menu, one dialog and one notice at a time, each a slot rather
 * than a component a caller mounts: opening a second replaces the first, which
 * is also how the prototype behaves (`A.menu`, `A.modal`, `A.toast`).
 *
 * The slots are module state rendered by `<Layers />`, which lives inside the
 * provider stack — so a dialog's body can use the port and the shell state —
 * and inside `#shell`, where the tokens are declared.
 *
 * Nothing here is opened from a wrapper element. The trigger stays the plain
 * button the layout drew, which matters more than it sounds: the prototype's
 * rows are two- and three-column grids of direct children, and a wrapper around
 * the "more" button would be a fourth child.
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useSyncExternalStore,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";

import { useT } from "../../renderer/i18n";
import { Icon } from "./Icon";

/* -------------------------------------------------------------------- store */

export interface MenuEntry {
  label: string;
  onSelect: () => void;
  /** Shown right-aligned, e.g. "⌘S". */
  shortcut?: string;
  disabled?: boolean;
  /** Present on a choice; the row becomes a radio item and shows a check when true. */
  checked?: boolean;
  /** A leading element, e.g. a file icon in the @-mention list. */
  leading?: ReactNode;
}

export type MenuItem = MenuEntry | "-";

interface MenuRequest {
  anchor: HTMLElement;
  items: MenuItem[];
  /** `above` anchors the panel over a composer, for the @-mention list. */
  side: "below" | "above";
  role: "menu" | "listbox";
  label?: string;
  className?: string;
  /** False for the @-mention list: typing continues in the composer. */
  takeFocus: boolean;
  emptyText?: string;
}

export interface ModalRequest {
  title: string;
  /** `wide` is 920px; anything else is a dialog-specific width from the stylesheet. */
  className?: string;
  /** `close` dismisses the dialog and returns focus to whatever opened it. */
  render: (close: () => void) => ReactNode;
  /** Escape and the close button are refused while this is true (a submit in flight). */
  busy?: boolean;
  onClose?: () => void;
}

interface LayerState {
  menu: MenuRequest | null;
  modal: (ModalRequest & { returnFocus: Element | null }) | null;
  notice: { text: string; id: number } | null;
}

let state: LayerState = { menu: null, modal: null, notice: null };
const listeners = new Set<() => void>();
let noticeTimer: ReturnType<typeof setTimeout> | undefined;
let noticeSeq = 0;

function set(next: Partial<LayerState>) {
  state = { ...state, ...next };
  listeners.forEach((listener) => listener());
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
const snapshot = () => state;

/** A popup's trigger shows its open state, and only while the popup is open (§17). */
function markTrigger(element: Element | null, open: boolean, popup: "menu" | "dialog") {
  if (!(element instanceof HTMLButtonElement)) return;
  element.dataset.popupOpen = String(open);
  element.setAttribute("aria-expanded", String(open));
  element.setAttribute("aria-haspopup", popup);
}

export function openMenu(
  anchor: HTMLElement,
  items: MenuItem[],
  options: Partial<Pick<MenuRequest, "side" | "role" | "label" | "className" | "takeFocus" | "emptyText">> = {},
) {
  if (state.menu) markTrigger(state.menu.anchor, false, "menu");
  markTrigger(anchor, true, "menu");
  set({
    menu: {
      anchor,
      items,
      side: options.side ?? "below",
      role: options.role ?? "menu",
      takeFocus: options.takeFocus ?? true,
      ...(options.label ? { label: options.label } : {}),
      ...(options.className ? { className: options.className } : {}),
      ...(options.emptyText ? { emptyText: options.emptyText } : {}),
    },
  });
}

export function closeMenu(focusAnchor = false) {
  const current = state.menu;
  if (!current) return;
  markTrigger(current.anchor, false, "menu");
  set({ menu: null });
  if (focusAnchor && current.anchor.isConnected) current.anchor.focus();
}

export const menuIsOpen = () => state.menu !== null;

export function openModal(request: ModalRequest) {
  closeMenu();
  const active = typeof document === "undefined" ? null : document.activeElement;
  // Replacing the dialog's content keeps the element that opened the first one.
  const returnFocus = state.modal ? state.modal.returnFocus : active;
  if (!state.modal) markTrigger(returnFocus, true, "dialog");
  set({ modal: { ...request, returnFocus } });
}

export function closeModal() {
  const current = state.modal;
  if (!current) return;
  markTrigger(current.returnFocus, false, "dialog");
  // Closed before focus is handed back: while a dialog is modal everything
  // outside it is inert, and focusing the opener then does nothing at all.
  const element = typeof document === "undefined" ? null : document.getElementById("dx-modal");
  if (element instanceof HTMLDialogElement && element.open && typeof element.close === "function") element.close();
  set({ modal: null });
  current.onClose?.();
  if (current.returnFocus instanceof HTMLElement && current.returnFocus.isConnected) current.returnFocus.focus();
}

export const modalIsOpen = () => state.modal !== null;

/**
 * Renames the open dialog, and says whether it can be dismissed.
 *
 * For a dialog that follows something through its stages — checking, then
 * found, then downloading — and is one dialog throughout rather than three
 * opened in turn.
 */
export function retitleModal(title: string, busy = false) {
  const current = state.modal;
  if (!current || (current.title === title && (current.busy === true) === busy)) return;
  set({ modal: { ...current, title, busy } });
}

/** A short, self-dismissing confirmation. A failure that needs action is not one of these (§08). */
export function notice(text: string) {
  clearTimeout(noticeTimer);
  noticeSeq += 1;
  set({ notice: { text, id: noticeSeq } });
  noticeTimer = setTimeout(() => set({ notice: null }), 3200);
}

/** Test seam: a fresh slate between renders. */
export function resetLayers() {
  clearTimeout(noticeTimer);
  state = { menu: null, modal: null, notice: null };
  listeners.forEach((listener) => listener());
}

/* --------------------------------------------------------------- components */

function MenuLayer({ request }: { request: MenuRequest }) {
  const panel = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const element = panel.current;
    if (!element) return;
    const place = () => {
      const rect = request.anchor.getBoundingClientRect();
      const left = Math.max(8, Math.min(rect.left, window.innerWidth - element.offsetWidth - 8));
      const top =
        request.side === "above"
          ? Math.max(8, rect.top - element.offsetHeight - 12)
          : Math.max(8, Math.min(rect.bottom + 4, window.innerHeight - element.offsetHeight - 8));
      element.style.left = `${left}px`;
      element.style.top = `${top}px`;
    };
    place();
    if (request.takeFocus) element.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [request]);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (panel.current?.contains(target) || request.anchor.contains(target)) return;
      closeMenu();
    };
    const onBlur = () => closeMenu();
    // A menu belongs to the control that opened it. When that control is
    // scrolled away the menu goes with it, rather than staying open over
    // whatever has moved underneath. Scrolling the menu's own list is not that.
    const onScroll = (event: Event) => {
      if (event.target instanceof Node && panel.current?.contains(event.target)) return;
      closeMenu();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("scroll", onScroll, true);
    window.addEventListener("blur", onBlur);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("blur", onBlur);
    };
  }, [request]);

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const buttons = [...(panel.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [])];
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      buttons[(index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length]?.focus();
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      buttons[event.key === "Home" ? 0 : buttons.length - 1]?.focus();
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeMenu(true);
    } else if (event.key === "Tab") {
      closeMenu();
    }
  };

  const itemRole = request.role === "listbox" ? "option" : "menuitem";

  return (
    <div
      ref={panel}
      className={request.className ? `dx-menu ${request.className}` : "dx-menu"}
      role={request.role}
      aria-label={request.label}
      onKeyDown={onKeyDown}
    >
      {request.items.length === 0 && request.emptyText ? <p>{request.emptyText}</p> : null}
      {request.items.map((item, index) =>
        item === "-" ? (
          <hr key={`separator-${index}`} />
        ) : (
          <button
            key={`${item.label}-${index}`}
            type="button"
            role={item.checked === undefined ? itemRole : "menuitemradio"}
            aria-checked={item.checked}
            disabled={item.disabled}
            onClick={() => {
              closeMenu(request.takeFocus);
              item.onSelect();
            }}
          >
            {item.leading}
            {item.leading ? <span className="dx-ellipsis">{item.label}</span> : item.label}
            {item.shortcut ? <span className="dx-key">{item.shortcut}</span> : null}
            {item.checked ? (
              <span className="dx-selection-mark" aria-hidden="true">
                <Icon name="Check" />
              </span>
            ) : null}
          </button>
        ),
      )}
    </div>
  );
}

function ModalLayer({ request }: { request: NonNullable<LayerState["modal"]> }) {
  const t = useT();
  const dialog = useRef<HTMLDialogElement>(null);
  const busy = request.busy === true;

  useLayoutEffect(() => {
    const element = dialog.current;
    if (!element) return;
    // jsdom has no `showModal`; the attribute keeps the dialog in the tree.
    if (!element.open) {
      if (typeof element.showModal === "function") element.showModal();
      else element.setAttribute("open", "");
    }
  }, []);

  // Focus goes to the first thing the user is here to do, once per dialog.
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    const frame = requestAnimationFrame(() => {
      const target =
        element.querySelector<HTMLElement>("[autofocus]") ??
        element.querySelector<HTMLElement>("input:not([type=checkbox]):not([type=hidden]),textarea") ??
        element.querySelector<HTMLElement>("[data-act=modal-close]");
      target?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [request.title]);

  const onCancel = useCallback(
    (event: { preventDefault: () => void }) => {
      // The native cancel would close the element behind React's back.
      event.preventDefault();
      if (!busy) closeModal();
    },
    [busy],
  );

  return (
    <dialog
      ref={dialog}
      id="dx-modal"
      data-ui-scope="officedex"
      className={request.className ? prefixClasses(request.className) : undefined}
      aria-labelledby="dx-modal-title"
      data-busy={String(busy)}
      onCancel={onCancel}
    >
      <header className="dx-modal-head">
        <h2 id="dx-modal-title">{request.title}</h2>
        <button
          type="button"
          className="dx-ib"
          aria-label={t("dx.dialog.close")}
          title={t("dx.dialog.close")}
          data-act="modal-close"
          disabled={busy}
          onClick={closeModal}
        >
          <Icon name="X" />
        </button>
      </header>
      <div className="dx-modal-body">{request.render(closeModal)}</div>
    </dialog>
  );
}

const prefixClasses = (names: string) =>
  names
    .split(/\s+/)
    .filter(Boolean)
    .map((name) => (name.startsWith("dx-") ? name : `dx-${name}`))
    .join(" ");

/**
 * The layer hosts. Rendered once, by `App`, as the last children of `#shell`.
 */
export function Layers() {
  const { menu, modal, notice: current } = useSyncExternalStore(subscribe, snapshot, snapshot);

  // A menu left open by a view that went away would point at nothing.
  useEffect(() => {
    if (menu && !menu.anchor.isConnected) closeMenu();
  });

  return (
    <>
      <div id="dx-layers" data-ui-scope="officedex">
        {menu ? <MenuLayer request={menu} /> : null}
      </div>
      {modal ? <ModalLayer key="modal" request={modal} /> : null}
      <div
        id="dx-notice"
        data-ui-scope="officedex"
        role="status"
        aria-live="polite"
        className={current ? "dx-visible" : undefined}
      >
        {current?.text ?? ""}
      </div>
    </>
  );
}
