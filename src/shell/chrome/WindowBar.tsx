import { PanelLeft } from "lucide-react";
import { useEffect, useState } from "react";

import { usePort } from "../port/PortContext";
import { useShell } from "../state/ShellContext";

const CONTROLS = [
  { action: "close", label: "Close window" },
  { action: "minimize", label: "Minimize window" },
  { action: "fullscreen", label: "Toggle full screen" },
] as const;

/**
 * The window bar spans only the sidebar's column; the file tabs own the rest of
 * the top row. That split is the prototype's, and it is what lets the tabs sit
 * at the very top of the window instead of below a full-width title bar.
 */
export function WindowBar() {
  const port = usePort();
  const { state, dispatch } = useShell();
  const [fullscreen, setFullscreen] = useState(() => port.window.isFullscreen());

  useEffect(() => port.window.onFullscreenChange(setFullscreen), [port]);

  const collapseLabel = state.navCollapsed ? "Expand sidebar" : "Collapse sidebar";

  return (
    <div className="shell-windowbar shell-region">
      <div className="shell-window-controls" aria-label="Window controls">
        {CONTROLS.map(({ action, label }) => (
          <button
            key={action}
            type="button"
            className={`shell-window-${action}`}
            aria-label={action === "fullscreen" && fullscreen ? "Exit full screen" : label}
            aria-pressed={action === "fullscreen" ? fullscreen : undefined}
            title={label}
            onClick={() => {
              if (action === "close") port.window.close();
              else if (action === "minimize") port.window.minimize();
              else port.window.toggleFullscreen();
            }}
          >
            <WindowGlyph action={action} />
          </button>
        ))}
      </div>

      <button
        type="button"
        className="shell-icon-button shell-nav-toggle"
        aria-label={collapseLabel}
        aria-expanded={!state.navCollapsed}
        aria-controls="shell-sidebar"
        title={collapseLabel}
        onClick={() => dispatch({ type: "toggle-nav" })}
      >
        <PanelLeft size={18} strokeWidth={1.6} aria-hidden="true" />
      </button>
    </div>
  );
}

/** Hairline glyphs revealed on hover, the way the platform's own controls behave. */
function WindowGlyph({ action }: { action: (typeof CONTROLS)[number]["action"] }) {
  return (
    <svg
      className="shell-window-glyph"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth={1}
      strokeLinecap="round"
      aria-hidden="true"
    >
      {action === "close" ? <path d="m3.5 3.5 5 5m0-5-5 5" /> : null}
      {action === "minimize" ? <path d="M3 6h6" /> : null}
      {action === "fullscreen" ? (
        <path d="M3 3h3.5L3 6.5ZM9 9H5.5L9 5.5Z" fill="currentColor" stroke="none" />
      ) : null}
    </svg>
  );
}
