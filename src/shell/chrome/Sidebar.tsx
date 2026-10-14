import { useCallback, type KeyboardEvent, type ReactNode } from "react";

import { useT } from "../../renderer/i18n";
import type { Account } from "../account/useAccount";
import { Icon } from "../kit/Icon";
import { activeProject, useShell, type Chat, type Project } from "../state/ShellContext";
import { sameChat, type AvatarId, type ChatRef } from "../state/shellReducer";
import { openSkills } from "../skills/templateLibrary";
import { useChatEntry } from "./useChatEntry";
import { useWorkspaceMenus } from "./useWorkspaceMenus";

import giftIcon from "../assets/ui/ic_fluent_gift_open_20_regular.svg";

const AVATARS = import.meta.glob<string>("../assets/avatars/dex-avatar-*.svg", {
  eager: true,
  query: "?url",
  import: "default",
});

/** The static Dex avatar for a user's choice (WORKSPACE-STANDARD §05). */
export function avatarUrl(id: AvatarId): string {
  return AVATARS[`../assets/avatars/dex-avatar-${id}.svg`] ?? AVATARS["../assets/avatars/dex-avatar-ready.svg"] ?? "";
}

/**
 * The sidebar — OD-UI-1.2 §07, WORKSPACE-STANDARD §03.
 *
 *   New
 *   Local
 *
 *   Projects                    ⋯  +
 *     [folder] project          ⋯
 *         conversation          ⋯
 *
 *   avatar · account     [gift]  [settings]
 *
 * Home is the Logo tab's job and Open is Local's, so neither is here; there is
 * no Recent and no search. A project row only opens and closes — the folder
 * glyph is the disclosure, there is no chevron — and its management lives in
 * the "more" button. Files never appear in this tree.
 *
 * 244px by default, dragged out to 480 from its edge (`SidebarResizer`, 1.0.12
 * UI-03). Hidden means 0px and no rail: `peek` is the temporary reveal while
 * the pointer rests on the switch or on the sidebar itself.
 */
export function Sidebar({
  account,
  peek,
  newPopoverOpen,
  onNew,
  onPeekHold,
  onPeekEnd,
  onOpenFeatures,
  featuresExpanded,
  children,
}: {
  account: Account;
  peek: boolean;
  newPopoverOpen: boolean;
  onNew: (anchor: HTMLElement) => void;
  onPeekHold: () => void;
  onPeekEnd: () => void;
  onOpenFeatures: () => void;
  featuresExpanded: boolean;
  children?: ReactNode;
}) {
  const t = useT();
  const { state, dispatch, projects, chats, defaultFolderId } = useShell();
  const menus = useWorkspaceMenus();

  const entry = useChatEntry();
  // 1.0.12 §一: an unstarted chat goes back to Home; one with history resumes.
  const openChat = useCallback((chat: Chat) => entry.openChat(chat), [entry]);

  const visibleProjects = projects.filter(activeProject);
  const projectIds = new Set(visibleProjects.map((project) => project.id));
  const liveChats = chats.filter((chat) => !chat.archived && !chat.deleted);
  // A conversation whose project is gone from the tree is unfiled, not lost.
  const unfiled = liveChats.filter((chat) => chat.folderId === defaultFolderId || !projectIds.has(chat.folderId));
  const pendingChat: ChatRef | null = state.chat && state.chat.conversationId === null ? state.chat : null;
  const pendingName = state.pendingChatName || t("dx.chat.untitled");

  const onTreeKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    const tree = event.currentTarget;
    const rows = [...tree.querySelectorAll<HTMLButtonElement>("[data-act=toggle-project],[data-act=open-chat]")];
    const target = event.target as HTMLElement;
    const index = rows.indexOf(target as HTMLButtonElement);
    if (index < 0) return;
    event.preventDefault();
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      const next =
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? rows.length - 1
            : Math.max(0, Math.min(rows.length - 1, index + (event.key === "ArrowDown" ? 1 : -1)));
      rows[next]?.focus();
      return;
    }
    const item = target.closest<HTMLElement>("[data-project]");
    const projectId = item?.dataset.project;
    if (!projectId) return;
    const expanded = state.expandedFolderIds.includes(projectId);
    const toggle = item.querySelector<HTMLButtonElement>("[data-act=toggle-project]");
    if (event.key === "ArrowLeft" && target.dataset.act === "open-chat") toggle?.focus();
    else if (expanded !== (event.key === "ArrowRight")) dispatch({ type: "toggle-folder", folderId: projectId });
    else if (event.key === "ArrowRight") rows[index + 1]?.focus();
  };

  const chatRow = (chat: Chat) => {
    const ref = { folderId: chat.folderId, conversationId: chat.id };
    // A draft chat being written on Home is the one in hand (1.0.12 §一).
    const selected = sameChat(state.chat, ref) || (state.page === "home" && sameChat(state.homeChat, ref));
    return (
      <div key={chat.id} className={selected ? "dx-chat-tree dx-selected" : "dx-chat-tree"} role="treeitem" aria-selected={selected}>
        <button type="button" data-act="open-chat" data-id={chat.id} title={chat.name} onClick={() => void openChat(chat)}>
          <span className="dx-ellipsis">{chat.name}</span>
          {chat.running ? <span className="dx-spinner" /> : null}
          {chat.pinned ? <Icon name="Bookmark" /> : null}
        </button>
        <button
          type="button"
          className="dx-ib"
          aria-label={t("dx.chat.manage", { name: chat.name })}
          title={t("dx.chat.manage", { name: chat.name })}
          data-act="chat-menu"
          data-id={chat.id}
          onClick={(event) => menus.chatMenu(chat, event.currentTarget)}
        >
          <Icon name="MoreHorizontal" />
        </button>
      </div>
    );
  };

  /** The chat that has been started but not yet spoken in, under its project. */
  const pendingRow = (folderId: string) =>
    pendingChat && pendingChat.folderId === folderId ? (
      <div key="pending" className="dx-chat-tree dx-selected" role="treeitem" aria-selected="true">
        <button
          type="button"
          data-act="open-chat"
          data-id=""
          title={pendingName}
          // Already the open conversation; pressing it brings the conversation
          // and its Assets back if the content region had moved on to a file.
          onClick={() => dispatch({ type: "open-chat", chat: pendingChat, name: pendingName })}
        >
          <span className="dx-ellipsis">{pendingName}</span>
        </button>
        <span className="dx-ib" aria-hidden="true" />
      </div>
    ) : null;

  const projectItem = (project: Project) => {
    const expanded = state.expandedFolderIds.includes(project.id);
    const rows = liveChats.filter((chat) => chat.folderId === project.id);
    const pending = pendingRow(project.id);
    return (
      <div key={project.id} role="treeitem" aria-expanded={expanded} aria-label={project.name} data-project={project.id}>
        <div className="dx-project-row">
          <button
            type="button"
            data-act="toggle-project"
            data-id={project.id}
            aria-expanded={expanded}
            aria-controls={`dx-project-children-${project.id}`}
            title={project.name}
            onClick={() => dispatch({ type: "toggle-folder", folderId: project.id })}
          >
            <Icon name={expanded ? "FolderOpen" : "Folder"} />
            <span className="dx-ellipsis">{project.name}</span>
          </button>
          <button
            type="button"
            className="dx-ib"
            aria-label={t("dx.project.manage", { name: project.name })}
            title={t("dx.project.manage", { name: project.name })}
            data-act="project-menu"
            data-id={project.id}
            onClick={(event) => menus.projectMenu(project, event.currentTarget)}
          >
            <Icon name="MoreHorizontal" />
          </button>
        </div>
        {expanded ? (
          <div role="group" id={`dx-project-children-${project.id}`}>
            {pending}
            {rows.map(chatRow)}
            {rows.length === 0 && !pending ? (
              <button type="button" className="dx-nav-item" data-act="new-chat" data-id={project.id} onClick={() => menus.newChat(project.id)}>
                <span>{t("dx.chat.start")}</span>
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  };

  const unfiledPending = pendingRow(defaultFolderId);
  const accountName =
    account.mode === "account" ? (account.label ?? t("dx.account.signedIn")) : t("dx.account.guest");

  return (
    <aside
      id="dx-sidebar"
      data-ui-scope="officedex"
      // Hidden and not peeking: out of the tab order as well as out of sight.
      inert={state.navCollapsed && !peek ? true : undefined}
      onPointerEnter={onPeekHold}
      onPointerLeave={onPeekEnd}
    >
      <div className="dx-sidebar-cap" />
      <div className="dx-sidebar-main">
        <button
          type="button"
          className="dx-nav-item"
          data-act="new-file"
          title={t("dx.nav.new")}
          aria-label={t("dx.nav.new")}
          aria-haspopup="dialog"
          aria-controls="dx-new-popover"
          aria-expanded={newPopoverOpen}
          onClick={(event) => onNew(event.currentTarget)}
        >
          <Icon name="Plus" />
          <span>{t("dx.nav.new")}</span>
        </button>
        <button
          type="button"
          className={state.page === "local" ? "dx-nav-item dx-selected" : "dx-nav-item"}
          data-act="local"
          title={t("dx.nav.local")}
          aria-label={t("dx.nav.local")}
          aria-current={state.page === "local" ? "page" : undefined}
          onClick={() => dispatch({ type: "go", page: "local" })}
        >
          <Icon name="FolderOpen" />
          <span>{t("dx.nav.local")}</span>
        </button>
        {/* 1.0.12 UI-16: Skills, in private beta — the badge is a label, not a control. */}
        <button
          type="button"
          className={state.page === "skills" ? "dx-nav-item dx-selected" : "dx-nav-item"}
          data-act="skills"
          title={t("dx.nav.skills")}
          aria-label={t("dx.nav.skills")}
          aria-description={t("dx.nav.betaDescription")}
          aria-current={state.page === "skills" ? "page" : undefined}
          onClick={() => openSkills(state, dispatch)}
        >
          <Icon name="Puzzle" />
          <span>{t("dx.nav.skills")}</span>
          <span className="dx-nav-beta" title={t("dx.nav.betaDescription")} aria-hidden="true">
            {t("dx.nav.beta")}
          </span>
        </button>
      </div>

      <div className="dx-sidebar-scroll">
        <div className="dx-expanded-content" id="dx-project-group">
          <div className="dx-group-heading">
            <span>{t("dx.nav.projects")}</span>
            <button
              type="button"
              className="dx-ib"
              aria-label={t("dx.project.library")}
              title={t("dx.project.library")}
              data-act="project-library"
              onClick={() => dispatch({ type: "go", page: "projects" })}
            >
              <Icon name="MoreHorizontal" />
            </button>
            <button
              type="button"
              className="dx-ib"
              aria-label={t("dx.project.new")}
              title={t("dx.project.new")}
              data-act="new-project"
              onClick={menus.newProject}
            >
              <Icon name="Plus" />
            </button>
          </div>
          <div role="tree" aria-label={t("dx.nav.treeAria")} onKeyDown={onTreeKeyDown}>
            {visibleProjects.length > 0 ? (
              visibleProjects.map(projectItem)
            ) : (
              <>
                <p className="dx-metadata">{t("dx.project.emptyHint")}</p>
                <button type="button" className="dx-btn" data-act="new-project" onClick={menus.newProject}>
                  {t("dx.project.create")}
                </button>
              </>
            )}
          </div>
          {unfiled.length > 0 || unfiledPending ? (
            <>
              <div className="dx-group-heading">{t("dx.nav.unfiled")}</div>
              {unfiledPending}
              {unfiled.map(chatRow)}
            </>
          ) : null}
        </div>
        {children}
      </div>

      <div className="dx-sidebar-footer">
        <button
          type="button"
          className="dx-footer-item dx-account-row"
          data-act="account"
          aria-label={t("dx.account.label")}
          onClick={() => dispatch({ type: "go", page: "settings", section: "account" })}
        >
          <span className="dx-footer-leading">
            <img className="dx-avatar" src={avatarUrl(state.avatar)} alt="" />
          </span>
          <span className="dx-footer-label dx-ellipsis">{accountName}</span>
        </button>
        {state.featuresDocked ? (
          <button
            type="button"
            id="dx-features-toggle"
            className="dx-ib"
            data-act="toggle-features"
            aria-expanded={featuresExpanded}
            aria-controls="dx-feature-highlights"
            aria-label={t(featuresExpanded ? "dx.features.hide" : "dx.features.show")}
            title={t("dx.features.title")}
            onClick={onOpenFeatures}
          >
            <span
              className="dx-feature-gift"
              aria-hidden="true"
              // The prototype carries the glyph as an inline mask-image; the ported
              // rule has the mask's size and position but not the image, so the
              // span painted as a solid square until the URL came from here. Quoted:
              // Vite inlines the file as a data: URL that holds single quotes, which
              // an unquoted url() cannot, and the browser drops the declaration.
              style={{ maskImage: `url("${giftIcon}")`, WebkitMaskImage: `url("${giftIcon}")` }}
            />
          </button>
        ) : null}
        <button
          type="button"
          className={state.page === "settings" ? "dx-footer-item dx-selected" : "dx-footer-item"}
          data-act="settings"
          aria-label={t("dx.nav.settings")}
          title={t("dx.nav.settings")}
          onClick={() => dispatch({ type: "go", page: "settings" })}
        >
          <span className="dx-footer-leading">
            <Icon name="Settings2" />
          </span>
        </button>
      </div>
    </aside>
  );
}
