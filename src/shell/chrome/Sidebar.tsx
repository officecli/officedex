import { Clock3, FolderOpen, House, Pin, Plus, Settings2, UserRound } from "lucide-react";
import type { ReactNode } from "react";

import { useT } from "../../renderer/i18n";
import { useShell } from "../state/ShellContext";
import { useLibraryActions } from "../nav/useLibraryActions";
import { ModeMenu } from "./ModeMenu";
import { NewTaskMenu } from "./NewTaskMenu";
import { UpdateButton } from "./UpdateButton";
import type { Account } from "../account/useAccount";

/**
 * The sidebar keeps its position and its top/bottom furniture in both modes and
 * swaps only its middle. Agent mode lists folders and tasks; Editor mode lists
 * the file library. Nothing about the frame moves, so switching modes does not
 * feel like navigating to a different application.
 *
 * `children` is the mode-specific middle; M3 fills it with the file tree.
 *
 * `account` and `onOpenAccount` are required props rather than something this
 * component fetches. The account is one fact about the whole shell — the agent
 * column will want it too, and a second `whoami` per consumer is a second
 * subprocess for an answer that cannot differ. With the handler required, the
 * compiler catches a call site that forgot to wire the chip: the audit that
 * found the old chip silent found it precisely because the prop was optional.
 */
export function Sidebar({
  children,
  account,
  onOpenAccount,
  onOpenSettings,
}: {
  children?: ReactNode;
  account: Account;
  onOpenAccount: () => void;
  /** Opens the settings page. Required so the compiler finds a call site that forgot it. */
  onOpenSettings: () => void;
}) {
  const t = useT();
  const { state, dispatch } = useShell();
  const actions = useLibraryActions();
  const agent = state.mode === "agent";
  const collapsed = state.navCollapsed;

  /*
   * What the chip says, given that nobody may be signed in.
   *
   * The three cases are deliberately different words. An anonymous user is not
   * an unanswered question, and a CLI that could not be reached is not an
   * anonymous user — the chip never claims a state nothing reported. The
   * identity itself is the email the CLI printed, or the user id when it printed
   * no email; it is never synthesised, which is the whole reason the old chip
   * reading "Flora · Personal workspace" had to go.
   */
  const accountLabel =
    account.mode === "account"
      ? account.label ?? t("shell.account.signedIn")
      : account.mode === "anonymous"
        ? t("shell.account.signIn")
        : t("shell.account.open");
  const accountTitle =
    account.mode === "account"
      ? account.label
        ? t("shell.account.signedInAs", { id: account.label })
        : t("shell.account.signedIn")
      : account.mode === "anonymous"
        ? t("shell.account.notSignedIn")
        : t("shell.account.openHint");

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
              "New" used to only `go-home`, on the theory that Home already
              holds the three blank-document buttons. On Home that is a no-op,
              which is exactly where people press this control. The menu is the
              same three types the folder "+" offers, created in the default
              folder — never a guessed type, never a silent return to a page
              already on screen.
            */}
            {/*
              The prototype's New is a page — three blank templates with a
              picture of each — not a menu. Pressed on Home it still changes what
              is on screen, which was the reason for the menu it replaces.
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
        {/*
          The account chip. The shell used to draw one that read "Flora ·
          Personal workspace" for everyone — a name nobody has, next to a
          workspace that does not exist — and the audit that found it doing
          nothing at all was right to remove it. It comes back now that there is
          someone to name: the email `whoami` reported, or the word for not being
          signed in, or a neutral control when there was no answer to report.

          Pressing it opens the account page, which is where signing in and out
          happens — a full-page flow, not a panel in this frame (R-B-09). The
          chip holds no state of its own, so there is nothing here that can
          disagree with that page.
        */}
        <button
          type="button"
          className="shell-profile"
          onClick={onOpenAccount}
          aria-label={t("shell.account.openHint")}
          title={accountTitle}
        >
          <span className="shell-avatar" aria-hidden="true">
            {account.mode === "account" && account.label ? (
              account.label.slice(0, 1).toUpperCase()
            ) : (
              <UserRound size={14} strokeWidth={1.6} />
            )}
          </span>
          {collapsed ? null : <span>{accountLabel}</span>}
        </button>
        {/*
          The gear opens the settings page, and nothing else.

          It used to open a three-row menu — Review changes, Enter sends,
          Reduced motion — which was the shell's *only* door onto settings and
          the only door it had at all: the legacy renderer's full settings page
          exists, but a packaged WKWebView has no address bar to type
          `legacy.html` into, so 94 of its settings were unreachable (audit
          S7-001 and §3). The two rows that were real preferences moved onto the
          page, under Appearance; the third was a switch that only ever said it
          was not available, and it stays where it belongs, in the composer's
          permission menu, rather than being copied onto a page that exists to
          be the honest list of what can be changed.
        */}
        {/* Only there while an optional update is waiting — see UpdateButton. */}
        <UpdateButton />
        <button
          type="button"
          className="shell-icon-button"
          aria-label={t("shell.nav.settings")}
          title={t("shell.nav.settings")}
          onClick={onOpenSettings}
        >
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
