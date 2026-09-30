import { useEffect, useLayoutEffect, useRef, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";

import { useT } from "../../renderer/i18n";
import dexFlatInk from "../assets/dex/officedex-agent-flat-ink.svg";
import { FileIcon } from "../kit/Icon";
import { NEW_GROUPS, type NewType } from "../pages/fileRows";

/**
 * New — an anchored, grouped picker, not a dialog (OD-UI-1.2 §04, §18).
 *
 *   AI Chat      New chat
 *   ─────────────────────
 *   Local
 *     Office Documents   Document · Spreadsheet · Presentation
 *     More Documents     Plain text · Markdown · Rich text · HTML · PDF
 *     AI Create          AI image
 *
 * 360px wide with 24px padding, three columns, 32px icons over 14/20 labels.
 * It opens to the right of the New button and keeps 8px from every window
 * edge, scrolling inside itself when the window is short. No backdrop: a press
 * outside, Escape, moving focus away or choosing something closes it, and
 * Escape hands focus back to New. Blank space between the groups is part of
 * the picker, not "outside".
 *
 * AI Chat starts a blank conversation. Everything under Local opens a Local
 * editor and adds nothing to a conversation that happens to be open.
 */
export function NewPopover({
  anchor,
  onClose,
  onNewChat,
  onCreate,
}: {
  anchor: HTMLElement;
  onClose: (focusAnchor: boolean) => void;
  onNewChat: () => void;
  onCreate: (type: NewType) => void;
}) {
  const t = useT();
  const panel = useRef<HTMLElement>(null);

  useLayoutEffect(() => {
    const element = panel.current;
    if (!element) return;
    const place = () => {
      const rect = anchor.isConnected ? anchor.getBoundingClientRect() : null;
      const right = rect?.right ?? 132;
      const top = rect?.top ?? 40;
      element.style.left = `${Math.max(8, Math.min(right + 8, window.innerWidth - element.offsetWidth - 8))}px`;
      element.style.top = `${Math.max(8, Math.min(top, window.innerHeight - element.offsetHeight - 8))}px`;
    };
    place();
    element.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true });
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [anchor]);

  useEffect(() => {
    const outside = (target: EventTarget | null) =>
      !(target instanceof Node && (panel.current?.contains(target) || anchor.contains(target)));
    const onPointerDown = (event: PointerEvent) => {
      if (outside(event.target)) onClose(false);
    };
    const onFocusIn = (event: FocusEvent) => {
      if (outside(event.target)) onClose(false);
    };
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      onClose(true);
    };
    const onBlur = () => onClose(false);
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("blur", onBlur);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("blur", onBlur);
    };
  }, [anchor, onClose]);

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const step = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 3, ArrowUp: -3 }[event.key];
    if (step === undefined && event.key !== "Home" && event.key !== "End") return;
    const buttons = [...(panel.current?.querySelectorAll<HTMLButtonElement>("button") ?? [])];
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (index < 0) return;
    event.preventDefault();
    const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : index + (step ?? 0);
    buttons[Math.max(0, Math.min(buttons.length - 1, next))]?.focus();
  };

  const host = typeof document === "undefined" ? null : document.getElementById("dx-layers");
  if (!host) return null;

  return createPortal(
    <section
      ref={panel}
      id="dx-new-popover"
      className="dx-new-popover"
      role="dialog"
      aria-modal="false"
      aria-label={t("dx.nav.new")}
      onKeyDown={onKeyDown}
    >
      <section className="dx-new-ai-chat" aria-labelledby="dx-new-ai-title">
        <h2 id="dx-new-ai-title">{t("dx.new.aiChat")}</h2>
        <div className="dx-new-type-grid">
          <button type="button" data-act="start-ai-chat" aria-label={t("dx.new.aiChatAria")} onClick={onNewChat}>
            <img className="dx-new-chat-icon" src={dexFlatInk} alt="" />
            <span>{t("dx.new.newChat")}</span>
          </button>
        </div>
      </section>
      <section className="dx-new-local" aria-labelledby="dx-new-local-title">
        <h2 id="dx-new-local-title">{t("dx.nav.local")}</h2>
        {NEW_GROUPS.map((group, index) => (
          <section key={group.id} aria-labelledby={`dx-new-group-${index}`}>
            <h3 id={`dx-new-group-${index}`}>{t(group.labelKey)}</h3>
            <div className="dx-new-type-grid">
              {group.types.map((type) => (
                <button key={type} type="button" data-act="create-local" data-id={type} title={t(`dx.type.${type}`)} onClick={() => onCreate(type)}>
                  <FileIcon ext={type} size={32} />
                  <span>{t(`dx.type.${type}`)}</span>
                </button>
              ))}
            </div>
          </section>
        ))}
      </section>
    </section>,
    host,
  );
}
