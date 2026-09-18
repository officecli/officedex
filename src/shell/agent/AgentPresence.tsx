import { useCallback, useMemo } from "react";

import { useShell } from "../state/ShellContext";
import { effectivePlacement, showsPresenceFace } from "../state/shellReducer";
import { PresenceFace, statusLabel } from "./PresenceFace";
import { TaskPanel } from "./TaskPanel";
import { useAgentTask } from "./useAgentTask";
import { useDraggable, type DraggablePosition } from "./useDraggable";
import "./agent.css";

const FACE_SIZE = 56;
const PANEL_SIZE = { width: 340, height: 520 };

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
  const { state, dispatch } = useShell();
  const agent = useAgentTask();
  const placement = effectivePlacement(state);
  const docked = placement === "docked" && !state.home;
  const showFace = showsPresenceFace(state) && !state.home;
  const status = agent.task?.status ?? "idle";
  const expanded = state.presence.expanded;
  const size = expanded ? PANEL_SIZE : { width: FACE_SIZE, height: FACE_SIZE };

  /**
   * Until the user has placed it, the presence sits bottom-right. Resolving the
   * default here rather than storing one keeps "never placed" distinguishable
   * from "dragged to 0,0", which a numeric sentinel could not.
   */
  const position = useMemo<DraggablePosition>(() => {
    const { x, y, edge } = state.presence;
    if (x !== null && y !== null) return { x, y, edge };
    const width = typeof window === "undefined" ? 1440 : window.innerWidth;
    const height = typeof window === "undefined" ? 900 : window.innerHeight;
    return { x: Math.max(8, width - size.width - 24), y: Math.max(48, height - size.height - 28), edge: null };
  }, [state.presence, size.width, size.height]);

  const onChange = useCallback(
    (next: DraggablePosition) =>
      dispatch({ type: "set-presence-position", x: next.x, y: next.y, edge: next.edge }),
    [dispatch],
  );

  const { dragging, handleProps } = useDraggable({ position, onChange, size });

  const badge = agent.task?.suggestion && !agent.task.suggestion.applied ? 1 : 0;

  return (
    <>
      {/*
        The docked host is a flex child of the body row; its width is the only
        thing a mode change animates (see App.tsx and decision 4).
      */}
      <section
        className="shell-agent shell-region"
        aria-label="Agent conversation"
        aria-hidden={!docked}
        inert={!docked ? true : undefined}
      >
        {docked ? <TaskPanel agent={agent} placement="docked" /> : null}
      </section>

      {showFace ? (
        <div
          className="shell-presence"
          data-expanded={String(expanded)}
          data-edge={position.edge ?? ""}
          data-dragging={String(dragging)}
          style={{ left: position.x, top: position.y }}
        >
          {expanded ? (
            <div className="shell-presence-panel" style={{ width: PANEL_SIZE.width }}>
              <TaskPanel agent={agent} placement="floating" dragHandleProps={handleProps} />
              <button
                type="button"
                className="shell-presence-collapse"
                aria-label="Collapse the Agent panel"
                title="Collapse"
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
              aria-label={`${statusLabel(status)}. Open the Agent panel. Drag, or use the arrow keys, to move it.`}
              title="Open · drag to move · arrow keys to reposition"
              {...handleProps}
              onClick={() => {
                // A drag must not also read as a click.
                if (dragging) return;
                dispatch({ type: "set-presence-expanded", expanded: true });
              }}
            >
              <PresenceFace status={status} badge={badge} size={FACE_SIZE} />
            </button>
          )}
        </div>
      ) : null}
    </>
  );
}
