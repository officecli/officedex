import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useT } from "../../renderer/i18n";
import { useShell } from "../state/ShellContext";
import { NAV_RAIL_WIDTH, canDock, effectivePlacement, showsPresenceFace } from "../state/shellReducer";
import { PresenceFace, statusLabel } from "./PresenceFace";
import { TaskPanel } from "./TaskPanel";
import { useAgentTask } from "./useAgentTask";
import {
  anchorPresence,
  defaultPresencePosition,
  type DraggablePosition,
  type Insets,
} from "./presenceLayout";
import { useDraggable } from "./useDraggable";
import { useMeasuredSize } from "./useMeasuredSize";
import { useViewportSize } from "./useViewportSize";
import "./agent.css";

const FACE_SIZE = 56;

/** Stable identities: these feed a memo and an effect's dependency list. */
const FACE_BOX = { width: FACE_SIZE, height: FACE_SIZE };

/**
 * The panel's box *before* it has been measured, and only then.
 *
 * It is a first-paint fallback, not a fact: the panel renders at whatever its
 * content needs under `max-height: min(76vh, 620px)`, which was 543px in the
 * audit against a declared 520 — and every vertical clamp believed the 520
 * (S6-011). `useMeasuredSize` replaces this with the real box on the first
 * `ResizeObserver` callback.
 */
const PANEL_FALLBACK = { width: 340, height: 543 };

/**
 * How long the docked column takes to collapse — `--shell-duration` in
 * `app.css`, restated because a `setTimeout` cannot read a CSS variable that
 * has not been applied to anything yet. `onTransitionEnd` below finishes it
 * early whenever the browser actually reports the transition, so this is the
 * upper bound rather than the mechanism.
 */
const DOCK_TRANSITION_MS = 200;

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * The Agent presence — decision 1, in one component.
 *
 * The prototype had three draggable objects: a status pet in Agent mode, a
 * companion bubble in Editor mode (mutually exclusive by mode, same artwork,
 * same drag code) and a floating task card that could sit beside the pet. They
 * are one object here, with three states:
 *
 *   docked            → the left column (Agent mode only; the column *is* the
 *                       presence, so no face is drawn beside it)
 *   floating+expanded → the panel, draggable by its header
 *   floating+collapsed→ the face, draggable and clickable to expand
 *
 * `canDock` keeps docking to Agent mode. If Editor could dock the agent on the
 * right, "Editor with a dock" would be Agent mode mirrored and the two modes
 * would stop meaning anything.
 */
export function AgentPresence() {
  const t = useT();
  const { state, dispatch } = useShell();
  const agent = useAgentTask();
  const placement = effectivePlacement(state);
  const docked = placement === "docked" && !state.home;
  const status = agent.task?.status ?? "idle";
  const expanded = state.presence.expanded;
  const dockable = canDock(state);
  const viewport = useViewportSize();

  /**
   * The docked panel outlives `docked` by the length of the column's collapse.
   *
   * `App.tsx` promises "nothing unmounts" across a mode change; the panel used
   * to unmount on the very frame the mode changed, leaving a 320px column of
   * nothing animating shut while a second, fully opaque panel appeared on the
   * right — two agent panels on screen at once, neither of them continuous
   * with the other (S6-003). Holding the docked content until the column has
   * finished closing, and holding the floating one back for exactly as long,
   * means there is never more than one conversation on screen.
   *
   * Only a placement change gets this. Going Home swaps the whole body row and
   * has no column collapse to wait for, and a docked panel lingering there
   * would put a second composer on the page beside the hero's.
   */
  const [closing, setClosing] = useState(false);
  const wasDocked = useRef(docked);
  const dockHost = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const was = wasDocked.current;
    wasDocked.current = docked;
    if (docked || !was || state.home) {
      setClosing(false);
      return;
    }
    setClosing(true);
    const handle = window.setTimeout(
      () => setClosing(false),
      prefersReducedMotion() ? 0 : DOCK_TRANSITION_MS,
    );
    return () => window.clearTimeout(handle);
  }, [docked, state.home]);

  const dockedRender = docked || closing;
  const showFace = showsPresenceFace(state) && !state.home && !closing;

  const { size: panelSize, ref: panelRef } = useMeasuredSize(PANEL_FALLBACK);
  const size = expanded ? panelSize : FACE_BOX;

  /**
   * The chrome the presence must stay out of.
   *
   * The sidebar is the one region whose width the shell already knows, so it
   * is the first thing plugged into this channel: `z-index: 200` means the
   * floating layer wins over everything in the body row, and tucked to the
   * left the panel covered the whole 190px sidebar — the mode menu, Home, New,
   * Open, Recent and Pinned all at once (S4-008). The top of the window needs
   * no inset here: `PRESENCE_MARGIN.top` already clears the window bar, and
   * `CHROME_RESERVE` covers the controls inside it.
   *
   * The canvas's own safe area — the sheet tab strip, the slide status bar,
   * the ruler (S4-002, S4-012, S6-015) — belongs here too, and cannot be
   * added until `editor/canvasContract.ts` reports it (Wave 3-H).
   */
  const safeArea = useMemo<Insets>(
    () => ({
      top: 0,
      right: 0,
      bottom: 0,
      left: state.navCollapsed ? NAV_RAIL_WIDTH : state.navWidth,
    }),
    [state.navCollapsed, state.navWidth],
  );

  /**
   * Until the user has placed it, the presence sits bottom-right.
   *
   * Resolving the default here rather than storing one keeps "never placed"
   * distinguishable from "dragged to 0,0", which a numeric sentinel could not
   * — and because it is derived from `viewport` state, growing the window
   * still puts it in the corner instead of stranding it mid-canvas (S4-015).
   */
  const placed = state.presence.x !== null && state.presence.y !== null;
  const position = useMemo<DraggablePosition>(() => {
    const { x, y, edge } = state.presence;
    if (x !== null && y !== null) return { x, y, edge };
    return defaultPresencePosition(viewport, size, safeArea);
  }, [state.presence, viewport, size, safeArea]);

  const onChange = useCallback(
    (next: DraggablePosition) =>
      dispatch({ type: "set-presence-position", x: next.x, y: next.y, edge: next.edge }),
    [dispatch],
  );

  const { dragging, handleProps } = useDraggable({
    position,
    onChange,
    size,
    viewport,
    placed,
    safeArea,
    // The collapsed mark hangs off the window edge; the panel parks flush
    // against it. See presenceLayout.PlaceOptions.overhang.
    overhang: !expanded,
  });

  const badge = agent.task?.suggestion && !agent.task.suggestion.applied ? 1 : 0;

  /**
   * Tucking splits the presence in two: the element stays on screen, the
   * artwork hangs over the edge.
   *
   * Placing the element itself off-screen (which is what the tucked
   * coordinates literally say) takes its focus ring with it — a keyboard user
   * tabbing to the presence would move focus to something they cannot see. The
   * prototype kept its focus target inside the app and let only the art peek
   * out; this is the same split, with the overhang expressed as a transform on
   * the mark. An expanded panel has no overhang at all, so the offsets are
   * zero and nothing inside it is transformed.
   */
  const anchored = anchorPresence(position, size, viewport);

  return (
    <>
      {/*
        The status, spoken. The prototype's status bubble was a `role="status"`
        with a visible text label beside the character ("Agent reading", "Agent
        waiting for review"); the shell shows that text in the panel header,
        but a screen reader following the run has nothing to hear when the
        panel is collapsed or the presence is tucked. One live region, mounted
        in both placements, so state changes are announced either way.
      */}
      <span className="shell-visually-hidden" role="status" aria-live="polite" aria-atomic="true">
        {statusLabel(status)}
      </span>

      {/*
        The docked host is a flex child of the body row; its width is the only
        thing a mode change animates (see App.tsx and decision 4).
      */}
      <section
        ref={dockHost}
        className="shell-agent shell-region"
        aria-label={t("shell.presence.conversation")}
        aria-hidden={!dockedRender}
        inert={!dockedRender ? true : undefined}
        onTransitionEnd={(event) => {
          // Only the column's own width, not a transition bubbling up from the
          // conversation inside it.
          if (event.target !== dockHost.current || event.propertyName !== "width") return;
          if (!docked) setClosing(false);
        }}
      >
        {dockedRender ? <TaskPanel agent={agent} placement="docked" /> : null}
      </section>

      {showFace ? (
        <div
          className="shell-presence"
          data-expanded={String(expanded)}
          data-edge={position.edge ?? ""}
          data-dragging={String(dragging)}
          style={
            {
              left: anchored.x,
              top: anchored.y,
              "--shell-presence-peek-x": `${anchored.offsetX}px`,
              "--shell-presence-peek-y": `${anchored.offsetY}px`,
            } as React.CSSProperties
          }
        >
          {expanded ? (
            <div
              ref={panelRef}
              className="shell-presence-panel"
              // The collapse button reserves room for the dock button beside
              // it. Editor mode cannot dock, so without this the panel kept a
              // 46px slot for a control that is not rendered (S4-011).
              data-dockable={String(dockable)}
            >
              <TaskPanel agent={agent} placement="floating" dragHandleProps={handleProps} />
              <button
                type="button"
                className="shell-presence-collapse"
                aria-label={t("shell.presence.collapseAria")}
                title={t("shell.presence.collapse")}
                onClick={() => dispatch({ type: "set-presence-expanded", expanded: false })}
              >
                <span aria-hidden="true">–</span>
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="shell-presence-face"
              aria-expanded={false}
              aria-label={t("shell.presence.openAria", { status: statusLabel(status) })}
              title={t("shell.presence.openTitle")}
              {...handleProps}
              onClick={() => {
                // A drag must not also read as a click.
                if (dragging) return;
                dispatch({ type: "set-presence-expanded", expanded: true });
              }}
            >
              <PresenceFace
                status={status}
                badge={badge}
                size={FACE_SIZE}
                // Gaze is off once tucked: the mark is rotated against the
                // window edge and mostly off screen, so eyes aimed at the
                // cursor would point somewhere meaningless.
                tracks={position.edge === null}
                limbs
              />
            </button>
          )}
        </div>
      ) : null}
    </>
  );
}
