import { Clock3, FolderOpen, House, Pin, Plus, Settings2 } from "lucide-react";
import type { ReactNode } from "react";

import { useShell } from "../state/ShellContext";
import { ModeMenu } from "./ModeMenu";

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
            <SidebarButton
              icon={<Plus size={18} strokeWidth={1.6} aria-hidden="true" />}
              label="New"
              collapsed={collapsed}
            />
            <SidebarButton
              icon={<FolderOpen size={18} strokeWidth={1.6} aria-hidden="true" />}
              label="Open"
              collapsed={collapsed}
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
        <button type="button" className="shell-profile" title="Flora · Personal workspace">
          <span className="shell-avatar" aria-hidden="true">
            F
          </span>
          {collapsed ? null : <span>Flora</span>}
        </button>
        <button type="button" className="shell-icon-button" aria-label="Settings" title="Settings">
          <Settings2 size={18} strokeWidth={1.6} aria-hidden="true" />
        </button>
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
  onClick?: () => void;
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
