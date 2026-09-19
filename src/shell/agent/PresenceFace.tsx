import { translate } from "../../renderer/i18n";
import type { AgentStatus } from "../../shared/uiPort";
import {
  CORNER_ORIGIN,
  CORNER_SYMBOLS,
  DISC,
  LIMBS,
  PLATE_PATH,
  SYMBOL_DETAIL_MIN_SIZE,
  VIEW_BOX,
  blinks,
  eyePath,
  poseFor,
  tracksGaze,
} from "./companion";
import { useGaze } from "./useGaze";

export interface PresenceFaceProps {
  status: AgentStatus;
  /** Shown when a suggestion is waiting while the panel is collapsed. */
  badge?: number;
  size?: number;
  /**
   * Off for the mode switch and other places the mark is an icon rather than a
   * presence — a blinking glyph inside a menu row reads as a defect.
   */
  animated?: boolean;
  /**
   * Whether the eyes may follow the pointer. On for the marks that stand for
   * the agent *now* (the presence, the panel header, Home); off for the ones
   * that label something else (a past reply, a menu row).
   */
  tracks?: boolean;
  /** Drawn, but hidden until the presence tucks against an edge. */
  limbs?: boolean;
}

/**
 * The collapsed presence: the OfficeDex companion, drawn from `companion.ts`.
 *
 * One character, seven expressions driven by `AgentStatus`. The prototype drew
 * it twice — once as a non-interactive "status pet" in Agent mode and once as
 * the clickable companion in Editor mode — with the explicit rule that the pet
 * "never opens a conversation". That rule is dropped: a round, animate face is
 * read as clickable, so here it always is (decision 1).
 *
 * Motion is CSS, not a requestAnimationFrame loop like the prototype's. The
 * loop bought eased scanning and re-rendered every mounted face on every frame;
 * the shell mounts one per panel plus one per reply. Blink, scan and heartbeat
 * are periodic, so keyframes carry them at no per-frame cost — and
 * `prefers-reduced-motion` switches them off in one place. Gaze is the one
 * thing keyframes cannot express, so `useGaze` drives it through two custom
 * properties, on pointer moves only.
 */
export function PresenceFace({
  status,
  badge,
  size = 56,
  animated = true,
  tracks = false,
  limbs = false,
}: PresenceFaceProps) {
  const pose = poseFor(status);
  const detailed = size >= SYMBOL_DETAIL_MIN_SIZE;
  const symbol = detailed ? pose.symbol : "dot";
  const gazeRef = useGaze(tracks && animated && tracksGaze(status));
  const limbLeft = DISC.cx - DISC.r + LIMBS.inset;
  const limbRight = DISC.cx + DISC.r - LIMBS.inset - LIMBS.width;

  return (
    <span
      ref={gazeRef}
      className="shell-face"
      data-status={status}
      data-motion={animated ? pose.motion : "off"}
      data-blink={animated && blinks(status) ? "true" : "false"}
      style={{ width: size, height: size }}
      /*
       * Decorative everywhere: every caller already names the thing the face
       * belongs to — the presence button's `aria-label`, the panel header's
       * status line, the reply's "OfficeDex", the mode menu's own row. A
       * hidden "Agent idle" inside the mark made the mode menu announce
       * "Agent idle, Agent, Give a goal…".
       */
      aria-hidden="true"
    >
      <svg viewBox={VIEW_BOX}>
        <circle className="shell-face-shell" cx={DISC.cx} cy={DISC.cy} r={DISC.r} />
        {limbs ? (
          <g className="shell-face-limbs" strokeWidth={LIMBS.stroke}>
            <rect
              x={limbLeft}
              y={LIMBS.y}
              width={LIMBS.width}
              height={LIMBS.height}
              rx={LIMBS.height / 2}
            />
            <rect
              x={limbRight}
              y={LIMBS.y}
              width={LIMBS.width}
              height={LIMBS.height}
              rx={LIMBS.height / 2}
            />
          </g>
        ) : null}
        <path className="shell-face-plate" d={PLATE_PATH} />
        <g className="shell-face-gaze">
          <g className="shell-face-scan">
            <g className="shell-face-blink">
              {pose.eyes.map((eye, index) => (
                <path
                  key={index}
                  className="shell-face-eye"
                  d={eyePath(eye)}
                  strokeWidth={eye.weight}
                />
              ))}
            </g>
          </g>
        </g>
        <g transform={`translate(${CORNER_ORIGIN.x} ${CORNER_ORIGIN.y})`}>
          {/*
            `key` on the symbol, so React replaces the node when the state
            changes rather than patching the paths: a fresh node restarts the
            pop-in animation, which is how the prototype announced a symbol
            swap. Its own group, because `.shell-face-corner` is already
            carrying the breathing and heartbeat transforms.
          */}
          <g className="shell-face-pop" key={symbol}>
            <g className="shell-face-corner" data-symbol={symbol}>
              {CORNER_SYMBOLS[symbol].map((stroke, index) =>
                stroke.width === undefined ? (
                  <path key={index} d={stroke.d} />
                ) : (
                  <path
                    key={index}
                    d={stroke.d}
                    fill="none"
                    strokeWidth={stroke.width}
                    strokeLinecap="round"
                  />
                ),
              )}
            </g>
          </g>
        </g>
      </svg>
      {badge ? (
        <span className="shell-face-badge" aria-hidden="true">
          {badge}
        </span>
      ) : null}
    </span>
  );
}

/**
 * The spoken name of a state.
 *
 * `translate` rather than `useT` because three of the four callers want this
 * inside a template (an `aria-label`, a live region, a row in Home's task
 * list), and the shell has no locale switcher of its own — the language is
 * fixed for the life of the window.
 */
export function statusLabel(status: AgentStatus): string {
  return translate(poseFor(status).labelKey);
}
