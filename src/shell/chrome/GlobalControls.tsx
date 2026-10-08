import { useEffect, useState } from "react";

import { useT } from "../../renderer/i18n";
import { hasOverlayWindowChrome } from "../../renderer/windowChrome";
import { DexFace } from "../dex/DexFace";
import { Icon } from "../kit/Icon";
import { usePort } from "../port/PortContext";
import { useShell } from "../state/ShellContext";

/**
 * The window's top-left corner: traffic lights → sidebar switch → the Logo
 * Home tab (WORKSPACE-STANDARD §02).
 *
 * 244 × 40 and independent of the sidebar's body: the band stays exactly where
 * it is when the sidebar is hidden, which is what makes the Logo tab permanent
 * rather than a sidebar item. The Home tab is not a document tab — it is never
 * closed, never dragged and does not count among the open files.
 *
 * `onPeek` / `onPeekEnd` carry the hidden sidebar's temporary reveal: resting
 * the pointer on the switch shows it, leaving hides it again, and only a click
 * pins it (§03).
 */
export function GlobalControls({
  onPeek,
  onPeekEnd,
}: {
  onPeek: () => void;
  onPeekEnd: () => void;
}) {
  const t = useT();
  const { state, dispatch } = useShell();
  const atHome = state.page === "home";
  const switchLabel = t(state.navCollapsed ? "dx.sidebar.show" : "dx.sidebar.hide");

  return (
    <div id="dx-global-controls" data-ui-scope="officedex" onPointerLeave={onPeekEnd}>
      <div className="dx-window-controls">
        <TrafficLights />
        <button
          type="button"
          className="dx-ib"
          aria-label={switchLabel}
          title={switchLabel}
          aria-expanded={!state.navCollapsed}
          aria-controls="dx-sidebar"
          data-act="toggle-sidebar"
          onPointerOver={onPeek}
          onClick={() => dispatch({ type: "toggle-nav" })}
        >
          <Icon name="PanelLeft" />
        </button>
        <button
          type="button"
          className={atHome ? "dx-home-tab dx-selected" : "dx-home-tab"}
          aria-label={t("dx.home.tabAria")}
          aria-current={atHome ? "page" : "false"}
          data-tooltip={t("dx.home.tab")}
          data-act="home"
          onClick={() => dispatch({ type: "go", page: "home" })}
        >
          <DexFace />
          <span>OfficeDex</span>
        </button>
      </div>
    </div>
  );
}

/**
 * The traffic lights — unless the system is already drawing them.
 *
 * On macOS the desktop window keeps the real close/minimise/zoom buttons and
 * floats them over this corner, so a page that draws its own ends up with two
 * overlapping sets. The system's win: they answer a long press, an option-click
 * and a green-button drag, and they grey out with the window. What is left is
 * the room they need.
 */
function TrafficLights() {
  const t = useT();
  const port = usePort();
  const [fullscreen, setFullscreen] = useState(() => port.window.isFullscreen());
  useEffect(() => port.window.onFullscreenChange(setFullscreen), [port]);

  if (hasOverlayWindowChrome()) {
    return <span className="dx-traffic-reserve" data-system-drawn="true" aria-hidden="true" />;
  }

  return (
    <>
      <button
        type="button"
        className="dx-traffic dx-close"
        aria-label={t("shell.window.close")}
        title={t("shell.window.close")}
        data-act="window-close"
        onClick={() => port.window.close()}
      >
        ×
      </button>
      <button
        type="button"
        className="dx-traffic dx-min"
        aria-label={t("shell.window.minimize")}
        title={t("shell.window.minimize")}
        data-act="window-minimize"
        onClick={() => port.window.minimize()}
      >
        −
      </button>
      <button
        type="button"
        className="dx-traffic dx-max"
        aria-label={t(fullscreen ? "shell.window.exitFullscreen" : "shell.window.fullscreen")}
        title={t("shell.window.fullscreen")}
        aria-pressed={fullscreen}
        data-act="window-maximize"
        onClick={() => port.window.toggleFullscreen()}
      >
        +
      </button>
    </>
  );
}
