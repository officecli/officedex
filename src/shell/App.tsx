import { useCallback, useState } from "react";

import { ToastHost } from "../renderer/ui";
import { AccountPage } from "./account/AccountPage";
import { useAccount } from "./account/useAccount";
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
import { useCanvasSurface } from "./editor/canvasSurface";
import { AgentHome } from "./home/AgentHome";
import { ImageWorkspace } from "./image/ImageWorkspace";
import { EditorHome } from "./home/EditorHome";
import { SidebarTree } from "./nav/SidebarTree";
import { SettingsPage } from "./settings/SettingsPage";
import { useShell } from "./state/ShellContext";
import { effectivePlacement, NAV_RAIL_WIDTH } from "./state/shellReducer";
import { useModeTransition } from "./state/useModeTransition";
import { fileTypeAccentStyle } from "./theme/fileTypeAccent";
import "./app.css";
import "./chrome/chrome.css";

/**
 * The shell's layout.
 *
 * Two rows of flex. A mode change moves one box — the width of the agent
 * column — and changes what is inside three others: the sidebar's middle, Home,
 * and the tab strip's left inset. Nothing unmounts that holds document state,
 * which is what decision 4 is actually about; the transition that carries the
 * rest is `data-mode-switching`, written here by `useModeTransition` and read
 * by the "mode switch" section of app.css.
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
  const { state, dispatch, activeFile, loaded } = useShell();
  const canvas = useCanvas();
  const agent = useAgentTask();
  const reduceMotion = useReduceMotion();
  /*
   * Asked once here and handed down, because "who is signed in" is one fact
   * about the whole shell and every `whoami` is a subprocess. The account page
   * calls `refresh` after a sign-in or sign-out, which is the only time the
   * answer changes — so nothing polls.
   */
  const account = useAccount();
  const [accountOpen, setAccountOpen] = useState(false);
  /**
   * The settings page, when it is open — the second full-page surface, owned
   * here for the same reason as the first: nothing about being mid-settings
   * belongs in persisted view state, and a reload should not reopen it.
   */
  const [settingsOpen, setSettingsOpen] = useState(false);
  /**
   * One transition for the whole shell, driven by the state rather than by the
   * control that changed it — see `state/useModeTransition.ts`. It only writes
   * an attribute; every region decides for itself what to do with it.
   */
  const shellRef = useModeTransition(state.mode, reduceMotion);
  useCanvasDirty(canvas, activeFile?.id ?? null);
  useDocumentDraft(canvas, agent.task, activeFile?.id ?? null, agent.applySuggestion);
  const placement = effectivePlacement(state);
  /*
   * The recording tells the shell when it has been superseded, rather than the
   * shell trying to watch for it: the canvas is a separate React root and owns
   * the precedence decision. Stable so the canvas effect does not re-run on
   * every render.
   */
  const leaveDemo = useCallback(() => dispatch({ type: "leave-demo" }), [dispatch]);
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
  /*
   * "The document it is touching" includes one that has no file yet.
   *
   * A run started from Home has no active file by design — there is nothing on
   * disk to open — and what it is writing into is the stage on the canvas. The
   * test used to be `activeFile !== null`, which lit only because a stale file
   * was still selected underneath the stage; once that was fixed the border
   * went dark for exactly the runs it exists to announce. `chrome` is the
   * canvas saying something is mounted on it, stage or editor.
   */
  const surface = useCanvasSurface();
  const attentionActive =
    working && !state.home && (activeFile !== null || surface.chrome !== null);

  /**
   * One status bar, not two and not none.
   *
   * `<StatusBar />` used to be unconditional, and the bottom 32px of the window
   * came out three different ways: Writer and the deck editor each drew their
   * own bar directly above the shell's, and the workbook's `position: fixed`
   * footer covered the shell's completely, so there the shell's bar existed and
   * could not be seen or clicked (S4-003, S4-010). The shell had no way to
   * decide between yielding and keeping, because nothing told it there was
   * anything down there.
   *
   * It yields. The editor's bar is about the document — pages, words, the
   * current slide, the zoom — and the shell's said the file name, "On this
   * computer" and whether it is saved, of which the name is already in the tab
   * and the save state is already the tab strip's save button (`FileTabs`
   * renders "Unsaved"/"Saved" beside it). Stacking a row that repeats two
   * facts on top of a row that reports real ones is the wrong half to keep.
   *
   * `--shell-statusbar-h` goes with it. The bar's height is also what
   * `.shell-attention` subtracts to find the document's edge, so leaving the
   * token at 32px would trace the agent's attention border 32px above the
   * bottom of a canvas that now reaches the window.
   *
   * A stage reports `STAGE_CHROME`, which owns no status bar, so the shell
   * keeps drawing its own over a run exactly as it did before.
   */
  const editorOwnsStatusBar = surface.chrome?.ownsStatusBar === true && !state.home;

  return (
    <div
      id="shell"
      ref={shellRef}
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
          ...(editorOwnsStatusBar ? { "--shell-statusbar-h": "0px" } : {}),
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
        <Sidebar
          account={account.account}
          onOpenAccount={() => setAccountOpen(true)}
          onOpenSettings={() => setSettingsOpen(true)}
        >
          {state.mode === "agent" ? <SidebarTree /> : null}
        </Sidebar>

        {/* Owns both the docked column and the floating layer — decision 1. */}
        <AgentPresence />

        {/*
          Hidden rather than unmounted on Home: the canvas host — and, after
          integration, a live document renderer holding unsaved state — must
          survive a trip to Home the same way it survives a mode change.
        */}
        <main className="shell-workspace" hidden={state.home}>
          {/*
            `fileless` covers both things that own the canvas without a file: a
            deck being drawn (a run, not a library entry) and the bundled
            recording started from Home. `state.demo` is the second one; the
            first is reported by the canvas adapter itself.
          */}
          <EditorCanvasHost
            file={activeFile}
            visible={!state.home}
            adapter={canvas}
            fileless={state.demo}
            demoStartedAt={state.demoStartedAt}
            onDemoSuperseded={leaveDemo}
          />
          {/*
            A picture, over the canvas rather than inside it.

            `EditorCanvasHost` above never unmounts — decision 4 — and outside
            the desktop build it has no adapter to show an image with anyway, so
            the image surface draws its own `<img>` from `images.readFile` and
            covers the canvas while it is up. It renders nothing at all when
            there is no picture and no image run, which is most of the time.
          */}
          <ImageWorkspace agent={agent} />
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
          {editorOwnsStatusBar ? null : <StatusBar />}
        </main>

        {state.home ? state.mode === "agent" ? <AgentHome /> : <EditorHome /> : null}
      </div>

      <ToastHost />

      {/*
        The settings page — the shell's other full-page surface, and the one it
        did not have at all until now.
      */}
      {settingsOpen ? (
        <SettingsPage
          onClose={() => setSettingsOpen(false)}
          /*
           * The provider section's "sign in" link lands on the account page.
           * Settings closes first: one full-page flow at a time, and the account
           * page is the higher rung of the two, so leaving both mounted would
           * stack two covers whose order nobody could reason about.
           */
          onOpenLogin={() => {
            setSettingsOpen(false);
            setAccountOpen(true);
          }}
        />
      ) : null}

      {/*
        The account page, when it is open.

        A sibling of every region rather than a replacement for them. R-B-09
        wants the sign-in flow not to render inside the shell frame, and an
        opaque full-window cover satisfies that; unmounting the frame instead —
        which is what the old renderer did — would take the open document's
        editor with it, and the whole point of keeping the workspace mounted
        (decision 4, and `EditorCanvasHost` being hidden rather than removed on
        Home) is that it survives a trip somewhere else.

        Owning the flag here rather than in `ShellProvider`: nothing about being
        mid-sign-in belongs in persisted view state, and a reload should not
        reopen it.
      */}
      {accountOpen ? (
        <AccountPage onClose={() => setAccountOpen(false)} onAccountChanged={account.refresh} />
      ) : null}
    </div>
  );
}
