import { ToastHost } from "../renderer/ui";
import { AgentPresence } from "./agent/AgentPresence";
import { FileTabs } from "./chrome/FileTabs";
import { Sidebar } from "./chrome/Sidebar";
import { StatusBar } from "./chrome/StatusBar";
import { WindowBar } from "./chrome/WindowBar";
import { EditorCanvasHost } from "./editor/EditorCanvasHost";
import { Ribbon } from "./editor/Ribbon";
import { AgentHome } from "./home/AgentHome";
import { EditorHome } from "./home/EditorHome";
import { SidebarTree } from "./nav/SidebarTree";
import { useShell } from "./state/ShellContext";
import { effectivePlacement } from "./state/shellReducer";
import { fileTypeAccentStyle } from "./theme/fileTypeAccent";
import "./app.css";
import "./chrome/chrome.css";

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
      style={
        {
          ...fileTypeAccentStyle(activeFile?.type),
          "--shell-nav-w": state.navCollapsed ? "var(--shell-rail-w)" : `${state.navWidth}px`,
          "--shell-task-w": agentDocked ? `${state.taskWidth}px` : "0px",
        } as React.CSSProperties
      }
    >
      <div className="shell-row shell-row--top">
        <WindowBar />
        <FileTabs />
      </div>

      <div className="shell-row shell-row--body">
        {/* Agent mode keeps the folder tree permanently: folders are how a task
            is scoped. Editor mode's library lives on Home instead. */}
        <Sidebar>{state.mode === "agent" ? <SidebarTree /> : null}</Sidebar>

        {/* Owns both the docked column and the floating layer — decision 1. */}
        <AgentPresence />

        {/*
          Hidden rather than unmounted on Home: the canvas host — and, after
          integration, a live document renderer holding unsaved state — must
          survive a trip to Home the same way it survives a mode change.
        */}
        <main className="shell-workspace" hidden={state.home}>
          <Ribbon type={activeFile?.type ?? "doc"} />
          <EditorCanvasHost file={activeFile} visible={!state.home} />
          <StatusBar />
        </main>

        {state.home ? state.mode === "agent" ? <AgentHome /> : <EditorHome /> : null}
      </div>

      <ToastHost />
    </div>
  );
}
