import agentBase from "./assets/brand/agent-base.png";
import editorMark from "./assets/brand/editor.png";
import "./brandMark.css";

/**
 * The mark in the top-left corner, and on each row of the mode menu.
 *
 * Two marks, as the approved prototype draws them, because the corner says
 * which mode the window is in:
 *
 * - **Agent** is the companion: the dark tile, the white plate with its bite,
 *   two eyes and the corner dot. The plate artwork is the prototype's own
 *   `original-without-dot.png`; the eyes and the dot are drawn over it at the
 *   prototype's coordinates, so the character matches the one on the canvas.
 * - **Editor** is the same tile and plate with the dot and no eyes — the
 *   document without anyone in it (`officedex.png` in the prototype).
 *
 * Both sit in a 7px-radius tile that clips: the agent drawing is a crop of the
 * artwork (viewBox 42–214), and without the clip its tile would show square
 * cut corners.
 */
export function BrandMark({ mode, size = 28 }: { mode: "agent" | "editor"; size?: number }) {
  return (
    <span className="shell-brand-tile" data-mode={mode} style={{ width: size, height: size }} aria-hidden="true">
      {mode === "editor" ? (
        <img src={editorMark} alt="" draggable={false} />
      ) : (
        <svg viewBox="42 42 172 172" width={size} height={size}>
          <image href={agentBase} width="256" height="256" />
          <g className="shell-brand-eyes">
            <path d="M 112.66 127.55 Q 112.66 134.51 112.66 141.47" />
            <path d="M 150.66 127.55 Q 150.66 134.51 150.66 141.47" />
          </g>
          <path
            className="shell-brand-dot"
            transform="translate(175.5 81)"
            d="M -2.5 -9 H 2.5 Q 8.5 -9 8.5 -3 V 3 Q 8.5 9 2.5 9 H -2.5 Q -8.5 9 -8.5 3 V -3 Q -8.5 -9 -2.5 -9 Z"
          />
        </svg>
      )}
    </span>
  );
}
