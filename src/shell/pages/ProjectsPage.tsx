import { useState } from "react";

import { useT } from "../../renderer/i18n";
import { useWorkspaceMenus } from "../chrome/useWorkspaceMenus";
import { Icon } from "../kit/Icon";
import { usePort } from "../port/PortContext";
import { attempt } from "../port/reportPortFailure";
import { useShell, type Chat } from "../state/ShellContext";

/**
 * Projects & conversations — where archived work is found again.
 *
 * Archive and Delete both land here rather than anywhere irreversible
 * (WORKSPACE-STANDARD §01), and restoring puts a conversation back under the
 * project it came from. Nothing on this page touches a file.
 */
export function ProjectsPage() {
  const t = useT();
  const port = usePort();
  const { dispatch, projects, chats, defaultFolderId, setChatMeta, setProjectMeta } = useShell();
  const menus = useWorkspaceMenus();
  const [archived, setArchived] = useState(false);

  const shown = projects.filter((project) => project.archived === archived);
  const liveProjectIds = new Set(projects.filter((project) => !project.archived).map((project) => project.id));
  const looseArchived = chats.filter(
    (chat) => chat.archived && (chat.folderId === defaultFolderId || liveProjectIds.has(chat.folderId)),
  );

  const open = async (chat: Chat) => {
    if (await attempt(async () => void (await port.agent.openConversation(chat.folderId, chat.id)))) {
      dispatch({ type: "open-chat", chat: { folderId: chat.folderId, conversationId: chat.id } });
    }
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
      <div className="dx-toolbar">
        <button type="button" className="dx-filter" data-act="project-view" data-id="active" aria-pressed={!archived} onClick={() => setArchived(false)}>
          {t("dx.projects.active")}
        </button>
        <button type="button" className="dx-filter" data-act="project-view" data-id="archived" aria-pressed={archived} onClick={() => setArchived(true)}>
          {t("dx.projects.archived")}
        </button>
      </div>

      {shown.length > 0 ? (
        shown.map((project) => {
          const rows = chats.filter((chat) => chat.folderId === project.id);
          return (
            <section key={project.id} className="dx-plan-card dx-project-card">
              <div className="dx-row">
                <Icon name="Folder" />
                <h2 className="dx-grow">{project.name}</h2>
                {archived ? (
                  <button type="button" className="dx-btn" data-act="restore-project" onClick={() => setProjectMeta(project.id, { archived: false })}>
                    {t("dx.menu.restore")}
                  </button>
                ) : (
                  <button type="button" className="dx-btn" data-act="new-chat" onClick={() => menus.newChat(project.id)}>
                    {t("dx.menu.newChat")}
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
              {rows.length > 0 ? (
                rows.map((chat) => (
                  <div key={chat.id} className="dx-recovery-row">
                    <button
                      type="button"
                      className="dx-grow dx-project-chat"
                      data-act={chat.archived ? "restore-chat" : "open-chat"}
                      onClick={() => (chat.archived ? setChatMeta(chat.id, { archived: false }) : void open(chat))}
                    >
                      {chat.name}
                    </button>
                    {chat.archived ? (
                      <button type="button" className="dx-btn" data-act="restore-chat" onClick={() => setChatMeta(chat.id, { archived: false })}>
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
                ))
              ) : (
                <p className="dx-muted">{t("dx.projects.noChats")}</p>
              )}
            </section>
          );
        })
      ) : (
        <div className="dx-empty">
          <h2>{t("dx.projects.empty")}</h2>
          <p>{t("dx.projects.emptyHint")}</p>
        </div>
      )}

      {archived
        ? looseArchived.map((chat) => (
            <div key={chat.id} className="dx-recovery-row">
              <span className="dx-grow">{chat.name}</span>
              <button type="button" className="dx-btn" data-act="restore-chat" onClick={() => setChatMeta(chat.id, { archived: false })}>
                {t("dx.menu.restore")}
              </button>
            </div>
          ))
        : null}
    </section>
  );
}
