import { useState } from "react";

import { useT } from "../../renderer/i18n";
import { useChatEntry } from "../chrome/useChatEntry";
import { useWorkspaceMenus } from "../chrome/useWorkspaceMenus";
import { Icon } from "../kit/Icon";
import { activeProject, useShell, type Chat, type Project } from "../state/ShellContext";

type View = "active" | "archived" | "deleted";

/**
 * Projects & conversations — where archived and deleted work is found again.
 *
 * Archive and Delete are kept apart (1.0.12 §五): archiving hides a project or
 * conversation and leaves its runs going; deleting asks first, stops what is
 * running or queued, and moves it to Deleted. Both come back from here with
 * their project, messages and Assets, and nothing is re-run. There is no
 * permanent delete, and nothing on this page touches a file.
 */
export function ProjectsPage() {
  const t = useT();
  const { projects, chats, defaultFolderId } = useShell();
  const menus = useWorkspaceMenus();
  const entry = useChatEntry();
  const [view, setView] = useState<View>("active");

  const inView = (project: Project) =>
    view === "deleted" ? project.deleted : view === "archived" ? project.archived && !project.deleted : activeProject(project);
  const shown = projects.filter(inView);
  const chatInView = (chat: Chat) =>
    view === "deleted" ? chat.deleted : view === "archived" ? chat.archived && !chat.deleted : !chat.archived && !chat.deleted;
  // Conversations of their own in this view: unfiled ones, and ones whose
  // project is still active (a deleted project's chats are listed under it).
  const standalone = chats.filter((chat) => {
    const project = projects.find((entry) => entry.id === chat.folderId);
    const own = chat.folderId === defaultFolderId || !project;
    return chatInView(chat) && (view === "active" ? own : own || activeProject(project));
  });

  const chatRow = (chat: Chat, locked: boolean) => {
    const inactive = locked || chat.archived || chat.deleted;
    return (
      <div key={chat.id} className="dx-recovery-row">
        {inactive ? (
          <span className="dx-grow dx-ellipsis">{chat.name}</span>
        ) : (
          <button type="button" className="dx-grow dx-project-chat" data-act="open-chat" onClick={() => void entry.openChat(chat)}>
            {chat.name}
          </button>
        )}
        {locked ? (
          <span className="dx-metadata">
            {t(chat.deleted ? "dx.projects.stateDeleted" : chat.archived ? "dx.projects.stateArchived" : "dx.projects.stateInProject")}
          </span>
        ) : inactive ? (
          <button type="button" className="dx-btn" data-act="restore-chat" onClick={() => menus.restoreChat(chat)}>
            {t("dx.menu.restore")}
          </button>
        ) : (
          <button
            type="button"
            className="dx-ib"
            aria-label={t("dx.projects.chatActions")}
            title={t("dx.projects.chatActions")}
            data-act="chat-menu"
            onClick={(event) => menus.chatMenu(chat, event.currentTarget)}
          >
            <Icon name="MoreHorizontal" />
          </button>
        )}
      </div>
    );
  };

  return (
    <section className="dx-page-scroll" data-ui-scope="officedex">
      <header className="dx-page-header">
        <div>
          <h1>{t("dx.projects.title")}</h1>
          <p>{t("dx.projects.subtitle")}</p>
        </div>
        <button type="button" className="dx-btn dx-primary" data-act="new-project" onClick={menus.newProject}>
          {t("dx.project.new")}
        </button>
      </header>
      <div className="dx-toolbar" aria-label={t("dx.projects.views")}>
        {(["active", "archived", "deleted"] as const).map((id) => (
          <button
            key={id}
            type="button"
            className="dx-filter"
            data-act="project-view"
            data-id={id}
            aria-pressed={view === id}
            onClick={() => setView(id)}
          >
            {t(`dx.projects.${id}`)}
          </button>
        ))}
      </div>
      {view === "deleted" ? <p className="dx-metadata">{t("dx.projects.deletedHint")}</p> : null}

      {shown.map((project) => {
        const live = activeProject(project);
        const rows = chats.filter((chat) => chat.folderId === project.id && (view !== "active" || (!chat.archived && !chat.deleted)));
        return (
          <section key={project.id} className="dx-plan-card dx-project-card" data-project={project.id}>
            <div className="dx-row">
              <Icon name="Folder" />
              <h2 className="dx-grow">{project.name}</h2>
              {live ? (
                <button type="button" className="dx-btn" data-act="new-chat" onClick={() => menus.newChat(project.id)}>
                  {t("dx.menu.newChat")}
                </button>
              ) : (
                <button
                  type="button"
                  className="dx-btn"
                  data-act="restore-project"
                  onClick={() => menus.restoreProject(project)}
                >
                  {t("dx.menu.restore")}
                </button>
              )}
              <button
                type="button"
                className="dx-ib"
                aria-label={t("dx.projects.actions")}
                title={t("dx.projects.actions")}
                data-act="project-menu"
                onClick={(event) => menus.projectMenu(project, event.currentTarget)}
              >
                <Icon name="MoreHorizontal" />
              </button>
            </div>
            {rows.length > 0 ? rows.map((chat) => chatRow(chat, !live)) : <p className="dx-muted">{t("dx.projects.noChats")}</p>}
          </section>
        );
      })}

      {standalone.length > 0 ? (
        <section className="dx-plan-card dx-project-card">
          <div className="dx-row">
            <h2 className="dx-grow">{t(view === "active" ? "dx.nav.unfiledShort" : "dx.projects.chats")}</h2>
          </div>
          {standalone.map((chat) => chatRow(chat, false))}
        </section>
      ) : null}

      {shown.length === 0 && standalone.length === 0 ? (
        <div className="dx-empty">
          <h2>{t(view === "deleted" ? "dx.projects.emptyDeleted" : view === "archived" ? "dx.projects.emptyArchived" : "dx.projects.empty")}</h2>
          <p>{t(view === "active" ? "dx.projects.emptyHintActive" : "dx.projects.emptyHint")}</p>
        </div>
      ) : null}
    </section>
  );
}
