import { useRef, type KeyboardEvent, type PointerEvent } from "react";

import { useT } from "../../renderer/i18n";
import { Icon } from "../kit/Icon";
import { useShell } from "../state/ShellContext";
import { CHAT_KEYBOARD_STEP, CHAT_MAX_WIDTH, CHAT_MIN_WIDTH } from "../state/shellReducer";

/**
 * The divider between the conversation and the content region — §03, §19.
 *
 * One pixel wide to the eye, eight to the hand: the transparent handle is the
 * drag target, and hover, focus and dragging recolour only the line. Dragging
 * resizes the conversation between 320 and 520px; arrow keys step by 16, Home
 * and End go to the limits, Escape puts the width back. The button that appears
 * on the divider swaps the conversation to the other side.
 *
 * `onResizing` lets the shell stop embedded editors from swallowing the
 * pointer while a drag crosses them.
 */
export function Splitter({ onResizing }: { onResizing: (active: boolean) => void }) {
  const t = useT();
  const { state, dispatch } = useShell();
  const drag = useRef<{ pointerId: number; x: number; width: number } | null>(null);

  const sign = state.chatPosition === "right" ? -1 : 1;

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    drag.current = { pointerId: event.pointerId, x: event.clientX, width: state.chatWidth };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    if (Math.abs(event.clientX - current.x) > 4) onResizing(true);
    dispatch({ type: "set-chat-width", width: current.width + (event.clientX - current.x) * sign });
  };

  const finish = (event: PointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    if (event.type === "pointercancel") dispatch({ type: "set-chat-width", width: current.width });
    drag.current = null;
    onResizing(false);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape" && drag.current) {
      event.preventDefault();
      dispatch({ type: "set-chat-width", width: drag.current.width });
      event.currentTarget.releasePointerCapture(drag.current.pointerId);
      drag.current = null;
      onResizing(false);
      return;
    }
    let next = state.chatWidth;
    if (event.key === "ArrowRight") next += CHAT_KEYBOARD_STEP;
    else if (event.key === "ArrowLeft") next -= CHAT_KEYBOARD_STEP;
    else if (event.key === "Home") next = CHAT_MIN_WIDTH;
    else if (event.key === "End") next = CHAT_MAX_WIDTH;
    else return;
    event.preventDefault();
    dispatch({ type: "set-chat-width", width: next });
  };

  return (
    <div id="dx-splitter" data-ui-scope="officedex">
      <div
        className="dx-resize-handle"
        role="separator"
        tabIndex={0}
        aria-label={t("dx.chat.resize")}
        aria-orientation="vertical"
        aria-valuemin={CHAT_MIN_WIDTH}
        aria-valuemax={CHAT_MAX_WIDTH}
        aria-valuenow={state.chatWidth}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={finish}
        onPointerCancel={finish}
        onKeyDown={onKeyDown}
      />
      <button
        type="button"
        className="dx-swap"
        data-act="swap"
        aria-label={t("dx.chat.swap")}
        title={t("dx.chat.swap")}
        onClick={(event) => {
          dispatch({ type: "swap-chat" });
          // The divider has just moved out from under the pointer. Holding
          // focus would keep the button showing where nobody is pointing; a
          // keyboard user keeps it, to swap back.
          if (event.detail > 0) event.currentTarget.blur();
        }}
      >
        <Icon name="ArrowLeftRight" />
      </button>
    </div>
  );
}
