import { AttentionOverlay } from "../agent/attentionOverlay";

/**
 * The colour glow on a focused text input — ATTENTION-STANDARD §03.
 *
 * Whenever an editable text field in the OfficeDex outer UI takes focus, by
 * click or by Tab, the 1.0 attention border lights around it at once and goes
 * out when focus leaves. It is the same recipe the agent's attention border
 * uses — the four-stop gradient, the stroke stack, the two lights travelling
 * the edge every 3600ms — and it replaces the single-colour focus ring for
 * text inputs only. Buttons keep their ordinary focus outline.
 *
 * A composite input is framed whole: the composer and a search box light
 * around their container, and the textarea or input inside draws no ring of
 * its own. A plain field is framed by itself, without its label.
 *
 * What it never does: read a field's value, light a disabled, read-only or
 * hidden field, treat a checkbox or a button as a text input, or take a
 * pointer event. The overlay is a view-only sibling on top of the page.
 *
 * Editors are not touched from here. A field inside a mounted editor belongs to
 * that editor (SHIMO-BOUNDARY); this listens on the document, but only lights
 * fields inside a `[data-ui-scope="officedex"]` region.
 */

const TEXT_FIELD =
  "textarea,input:not([type=checkbox]):not([type=radio]):not([type=button]):not([type=submit]):not([type=file]):not([type=range]):not([type=color]):not([type=hidden]),[role=textbox][contenteditable=true]";

/** The container a composite input is framed by. */
const COMPOSITE = ".dx-composer,.dx-search";

function isTextField(element: Element | null): element is HTMLElement {
  if (!(element instanceof HTMLElement) || !element.matches(TEXT_FIELD)) return false;
  const field = element as HTMLInputElement;
  if (field.disabled || field.readOnly) return false;
  return element.closest('[data-ui-scope="officedex"]') !== null;
}

export function mountInputGlow(reducedMotion: () => boolean): () => void {
  let field: HTMLElement | null = null;
  let target: HTMLElement | null = null;
  let layer: HTMLDivElement | null = null;
  let glow: AttentionOverlay | null = null;
  let frame: number | undefined;

  const clear = () => {
    if (frame !== undefined) cancelAnimationFrame(frame);
    frame = undefined;
    glow?.dispose();
    layer?.remove();
    target?.classList.remove("dx-od-color-focus");
    field = target = layer = glow = null;
  };

  // Every frame: a pane being resized, a floating panel being dragged and a
  // scrolled list all move the field without telling anyone.
  const position = () => {
    if (!field?.isConnected || document.activeElement !== field || !target || !layer || !glow) {
      clear();
      return;
    }
    if (target.getClientRects().length === 0) {
      clear();
      return;
    }
    const rect = target.getBoundingClientRect();
    Object.assign(layer.style, {
      left: `${rect.left}px`,
      top: `${rect.top}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
    });
    glow.setReducedMotion(reducedMotion());
    glow.focus({
      left: 0,
      top: 0,
      width: rect.width,
      height: rect.height,
      radius: parseFloat(getComputedStyle(target).borderTopLeftRadius) || 0,
    });
    frame = requestAnimationFrame(position);
  };

  const sync = () => {
    const next = document.activeElement;
    if (next === field) return;
    clear();
    if (!isTextField(next)) return;
    field = next;
    target = next.closest<HTMLElement>(COMPOSITE) ?? next;
    target.classList.add("dx-od-color-focus");
    layer = document.createElement("div");
    layer.className = "dx-od-input-glow";
    layer.setAttribute("aria-hidden", "true");
    // Inside the dialog when there is one: a modal is in the top layer, and
    // anything outside it would be drawn underneath.
    (next.closest("dialog") ?? document.getElementById("shell") ?? document.body).append(layer);
    glow = new AttentionOverlay(layer);
    position();
  };

  const onFocusOut = () => queueMicrotask(sync);
  document.addEventListener("focusin", sync);
  document.addEventListener("focusout", onFocusOut);
  sync();

  return () => {
    document.removeEventListener("focusin", sync);
    document.removeEventListener("focusout", onFocusOut);
    clear();
  };
}
