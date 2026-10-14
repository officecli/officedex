import { useEffect, useRef, type KeyboardEvent, type PointerEvent } from "react";

import { useT } from "../../renderer/i18n";
import { holdTextSelection } from "../kit/dragSelection";
import { useShell } from "../state/ShellContext";
import { NAV_KEYBOARD_STEP, NAV_WIDTH, navMaxWidth } from "../state/shellReducer";

/**
 * The sidebar's right edge — 1.0.12 UI-03.
 *
 * An 8px hit area with no resting line; hover, focus and dragging draw a 1px
 * one. Dragging widens the sidebar up to 480px (less in a window that would
 * keep under 520px beside it). Dragging left stops at 244px, and asking for
 * less than 180px hides it outright — there is no narrower expanded sidebar.
 * Hidden, the edge is a 6px strip at the window's left that drags it back out.
 * Escape, a cancelled pointer or the window losing focus put back the width
 * and visibility the drag started from; a drag that hides the sidebar keeps the
 * width it had, which is what showing it again brings back.
 *
 * Only `--dx-sidebar-width` changes while dragging, so the editor beside it is
 * resized, never reloaded, and keeps its focus and unsaved work (UI-04).
 *
 * `onResizing` lets the shell stop embedded editors from swallowing the
 * pointer while the drag crosses them.
 */
export function SidebarResizer({ onResizing }: { onResizing: (active: boolean) => void }) {
  const t = useT();
  const { state, dispatch } = useShell();
  const drag = useRef<{
    pointerId: number;
    handle: HTMLDivElement;
    x: number;
    width: number;
    saved: { width: number; collapsed: boolean };
    release: () => void;
  } | null>(null);

  const max = () => navMaxWidth(window.innerWidth);
  const width = state.navCollapsed ? 0 : Math.min(state.navWidth, max());

  const end = (cancel: boolean) => {
    const current = drag.current;
    if (!current) return;
    drag.current = null;
    dispatch(cancel ? { type: "restore-nav", ...current.saved } : { type: "finish-nav-drag", startWidth: current.saved.width });
    if (current.handle.hasPointerCapture(current.pointerId)) current.handle.releasePointerCapture(current.pointerId);
    current.release();
    onResizing(false);
  };
  const endRef = useRef(end);
  endRef.current = end;

  useEffect(() => {
    const onBlur = () => endRef.current(true);
    window.addEventListener("blur", onBlur);
    // A sidebar edge that goes away mid-drag must not leave the app unselectable.
    return () => {
      window.removeEventListener("blur", onBlur);
      drag.current?.release();
    };
  }, []);

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.focus();
    drag.current = {
      pointerId: event.pointerId,
      handle: event.currentTarget,
      x: event.clientX,
      width,
      saved: { width: state.navWidth, collapsed: state.navCollapsed },
      release: holdTextSelection(),
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    onResizing(true);
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    dispatch({ type: "resize-nav", width: current.width + event.clientX - current.x, max: max() });
  };

  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (drag.current?.pointerId !== event.pointerId) return;
    end(false);
    // Hidden by the drag: the switch is where the sidebar comes back from.
    if (state.navCollapsed) document.querySelector<HTMLElement>("#dx-global-controls [data-act=toggle-sidebar]")?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape" && drag.current) {
      event.preventDefault();
      end(true);
      return;
    }
    if (!["ArrowLeft", "ArrowRight", "Home", "End", "Enter"].includes(event.key)) return;
    event.preventDefault();
    const step = event.shiftKey ? NAV_KEYBOARD_STEP * 2 : NAV_KEYBOARD_STEP;
    if ((event.key === "ArrowLeft" && width <= NAV_WIDTH) || (event.key === "Enter" && !state.navCollapsed)) {
      dispatch({ type: "resize-nav", width: 0 });
    } else if (event.key === "ArrowRight" || event.key === "Enter") {
      dispatch({ type: "resize-nav", width: width ? width + step : state.navWidth, max: max() });
    } else if (event.key === "ArrowLeft") {
      dispatch({ type: "resize-nav", width: width - step, max: max() });
    } else {
      dispatch({ type: "resize-nav", width: event.key === "Home" ? NAV_WIDTH : max(), max: max() });
    }
  };

  return (
    <div
      id="dx-sidebar-resizer"
      data-ui-scope="officedex"
      role="separator"
      tabIndex={0}
      aria-label={t("dx.sidebar.resize")}
      aria-orientation="vertical"
      aria-controls="dx-sidebar"
      aria-valuemin={0}
      aria-valuemax={max()}
      aria-valuenow={width}
      aria-valuetext={state.navCollapsed ? t("dx.sidebar.hidden") : t("dx.sidebar.width", { width })}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={(event) => {
        if (drag.current?.pointerId === event.pointerId) end(true);
      }}
      onKeyDown={onKeyDown}
    />
  );
}
