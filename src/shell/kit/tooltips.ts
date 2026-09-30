/**
 * Name tips for controls that carry `data-tooltip` — OD-UI-1.2 §08, §17.
 *
 * Pointer: shown after about 500ms over the control, withdrawn when the
 * pointer leaves, on press, on scroll and on Escape. Keyboard: shown at once on
 * focus, withdrawn on blur. A tip is never the control's accessible name — the
 * control keeps its own `aria-label` — and never holds anything that has to be
 * clicked.
 *
 * One delegated listener set for the whole shell rather than a component per
 * control: the tip is a property of the element under the pointer, and the
 * elements that carry it (the nine Quick start types, the Logo tab) are plain
 * buttons in layouts that must not gain a wrapper.
 */

const DELAY_MS = 500;

export function mountTooltips(host: HTMLElement): () => void {
  let tip: HTMLDivElement | null = null;
  let target: HTMLElement | null = null;
  let pending: HTMLElement | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const hide = () => {
    clearTimeout(timer);
    pending = null;
    tip?.remove();
    tip = null;
    target?.removeAttribute("aria-describedby");
    target = null;
  };

  const show = (next: HTMLElement) => {
    if (next === target) return;
    hide();
    const text = next.dataset.tooltip;
    if (!text) return;
    target = next;
    tip = document.createElement("div");
    tip.id = "dx-control-tooltip";
    tip.setAttribute("role", "tooltip");
    tip.className = "dx-control-tooltip";
    tip.textContent = text;
    host.append(tip);
    next.setAttribute("aria-describedby", tip.id);
    const rect = next.getBoundingClientRect();
    const left = Math.max(
      8,
      Math.min(rect.left + (rect.width - tip.offsetWidth) / 2, window.innerWidth - tip.offsetWidth - 8),
    );
    const below = rect.bottom + 8 + tip.offsetHeight < window.innerHeight;
    tip.style.left = `${left}px`;
    tip.style.top = `${below ? rect.bottom + 8 : rect.top - tip.offsetHeight - 8}px`;
  };

  const closestTip = (node: EventTarget | null) =>
    node instanceof Element ? node.closest<HTMLElement>("[data-tooltip]") : null;

  const onPointerOver = (event: PointerEvent) => {
    const next = closestTip(event.target);
    if (!next) {
      hide();
      return;
    }
    if (next === target || next === pending) return;
    hide();
    pending = next;
    timer = setTimeout(() => {
      pending = null;
      if (next.isConnected && next.matches(":hover")) show(next);
    }, DELAY_MS);
  };
  const onPointerOut = (event: PointerEvent) => {
    const current = target || pending;
    if (current && !(event.relatedTarget instanceof Node && current.contains(event.relatedTarget))) hide();
  };
  const onFocusIn = (event: FocusEvent) => {
    const next = closestTip(event.target);
    if (next) show(next);
    else hide();
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") hide();
  };

  document.addEventListener("pointerover", onPointerOver);
  document.addEventListener("pointerout", onPointerOut);
  document.addEventListener("focusin", onFocusIn);
  document.addEventListener("focusout", hide);
  document.addEventListener("pointerdown", hide);
  document.addEventListener("keydown", onKeyDown);
  document.addEventListener("scroll", hide, true);
  window.addEventListener("blur", hide);
  window.addEventListener("resize", hide);

  return () => {
    hide();
    document.removeEventListener("pointerover", onPointerOver);
    document.removeEventListener("pointerout", onPointerOut);
    document.removeEventListener("focusin", onFocusIn);
    document.removeEventListener("focusout", hide);
    document.removeEventListener("pointerdown", hide);
    document.removeEventListener("keydown", onKeyDown);
    document.removeEventListener("scroll", hide, true);
    window.removeEventListener("blur", hide);
    window.removeEventListener("resize", hide);
  };
}
