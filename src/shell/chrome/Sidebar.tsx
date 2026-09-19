import { Clock3, FolderOpen, House, Pin, Plus, Settings2 } from "lucide-react";
import type { ReactNode } from "react";

import { useShell } from "../state/ShellContext";
import { useLibraryActions } from "../nav/useLibraryActions";
import { ModeMenu } from "./ModeMenu";
import { Menu } from "./Menu";
import { useComposerSettings } from "../composer/useComposerSettings";

/**
 * The sidebar keeps its position and its top/bottom furniture in both modes and
 * swaps only its middle. Agent mode lists folders and tasks; Editor mode lists
 * the file library. Nothing about the frame moves, so switching modes does not
 * feel like navigating to a different application.
 *
 * `children` is the mode-specific middle; M3 fills it with the file tree.
 */
export function Sidebar({ children }: { children?: ReactNode }) {
  const { state, dispatch } = useShell();
  const actions = useLibraryActions();
  const settings = useComposerSettings();
  const agent = state.mode === "agent";
  const collapsed = state.navCollapsed;

  return (
    <aside id="shell-sidebar" className="shell-sidebar shell-region" aria-label="Workspace navigation">
      <div className="shell-sidebar-brand">
        <ModeMenu />
      </div>
      <nav className="shell-sidebar-top" aria-label={agent ? "Agent" : "File library"}>
        <SidebarButton
          icon={<House size={18} strokeWidth={1.6} aria-hidden="true" />}
          label="Home"
          collapsed={collapsed}
          current={state.home}
          onClick={() => dispatch({ type: "go-home" })}
        />

        {agent ? (
          <SidebarButton
            icon={<Plus size={18} strokeWidth={1.6} aria-hidden="true" />}
            label="New task"
            collapsed={collapsed}
            onClick={() => dispatch({ type: "go-home" })}
          />
        ) : (
          <>
            {/* Home is where the three blank-document buttons are: "New" takes
                you to the choice rather than guessing a type for you. */}
            <SidebarButton
              icon={<Plus size={18} strokeWidth={1.6} aria-hidden="true" />}
              label="New"
              collapsed={collapsed}
              onClick={() => dispatch({ type: "go-home" })}
            />
            <SidebarButton
              icon={<FolderOpen size={18} strokeWidth={1.6} aria-hidden="true" />}
              label="Open"
              collapsed={collapsed}
              onClick={() => void actions.openFromDisk()}
            />
          </>
        )}
      </nav>

      <div className="shell-sidebar-body">{children}</div>

      {/*
        Decision 2: Recent and Pinned are views over the one file list, so they
        sit together as a pair of filters — not as locations a file could live
        in. Editor mode surfaces them here because Home is where its file
        library lives.
      */}
      {!agent ? (
        <nav className="shell-sidebar-views" aria-label="File views">
          <SidebarButton
            icon={<Clock3 size={18} strokeWidth={1.6} aria-hidden="true" />}
            label="Recent"
            collapsed={collapsed}
            current={state.home && state.homeList === "recent"}
            onClick={() => dispatch({ type: "set-home-list", list: "recent" })}
          />
          <SidebarButton
            icon={<Pin size={18} strokeWidth={1.6} aria-hidden="true" />}
            label="Pinned"
            collapsed={collapsed}
            current={state.home && state.homeList === "pinned"}
            onClick={() => dispatch({ type: "set-home-list", list: "pinned" })}
          />
        </nav>
      ) : null}

      <div className="shell-sidebar-footer">
        {/* No account chip. It read "Flora · Personal workspace" for everyone —
            a name nobody has, next to a workspace that does not exist. There is
            no account system yet, so the honest footer has nothing to say about
            who you are. It comes back when there is someone to name. */}
        <Menu
          label="Workspace settings"
          align="end"
          width={250}
          items={[
            {
              id: "review",
              label: "Review changes",
              description: "Ask before applying Agent edits",
              checked: settings.value.permission === "review",
              onSelect: () => void settings.patch({ permission: "review" }),
            },
            {
              id: "enter",
              label: settings.value.enterToSend ? "Enter sends" : "Enter adds a line",
              description: "Shift + Enter always adds a line",
              checked: settings.value.enterToSend,
              onSelect: () => void settings.patch({ enterToSend: !settings.value.enterToSend }),
            },
            {
              id: "motion",
              label: settings.value.reduceMotion ? "Reduced motion" : "Full motion",
              description: "Use the system animation preference",
              checked: settings.value.reduceMotion,
              onSelect: () => void settings.patch({ reduceMotion: !settings.value.reduceMotion }),
            },
          ]}
        >
          {(triggerProps) => (
            <button
              {...triggerProps}
              type="button"
              className="shell-icon-button"
              aria-label="Settings"
              title="Settings"
            >
              <Settings2 size={18} strokeWidth={1.6} aria-hidden="true" />
            </button>
          )}
        </Menu>
      </div>
    </aside>
  );
}

function SidebarButton({
  icon,
  label,
  collapsed,
  current,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  collapsed: boolean;
  current?: boolean;
  /**
   * Required, not optional.
   *
   * It used to be optional, and two of these — Editor mode's New and Open —
   * simply omitted it and sat there doing nothing. The dead-control gate scans
   * for `<button>` tags and could not see them, because the tag here has a
   * handler; it was the *caller* that had none. Making this required moves the
   * check to the compiler, which can see what a text scan cannot.
   */
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`shell-sidebar-item${current ? " is-current" : ""}`}
      aria-current={current ? "page" : undefined}
      aria-label={collapsed ? label : undefined}
      title={label}
      onClick={onClick}
    >
      {icon}
      {collapsed ? null : <span>{label}</span>}
    </button>
  );
}
