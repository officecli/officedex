import { SetupHost } from "./onboarding/SetupHost";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ToastHost } from "../renderer/ui";
import { AccountPage } from "./account/AccountPage";
import { useAccount } from "./account/useAccount";
import { AgentProvider, useAgent } from "./agent/AgentContext";
import { AttentionBorder } from "./agent/AttentionBorder";
import { useCanvas } from "./canvas/CanvasContext";
import { useCanvasSelection } from "./canvas/SelectionContext";
import { useCanvasDirty } from "./canvas/useCanvasDirty";
import { useDocumentDraft } from "./canvas/useDocumentDraft";
import { ConversationPane } from "./chat/ConversationPane";
import { runStateOf, isRunning } from "./chat/runState";
import { DocumentTabs } from "./chrome/DocumentTabs";
import { GlobalControls } from "./chrome/GlobalControls";
import { NewPopover } from "./chrome/NewPopover";
import { Sidebar } from "./chrome/Sidebar";
import { SidebarResizer } from "./chrome/SidebarResizer";
import { Splitter } from "./chrome/Splitter";
import { UsageNotice } from "./chrome/UsageNotice";
import { useReduceMotion } from "./composer/useComposerSettings";
import { Dex } from "./dex/Dex";
import { dexFaceSettings } from "./dex/faceRenderer";
import { EditorCanvasHost } from "./editor/EditorCanvasHost";
import { useCanvasSurface } from "./editor/canvasSurface";
import { ImageWorkspace } from "./image/ImageWorkspace";
import { Icon } from "./kit/Icon";
import { Layers, closeMenu } from "./kit/layers";
import { mountTooltips } from "./kit/tooltips";
import { AssetsPage } from "./pages/AssetsPage";
import { ChatEmpty } from "./pages/ChatEmpty";
import { FeatureHighlights } from "./pages/FeatureHighlights";
import { Home, useCreateOfType } from "./pages/Home";
import { ImageCreatePage } from "./pages/ImageCreatePage";
import { LocalPage } from "./pages/LocalPage";
import { ProjectsPage } from "./pages/ProjectsPage";
import { filesTouchedBy } from "./pages/fileRows";
import { useKeyboardShortcuts } from "./chrome/useKeyboardShortcuts";
import { SettingsPage } from "./pages/SettingsPage";
import { SkillsPage } from "./pages/SkillsPage";
import { workspaceClasses } from "./state/workspaceClasses";
import { useShell } from "./state/ShellContext";
import { navMaxWidth, tabIsChat, workspaceClosed } from "./state/shellReducer";
import { useT } from "../renderer/i18n";
import "./app.css";
import "./styles/ua-baseline.css";
import "./styles/workspace-v11.css";
import "./styles/workspace-v12.css";
import "./styles/attention.css";
import "./styles/workspace-structure.css";
import "./styles/ppt-skills.css";
import "./styles/outer-typography.css";
import "./styles/sidebar-resize.css";
import "./styles/product.css";
import "./styles/typography.css";

/**
 * The shell — OD-UI-1.2 (r10).
 *
 *   ┌──────────────┬───────────────────┬──────────────────────────────┐
 *   │ ● ● ●  ▯  ⌂  │ conversation   ▢ ⤢│ document tabs      save ⋯  ▯ │ 40
 *   ├──────────────┼───────────────────┼──────────────────────────────┤
 *   │ New          │                   │                              │
 *   │ Local        │  messages         │  Home · Local · Assets ·     │
 *   │              │                   │  Settings · a document       │
 *   │ Projects     │                   │                         Dex ●│
 *   │   chats      │  composer         │                              │
 *   │ account   ⚙  │                   │                              │
 *   └──────────────┴───────────────────┴──────────────────────────────┘
 *    244–480 / 0         320–520                    the rest
 *
 * Each column has its own 40px top row; there is no bar across the window, but
 * the rows share one colour (`--dx-titlebar`, 1.0.12 UI-06). The top-left band
 * — traffic lights, then the sidebar switch and the Logo Home tab as one group
 * on its right — is as wide as the sidebar (UI-04): the lights stay put and the
 * group follows the sidebar's edge. With the sidebar hidden the band is 244px.
 *
 * The document host never unmounts. An editor holding unsaved work survives a
 * trip to Home, Assets or Settings: the page is drawn in the same column and
 * the host is hidden, not removed.
 */
export function App() {
  return (
    <AgentProvider>
      <Workspace />
    </AgentProvider>
  );
}

function Workspace() {
  const t = useT();
  const { state, dispatch, activeFile, loaded } = useShell();
  const canvas = useCanvas();
  const agent = useAgent();
  const reduceMotion = useReduceMotion();
  const account = useAccount();
  const createOfType = useCreateOfType();
  const surface = useCanvasSurface();
  const { selection } = useCanvasSelection();
  const shell = useRef<HTMLDivElement>(null);
  const editorWrapper = useRef<HTMLElement>(null);
  const [accountOpen, setAccountOpen] = useState(false);
  const [setupVisible, setSetupVisible] = useState(false);
  const [resizing, setResizing] = useState(false);
  const [sidebarResizing, setSidebarResizing] = useState(false);
  const viewportWidth = useViewportWidth();
  const [peek, setPeek] = useState(false);
  const [newAnchor, setNewAnchor] = useState<HTMLElement | null>(null);
  const [featureFlyout, setFeatureFlyout] = useState(false);

  useCanvasDirty(canvas, activeFile?.id ?? null);
  useDocumentDraft(canvas, agent.task, activeFile?.id ?? null, agent.applySuggestion);
  useKeyboardShortcuts({ onNew: () => openNew(null), enabled: !setupVisible });

  /* ---- the hidden sidebar's temporary reveal (§03) ------------------------ */
  const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const newOpen = newAnchor !== null;
  const newOpenRef = useRef(newOpen);
  newOpenRef.current = newOpen;
  const startPeek = useCallback(() => {
    clearTimeout(hideTimer.current);
    if (state.navCollapsed) setPeek(true);
  }, [state.navCollapsed]);
  const holdPeek = useCallback(() => clearTimeout(hideTimer.current), []);
  const endPeek = useCallback(() => {
    clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => {
      // Moving onto the New picker is still "inside" the sidebar.
      if (!newOpenRef.current) setPeek(false);
    }, 120);
  }, []);
  useEffect(() => {
    if (!state.navCollapsed) setPeek(false);
  }, [state.navCollapsed]);
  useEffect(() => {
    if (!peek) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setPeek(false);
      document.querySelector<HTMLElement>("#dx-global-controls [data-act=toggle-sidebar]")?.focus();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [peek]);

  /* ---- New ---------------------------------------------------------------- */
  function openNew(anchor: HTMLElement | null) {
    if (newAnchor) {
      setNewAnchor(null);
      return;
    }
    closeMenu();
    setNewAnchor(
      anchor ??
        document.querySelector<HTMLElement>("#dx-sidebar:not([inert]) [data-act=new-file]") ??
        document.querySelector<HTMLElement>("#dx-global-controls [data-act=toggle-sidebar]"),
    );
  }
  const closeNew = useCallback(
    (focusAnchor: boolean) => {
      setNewAnchor((anchor) => {
        if (focusAnchor && anchor?.isConnected) anchor.focus();
        return null;
      });
      // A sidebar that was only peeking goes back once the pointer is elsewhere.
      if (state.navCollapsed && !document.querySelector("#dx-sidebar:hover, #dx-global-controls:hover")) endPeek();
    },
    [state.navCollapsed, endPeek],
  );

  /* ---- one-time mounts ---------------------------------------------------- */
  useEffect(() => (shell.current ? mountTooltips(shell.current) : undefined), []);
  useEffect(() => dexFaceSettings({ paused: reduceMotion }), [reduceMotion]);

  /* ---- a selection made beside a conversation goes to its composer (§19) --- */
  useEffect(() => {
    if (selection && state.chat && state.panel === "assets") dispatch({ type: "set-panel", panel: "chat" });
    if (selection && state.chat && state.dexOpen) dispatch({ type: "set-dex-open", open: false });
  }, [selection, state.chat, state.panel, state.dexOpen, dispatch]);

  /* ---- Hot and fresh features --------------------------------------------- */
  const atHome = state.page === "home";
  useEffect(() => {
    if (atHome) setFeatureFlyout(false);
  }, [atHome]);
  useEffect(() => {
    if (!featureFlyout) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setFeatureFlyout(false);
    };
    const onClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (!target.closest("#dx-feature-flyout,#dx-features-toggle,#dx-modal")) setFeatureFlyout(false);
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("click", onClick);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("click", onClick);
    };
  }, [featureFlyout]);
  const featuresExpanded = atHome ? state.featuresVisible : featureFlyout;
  const toggleFeatures = () => {
    if (atHome) {
      dispatch({ type: "set-features", visible: !state.featuresVisible });
      if (!state.featuresVisible) {
        requestAnimationFrame(() =>
          document.querySelector<HTMLElement>("#dx-feature-highlights [data-act=hide-features]")?.focus({ preventScroll: true }),
        );
      }
      return;
    }
    setFeatureFlyout((open) => !open);
  };

  /* ---- what the run is doing to which files -------------------------------- */
  const touched = useMemo(() => filesTouchedBy(agent.task), [agent.task]);
  const running = isRunning(runStateOf(agent.task));

  const onEditor = state.page === "editor";
  // A conversation resumed with no file it can show (1.0.12 §四).
  const chatEmpty = onEditor && state.chat !== null && state.activeFileId === null && !state.stage && !state.demo;
  /*
   * The switch appears once there is work beside the conversation — a message
   * sent, a run, a file opened — and then stays in the window's top-right
   * corner whether the content region is open or not (§03).
   */
  const spokenIn = agent.task !== null && (agent.task.messages.length > 0 || agent.task.status !== "idle");
  const hasWorkspaceToggle = state.chat !== null && (spokenIn || (onEditor && (activeFile !== null || state.stage)));
  const closed = workspaceClosed(state);
  const editorKind = activeFile?.type === "sheet" ? "sheet" : "other";
  /*
   * The attention border shows while the agent is touching the document on
   * screen, and only then. Waiting for review does not light it: nothing is
   * happening in there any more.
   */
  const attentionActive = running && onEditor && (activeFile !== null || surface.chrome !== null);

  const classes = workspaceClasses(state, { peek, hasWorkspaceToggle }).join(" ");

  return (
    <div
      id="shell"
      ref={shell}
      className={[
        "shell",
        reduceMotion ? "dx-reduced" : "",
        resizing ? "dx-resizing" : "",
        sidebarResizing ? "dx-sidebar-resizing" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      data-theme={state.theme}
      data-page={state.page}
      data-loaded={String(loaded)}
      style={{ "--dx-chat": `${state.chatWidth}px` } as React.CSSProperties}
    >
      <div
        id="dx-workspace"
        className={classes}
        inert={setupVisible}
        // The expanded sidebar's width (UI-03), clamped to what this window can spare.
        style={{ "--dx-sidebar-width": `${Math.min(state.navWidth, navMaxWidth(viewportWidth))}px` } as React.CSSProperties}
      >
        <GlobalControls onPeek={startPeek} onPeekEnd={endPeek} />

        <Sidebar
          account={account.account}
          peek={peek}
          newPopoverOpen={newOpen}
          onNew={openNew}
          onPeekHold={holdPeek}
          onPeekEnd={endPeek}
          onOpenFeatures={toggleFeatures}
          featuresExpanded={featuresExpanded}
        />

        <SidebarResizer onResizing={setSidebarResizing} />

        <ConversationPane />
        <Splitter onResizing={setResizing} />

        <main id="dx-content" inert={closed ? true : undefined}>
          <DocumentTabs workingFileIds={touched.working} />

          {state.page === "home" ? <Home onQuickStart={createOfType} /> : null}
          {state.page === "local" ? <LocalPage /> : null}
          {state.page === "projects" ? <ProjectsPage /> : null}
          {state.page === "assets" ? <AssetsPage /> : null}
          {state.page === "image" ? <ImageCreatePage /> : null}
          {state.page === "skills" ? <SkillsPage /> : null}
          {state.page === "settings" ? <SettingsPage onOpenAccount={() => setAccountOpen(true)} /> : null}
          {chatEmpty ? <ChatEmpty /> : null}

          {/* Hidden rather than unmounted: see the note at the top of this file. */}
          <section
            ref={editorWrapper}
            className="dx-editor-wrapper dx-office-editor shell-workspace"
            data-file-editor={activeFile?.id ?? ""}
            data-editor-mode={state.chat ? "agent" : "editor"}
            data-editor-kind={editorKind}
            hidden={!onEditor || chatEmpty}
          >
            <EditorCanvasHost
              file={activeFile}
              visible={onEditor && !chatEmpty}
              adapter={canvas}
              // A document beside a conversation gets Writer's single-line
              // toolbar; one opened from Local keeps the full ribbon. The tab
              // remembers which (`tabContexts`), so the choice follows the tab.
              toolbarProfile={activeFile && tabIsChat(state, activeFile.id) ? "compact" : "full"}
              fileless={state.demo}
              stage={state.stage}
              demoStartedAt={state.demoStartedAt}
              onDemoSuperseded={() => dispatch({ type: "leave-demo" })}
            />
            <ImageWorkspace agent={agent} />
            <AttentionBorder active={attentionActive} reducedMotion={reduceMotion} />
            {onEditor && activeFile && activeFile.type !== "image" ? <Dex host={editorWrapper} editorKind={editorKind} /> : null}
          </section>
        </main>

        {hasWorkspaceToggle ? (
          <button
            type="button"
            id="dx-workspace-toggle"
            className="dx-ib"
            data-ui-scope="officedex"
            data-act="toggle-workspace"
            aria-pressed={state.workspaceOpen}
            aria-label={t(state.workspaceOpen ? "dx.workspace.close" : "dx.workspace.open")}
            title={t(state.workspaceOpen ? "dx.workspace.close" : "dx.workspace.open")}
            onClick={() => dispatch({ type: "toggle-workspace" })}
          >
            <Icon name="PanelRight" size={18} />
          </button>
        ) : null}

        {!atHome && featureFlyout ? (
          <aside id="dx-feature-flyout" data-ui-scope="officedex" aria-label={t("dx.features.title")}>
            <FeatureHighlights
              onHide={() => {
                setFeatureFlyout(false);
                document.getElementById("dx-features-toggle")?.focus({ preventScroll: true });
              }}
            />
          </aside>
        ) : null}
      </div>

      {newAnchor ? (
        <NewPopover
          anchor={newAnchor}
          onClose={closeNew}
          onNewChat={() => {
            setNewAnchor(null);
            dispatch({ type: "go", page: "home" });
            requestAnimationFrame(() =>
              document.querySelector<HTMLElement>(".dx-home-composer [data-draft]")?.focus(),
            );
          }}
          onCreate={(type) => {
            setNewAnchor(null);
            createOfType(type);
          }}
        />
      ) : null}

      <Layers />
      <ToastHost />
      <UsageNotice />
      <SetupHost onVisibility={setSetupVisible} onAccountChanged={account.refresh} />

      {/*
        The sign-in page covers the window rather than replacing the shell, so
        the open document's editor survives the trip.
      */}
      {accountOpen ? (
        <AccountPage
          onClose={() => setAccountOpen(false)}
          onAccountChanged={account.refresh}
          // A sign-in started from this page ends on Home, not back on the
          // Settings section it was opened from.
          onSignedIn={() => {
            setAccountOpen(false);
            dispatch({ type: "go", page: "home" });
          }}
        />
      ) : null}
    </div>
  );
}

/** The window's width, for the sidebar's limit; follows a resize. */
function useViewportWidth(): number {
  const [width, setWidth] = useState(() => window.innerWidth);
  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return width;
}
