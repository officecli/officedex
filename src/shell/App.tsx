import { EditorCanvasHost } from "./editor/EditorCanvasHost";
import { useShell } from "./state/ShellContext";
import { effectivePlacement } from "./state/shellReducer";
import { fileTypeAccentStyle } from "./theme/fileTypeAccent";
import "./app.css";

/**
 * The shell's layout.
 *
 * Two rows of flex. A mode change moves exactly one thing — the width of the
 * agent column — and the browser transitions it. Nothing unmounts, which is why
 * decision 4 needs no animation machinery to feel continuous.
 *
 *   ┌───────────────┬──────────────────────────────────┐
 *   │ window bar    │ file tabs                        │  40px, always present
 *   ├───────────────┼───────────┬──────────────────────┤
 *   │ sidebar       │ agent     │ workspace            │
 *   │               │ (docked)  │  ribbon              │
 *   │               │           │  canvas  ← persists  │
 *   │               │           │  status bar          │
 *   └───────────────┴───────────┴──────────────────────┘
 *
 * `width` on a flex item is used rather than animating `grid-template-columns`:
 * the desktop build runs in WKWebView, where interpolating grid tracks is not
 * dependable, while flex-item width transitions are.
 */
export function App() {
  const { state, activeFile, loaded } = useShell();
  const placement = effectivePlacement(state);
  const agentDocked = placement === "docked" && !state.home;

  return (
    <div
      id="shell"
      className="shell"
      data-mode={state.mode}
      data-home={String(state.home)}
      data-nav-collapsed={String(state.navCollapsed)}
      data-presence={placement}
      data-loaded={String(loaded)}
      style={{
        ...fileTypeAccentStyle(activeFile?.type),
        "--shell-nav-w": state.navCollapsed ? "var(--shell-rail-w)" : `${state.navWidth}px`,
        "--shell-task-w": agentDocked ? `${state.taskWidth}px` : "0px",
      } as React.CSSProperties}
    >
      <div className="shell-row shell-row--top">
        <div className="shell-windowbar shell-region" />
        <div className="shell-tabs shell-region" />
      </div>

      <div className="shell-row shell-row--body">
        <aside className="shell-sidebar shell-region" aria-label="Workspace navigation" />

        <section
          className="shell-agent shell-region"
          aria-label="Agent conversation"
          aria-hidden={!agentDocked}
          inert={!agentDocked ? true : undefined}
        />

        {/*
          Hidden rather than unmounted on Home: the canvas host — and, after
          integration, a live document renderer holding unsaved state — must
          survive a trip to Home the same way it survives a mode change.
        */}
        <main className="shell-workspace" hidden={state.home}>
          <div className="shell-ribbon shell-region" />
          <EditorCanvasHost file={activeFile} visible={!state.home} />
          <div className="shell-statusbar shell-region" />
        </main>

        {state.home ? <div className="shell-home shell-region" /> : null}
      </div>
    </div>
  );
}
