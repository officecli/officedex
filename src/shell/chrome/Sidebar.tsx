import { Clock3, FolderOpen, House, Pin, Plus, Settings2 } from "lucide-react";
import type { ReactNode } from "react";

import { useT } from "../../renderer/i18n";
import { useShell } from "../state/ShellContext";
import { useLibraryActions } from "../nav/useLibraryActions";
import { notBuiltYet } from "../port/reportPortFailure";
import { ModeMenu } from "./ModeMenu";
import { NewTaskMenu } from "./NewTaskMenu";
import { UpdateButton } from "./UpdateButton";
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
  const t = useT();
  const { state, dispatch } = useShell();
  const actions = useLibraryActions();
  const settings = useComposerSettings();
  const agent = state.mode === "agent";
  const collapsed = state.navCollapsed;

  return (
    <aside id="shell-sidebar" className="shell-sidebar shell-region" aria-label={t("shell.sidebar.navAria")}>
      <div className="shell-sidebar-brand">
        <ModeMenu />
      </div>
      <nav className="shell-sidebar-top" aria-label={t(agent ? "shell.sidebar.agentNav" : "shell.sidebar.libraryNav")}>
        <SidebarButton
          icon={<House size={18} strokeWidth={1.6} aria-hidden="true" />}
          label={t("shell.nav.home")}
          collapsed={collapsed}
          current={state.home && (agent || state.homeList !== "new")}
          onClick={() => dispatch({ type: "go-home" })}
        />

        {agent ? (
          <NewTaskMenu label={t("shell.sidebar.newTask")} collapsed={collapsed} />
        ) : (
          <>
            {/*
              The prototype's New is a page — three blank templates with a
              picture of each — not a return to Home, which is a no-op on Home,
              exactly where people press it.
            */}
            <SidebarButton
              icon={<Plus size={18} strokeWidth={1.6} aria-hidden="true" />}
              label={t("shell.sidebar.new")}
              collapsed={collapsed}
              current={state.home && state.homeList === "new"}
              onClick={() => dispatch({ type: "set-home-list", list: "new" })}
            />
            <SidebarButton
              icon={<FolderOpen size={18} strokeWidth={1.6} aria-hidden="true" />}
              label={t("shell.sidebar.open")}
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
        <nav className="shell-sidebar-views" aria-label={t("shell.sidebar.fileViews")}>
          <SidebarButton
            icon={<Clock3 size={18} strokeWidth={1.6} aria-hidden="true" />}
            label={t("shell.sidebar.recent")}
            collapsed={collapsed}
            current={state.home && state.homeList === "recent"}
            onClick={() => dispatch({ type: "set-home-list", list: "recent" })}
          />
          <SidebarButton
            icon={<Pin size={18} strokeWidth={1.6} aria-hidden="true" />}
            label={t("shell.sidebar.pinned")}
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
        {/* Only there while an optional update is waiting — see UpdateButton. */}
        <UpdateButton />
        <Menu
          label={t("shell.sidebar.settingsMenu")}
          align="end"
          width={250}
          items={[
            {
              id: "review",
              label: t("shell.sidebar.reviewChanges"),
              description: t("shell.sidebar.reviewChangesDescription"),
              /*
               * The fifth door onto a tier that does not exist.
               *
               * The composer's permission menu gained a gate when Review and
               * Custom turned out to have nothing behind them, and all four
               * defaults moved to Full access — but this row kept writing
               * `permission: "review"` straight through. Pressing it left the
               * composer button reading "Review changes" for the rest of the
               * session while every run still applied its edits directly: the
               * one shape of failure this shell refuses, a control that
               * answers by lying.
               *
               * No `checked`: the stored value is filtered on read now, so it
               * could only ever have rendered a tick that was about to vanish.
               */
              onSelect: () =>
                notBuiltYet(
                  "composer.permission.review",
                  t("shell.sidebar.reviewNotBuilt"),
                ),
            },
            {
              id: "enter",
              label: t(
                settings.value.enterToSend ? "shell.sidebar.enterSends" : "shell.sidebar.enterNewline",
              ),
              description: t("shell.sidebar.enterDescription"),
              checked: settings.value.enterToSend,
              onSelect: () => void settings.patch({ enterToSend: !settings.value.enterToSend }),
            },
            {
              id: "motion",
              label: t(
                settings.value.reduceMotion ? "shell.sidebar.reducedMotion" : "shell.sidebar.fullMotion",
              ),
              description: t("shell.sidebar.motionDescription"),
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
              aria-label={t("shell.nav.settings")}
              title={t("shell.nav.settings")}
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
