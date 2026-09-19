import { ToastHost } from "../renderer/ui";
import { AgentPresence } from "./agent/AgentPresence";
import { AttentionBorder } from "./agent/AttentionBorder";
import { useAgentTask } from "./agent/useAgentTask";
import { useCanvas } from "./canvas/CanvasContext";
import { useCanvasDirty } from "./canvas/useCanvasDirty";
import { useDocumentDraft } from "./canvas/useDocumentDraft";
import { FileTabs } from "./chrome/FileTabs";
import { Sidebar } from "./chrome/Sidebar";
import { StatusBar } from "./chrome/StatusBar";
import { WindowBar } from "./chrome/WindowBar";
import { useReduceMotion } from "./composer/useComposerSettings";
import { EditorCanvasHost } from "./editor/EditorCanvasHost";
import { AgentHome } from "./home/AgentHome";
import { EditorHome } from "./home/EditorHome";
import { SidebarTree } from "./nav/SidebarTree";
import { useShell } from "./state/ShellContext";
import { effectivePlacement, NAV_RAIL_WIDTH } from "./state/shellReducer";
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
 *   │               │ (docked)  │  canvas  ← persists  │
 *   │               │           │  status bar          │
 *   └───────────────┴───────────┴──────────────────────┘
 *
 * There was a ribbon above the canvas — a full Office toolbar, drawn tab by tab,
 * with nothing behind any of it. Formatting belongs to whichever editor is
 * mounted in the canvas, and those bring their own toolbars, so the shell's copy
 * was a picture of controls the user already had working two rows below it.
 *
 * `width` on a flex item is used rather than animating `grid-template-columns`:
 * the desktop build runs in WKWebView, where interpolating grid tracks is not
 * dependable, while flex-item width transitions are.
 */
export function App() {
  const { state, activeFile, loaded } = useShell();
  const canvas = useCanvas();
  const agent = useAgentTask();
  const reduceMotion = useReduceMotion();
  useCanvasDirty(canvas, activeFile?.id ?? null);
  useDocumentDraft(canvas, agent.task, activeFile?.id ?? null, agent.applySuggestion);
  const placement = effectivePlacement(state);
  const agentDocked = placement === "docked" && !state.home;

  /**
   * The border shows while the agent is actually touching the document, and
   * only on the document it is touching. `awaiting-review` deliberately does
   * not light it: nothing is happening in there any more, and a border that
   * keeps shimmering over a finished run is the agent claiming to still be
   * working.
   *
   * `!state.home` is not just "Home has no document". Home mounts its own
   * `AttentionBorder` around the hero composer, lit by input focus rather than
   * by the run (see Hero.tsx). Two instances, never on screen at once, because
   * Home and the workspace are different subtrees and the two lights answer
   * different questions.
   */
  const working =
    agent.task?.status === "working" ||
    agent.task?.status === "reading" ||
    agent.task?.status === "writing";
  const attentionActive = working && !state.home && activeFile !== null;

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
          "--shell-nav-w": `${state.navCollapsed ? NAV_RAIL_WIDTH : state.navWidth}px`,
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
          <EditorCanvasHost file={activeFile} visible={!state.home} adapter={canvas} />
          {/*
            The agent's attention border. Its own subscription to the task
            rather than a prop drilled down from the presence: this sits in the
            workspace column, the presence sits in the body row beside it, and
            threading one through the other would couple two regions that share
            nothing else.

            `reducedMotion` is not optional in practice, whatever the prop's
            default says. This call site used to omit it, so the most prominent
            animation in the product — a light travelling the document's edge
            while the agent writes into it — was the one thing the Reduced
            motion switch could never turn off (audit S7-004). Home's copy in
            Hero.tsx passed it from the start; there is nothing different about
            this one except that nobody noticed.
          */}
          <AttentionBorder active={attentionActive} reducedMotion={reduceMotion} />
          <StatusBar />
        </main>

        {state.home ? state.mode === "agent" ? <AgentHome /> : <EditorHome /> : null}
      </div>

      <ToastHost />
    </div>
  );
}
