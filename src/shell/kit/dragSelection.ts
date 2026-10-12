/**
 * No text selection while a layout drag is under way (UX28-11).
 *
 * Dragging the floating conversation or the divider used to select the asset
 * titles, descriptions and composer text the pointer crossed. While a drag
 * holds, the whole document refuses selection and what was selected on the way
 * in is let go; releasing (or cancelling) gives selection back. Text in the
 * conversation stays selectable whenever nothing is being dragged.
 */
const DRAGGING = "dx-dragging";

export function holdTextSelection(): () => void {
  const root = document.documentElement;
  root.classList.add(DRAGGING);
  window.getSelection?.()?.removeAllRanges();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    root.classList.remove(DRAGGING);
  };
}
