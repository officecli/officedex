/**
 * The keyboard and pointer contract every `aria-modal` overlay in this library
 * owes the user, in one place.
 *
 * `Modal` used to declare `aria-modal="true"` and implement none of it: Escape
 * did nothing, the mask was decoration, Tab walked out of the dialog in four
 * presses and reached the button that closes the application window in five,
 * and closing the dialog dropped focus on `<body>`. The imperative `dialog`
 * handled Escape but nothing else. Two overlays, two different contracts, one
 * of them a lie — so both now go through this hook.
 *
 * Only the top-most open overlay reacts, which is what lets a confirm opened
 * from inside a modal close itself and leave the modal standing.
 */

import { useEffect, useRef } from "react";

const FOCUSABLE = [
  "a[href]",
  "area[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type=hidden])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "iframe",
  "[tabindex]:not([tabindex='-1'])",
  "[contenteditable='true']",
].join(",");

/** Open overlays, oldest first. The last entry owns Escape and Tab. */
const stack: symbol[] = [];

function focusable(panel: HTMLElement): HTMLElement[] {
  return Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE))
    .filter((element) => !element.hasAttribute("inert") && element.tabIndex !== -1 && !element.closest("[inert]"));
}

function trapTab(panel: HTMLElement, event: KeyboardEvent): void {
  const items = focusable(panel);
  const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  if (items.length === 0) {
    // Nothing to land on inside: keep the caret on the panel rather than let it
    // escape to the window controls behind the mask.
    event.preventDefault();
    panel.focus();
    return;
  }
  const first = items[0]!;
  const last = items[items.length - 1]!;
  if (!active || !panel.contains(active)) {
    event.preventDefault();
    (event.shiftKey ? last : first).focus();
    return;
  }
  if (!event.shiftKey && active === last) {
    event.preventDefault();
    first.focus();
    return;
  }
  if (event.shiftKey && active === first) {
    event.preventDefault();
    last.focus();
  }
}

export interface ModalBehaviourOptions {
  /** Whether the overlay is currently rendered. */
  readonly open: boolean;
  /** Escape, or a click on the mask. Leave undefined to refuse dismissal. */
  readonly onDismiss?: (() => void) | undefined;
  /** Escape closes. Default true. */
  readonly keyboard?: boolean;
}

export interface ModalBehaviour {
  /** Put this on the dialog panel. It must also carry `tabIndex={-1}`. */
  readonly panelRef: (node: HTMLElement | null) => void;
  /** Put this on the mask, so only a click on the mask itself dismisses. */
  readonly onMaskClick: (event: { target: EventTarget | null; currentTarget: EventTarget | null }) => void;
}

export function useModalBehaviour({ open, onDismiss, keyboard = true }: ModalBehaviourOptions): ModalBehaviour {
  const panel = useRef<HTMLElement | null>(null);
  // Read through refs: `onDismiss` is a fresh closure on every render, and an
  // effect that re-ran on it would re-capture the "focus came from here"
  // element as something inside the dialog.
  const dismiss = useRef(onDismiss);
  dismiss.current = onDismiss;
  const wantsKeyboard = useRef(keyboard);
  wantsKeyboard.current = keyboard;

  /*
   * Who to give the caret back to, captured while rendering rather than in the
   * effect below. React applies a field's `autoFocus` when it commits the DOM,
   * which is before any effect runs — and the shell's folder dialog does carry
   * one. Recorded from an effect, "what opened this" came out as the dialog's
   * own text field, and closing the dialog handed focus to a node that was
   * about to be removed, i.e. to `<body>`.
   */
  const opener = useRef<HTMLElement | null>(null);
  const wasOpen = useRef(false);
  if (open !== wasOpen.current) {
    wasOpen.current = open;
    if (open) opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  }

  useEffect(() => {
    if (!open) return;
    const token = Symbol("od-modal");
    stack.push(token);

    // A dialog that claims to be modal has to hold the caret, or the first Tab
    // continues from wherever the user was in the page behind it.
    const target = panel.current;
    if (target && !target.contains(document.activeElement)) (focusable(target)[0] ?? target).focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (stack[stack.length - 1] !== token || !panel.current) return;
      if (event.key === "Escape") {
        if (!wantsKeyboard.current || !dismiss.current) return;
        event.preventDefault();
        event.stopPropagation();
        dismiss.current();
        return;
      }
      if (event.key === "Tab") trapTab(panel.current, event);
    };
    document.addEventListener("keydown", onKeyDown, true);

    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      const index = stack.indexOf(token);
      if (index >= 0) stack.splice(index, 1);
      // Skipped when the opener has gone away with the interaction (a row that
      // was renamed out of existence): focusing a detached node silently lands
      // on `<body>`, which is the state this exists to avoid.
      const restore = opener.current;
      if (restore?.isConnected && !panel.current?.contains(restore)) restore.focus();
    };
  }, [open]);

  return {
    panelRef: (node) => { panel.current = node; },
    onMaskClick: (event) => {
      if (event.target !== event.currentTarget) return;
      dismiss.current?.();
    },
  };
}
