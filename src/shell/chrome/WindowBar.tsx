import { PanelLeft } from "lucide-react";
import { useEffect, useState } from "react";

import { useT } from "../../renderer/i18n";
import { hasOverlayWindowChrome } from "../../renderer/windowChrome";
import { usePort } from "../port/PortContext";
import { useShell } from "../state/ShellContext";

/**
 * The window controls, by key rather than by label.
 *
 * `shell.sidebar.collapse` / `shell.sidebar.expand` were already in the
 * dictionary — in both languages — with the exact English values this file used
 * to hardcode. They are the two entries this component reuses rather than adds.
 */
const CONTROLS = [
  { action: "close", labelKey: "shell.window.close" },
  { action: "minimize", labelKey: "shell.window.minimize" },
  { action: "fullscreen", labelKey: "shell.window.fullscreen" },
] as const;

/**
 * The window bar spans only the sidebar's column; the file tabs own the rest of
 * the top row. That split is the prototype's, and it is what lets the tabs sit
 * at the very top of the window instead of below a full-width title bar.
 *
 * Nothing else belongs here. A brand mark, a segmented Agent/Editor switch, a
 * centred "AGENT WORKSPACE · Your workspace" caption and a Ready/Working chip
 * were all added to this strip at one point; each one landed in the lane the
 * tab strip and the file actions already occupy, and the switch had to be
 * hidden outright on the compact rail — which is the default — to stop it
 * covering the first tab. The mode control has a home already: the brand button
 * at the top of the sidebar (see ModeMenu).
 */
export function WindowBar() {
  const t = useT();
  const port = usePort();
  const { state, dispatch } = useShell();
  const [fullscreen, setFullscreen] = useState(() => port.window.isFullscreen());

  useEffect(() => port.window.onFullscreenChange(setFullscreen), [port]);

  const collapseLabel = t(state.navCollapsed ? "shell.sidebar.expand" : "shell.sidebar.collapse");

  return (
    <div className="shell-windowbar shell-region">
      <WindowControls fullscreen={fullscreen} />

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

/**
 * The traffic lights — unless the system is already drawing them.
 *
 * On macOS the desktop window keeps the real close/minimise/zoom buttons and
 * floats them over this corner (`mac.TitleBarHidden()` in `main.go`), so a page
 * that draws its own ends up with two overlapping sets a few pixels apart. The
 * system's win: they are the ones that answer a long press, an option-click and
 * a green-button drag, and they grey out with the window. What is left here is
 * the band they need, kept at the same width so the sidebar toggle, the tabs
 * and the presence reserve (`agent/presenceLayout.ts`) do not shift between the
 * two builds.
 *
 * Drawn in full everywhere else: a browser tab has no window controls to dodge,
 * and Windows puts its native ones on the other side of the title bar.
 */
function WindowControls({ fullscreen }: { fullscreen: boolean }) {
  const t = useT();
  const port = usePort();

  if (hasOverlayWindowChrome()) {
    return <div className="shell-window-controls" data-system-drawn="true" aria-hidden="true" />;
  }

  return (
    <div className="shell-window-controls" aria-label={t("shell.window.controls")}>
      {CONTROLS.map(({ action, labelKey }) => {
        const label = t(labelKey);
        return (
          <button
            key={action}
            type="button"
            className={`shell-window-${action}`}
            aria-label={
              action === "fullscreen" && fullscreen ? t("shell.window.exitFullscreen") : label
            }
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
        );
      })}
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
